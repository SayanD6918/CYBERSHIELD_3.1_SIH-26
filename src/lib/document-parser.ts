import { validateTD3MRZ, type MRZValidationResult } from "./mrz-validator";

export type ParsedDocument = {
  documentType: "passport" | "visa" | "permit" | "id" | "unknown";
  documentNumber: string | null;
  holderName: string | null;
  nationality: string | null;
  dateOfBirth: string | null;
  expiryDate: string | null;
  expiryStatus: "valid" | "expired" | "unknown";
  mrz: MRZValidationResult | null;
  flags: string[];
};

const MONTHS: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

function cleanField(value: string): string {
  return value.replace(/<+/g, " ").replace(/\s+/g, " ").trim();
}

function comparable(value: string | null): string | null {
  return value ? value.toLowerCase().replace(/[^a-z0-9]/g, "") : null;
}

export function parseHumanDate(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(
    /^(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(\d{4})$/i,
  );
  if (!match) return null;
  const month = MONTHS[match[2].slice(0, 3).toUpperCase()];
  if (!month) return null;
  return `${match[3]}-${month}-${match[1].padStart(2, "0")}`;
}

function fieldValue(lines: string[], pattern: RegExp): string | null {
  for (const line of lines) {
    const found = line.match(pattern);
    if (found?.[1]) return cleanField(found[1]);
  }
  return null;
}

function findTD3(lines: string[]): [string, string] | null {
  const candidates = lines.map((line) => line.replace(/\s+/g, "").toUpperCase());
  for (let i = 0; i < candidates.length - 1; i += 1) {
    if (/^P<[A-Z<]{2,}/.test(candidates[i]) && /^[A-Z0-9<]{44}$/.test(candidates[i + 1])) {
      return [candidates[i], candidates[i + 1]];
    }
  }
  return null;
}

function expiryStatus(expiryDate: string | null): "valid" | "expired" | "unknown" {
  if (!expiryDate) return "unknown";
  const expiry = new Date(`${expiryDate}T23:59:59`);
  if (Number.isNaN(expiry.getTime())) return "unknown";
  return expiry >= new Date() ? "valid" : "expired";
}

export function parseDocumentText(text: string): ParsedDocument {
  const normalizedText = text.replace(/[|]/g, "I").replace(/\r/g, "").trim();
  const lines = normalizedText.split("\n").map((line) => line.trim()).filter(Boolean);

  let documentType: ParsedDocument["documentType"] = "unknown";
  if (/\bpassport\b/i.test(normalizedText)) documentType = "passport";
  else if (/\bvisa\b/i.test(normalizedText)) documentType = "visa";
  else if (/\bpermit\b/i.test(normalizedText)) documentType = "permit";
  else if (lines.some((line) => /^P<[A-Z<]{3}/i.test(line.replace(/\s+/g, "")))) documentType = "passport";

  let documentNumber = fieldValue(lines, /(?:No\.?|Number|Document\s*No\.?)\s*[:#]?\s*([A-Z0-9<-]+)/i);
  const surname = fieldValue(lines, /Surname\s*[:#]?\s*(.+)$/i);
  const givenNames = fieldValue(lines, /Given\s+names?\s*[:#]?\s*(.+)$/i);
  let holderName = surname || givenNames ? [surname, givenNames].filter(Boolean).join(" ").trim() : null;
  let nationality = fieldValue(lines, /Nationality\s*[:#]?\s*(.+)$/i);
  let dateOfBirth = parseHumanDate(fieldValue(lines, /Date\s+of\s+birth\s*[:#]?\s*(.+)$/i));
  let expiryDate = parseHumanDate(fieldValue(lines, /Date\s+of\s+expiry\s*[:#]?\s*(.+)$/i));
  const flags: string[] = [];
  let mrz: MRZValidationResult | null = null;

  const td3 = findTD3(lines);
  if (td3) {
    documentType = "passport";
    mrz = validateTD3MRZ(td3[0], td3[1]);
    if (mrz.parsed) {
      const mrzName = [mrz.parsed.surname, mrz.parsed.givenNames].filter(Boolean).join(" ").trim() || null;
      const consistency = {
        documentNumber: documentNumber ? comparable(documentNumber) === comparable(mrz.parsed.documentNumber) : null,
        nationality: nationality ? comparable(nationality) === comparable(mrz.parsed.nationality) : null,
        dateOfBirth: dateOfBirth ? dateOfBirth === mrz.parsed.dateOfBirth : null,
        expiryDate: expiryDate ? expiryDate === mrz.parsed.expiryDate : null,
        holderName: holderName ? comparable(holderName) === comparable(mrzName) : null,
      };
      mrz.fieldConsistency = consistency;
      for (const [field, matches] of Object.entries(consistency)) {
        if (matches === false) {
          flags.push(`MRZ field mismatch: ${field}`);
        }
      }
      documentNumber ??= mrz.parsed.documentNumber;
      nationality ??= mrz.parsed.nationality;
      dateOfBirth ??= mrz.parsed.dateOfBirth;
      expiryDate ??= mrz.parsed.expiryDate;
      if (!holderName) holderName = mrzName;
    }
    flags.push(mrz.status === "MRZ_VALID" ? "Passport MRZ validated" : `Passport MRZ ${mrz.status.toLowerCase()}`);
    for (const issue of mrz.issues) flags.push(`MRZ: ${issue.message}`);
  }

  return {
    documentType,
    documentNumber,
    holderName,
    nationality,
    dateOfBirth,
    expiryDate,
    expiryStatus: expiryStatus(expiryDate),
    mrz,
    flags,
  };
}
