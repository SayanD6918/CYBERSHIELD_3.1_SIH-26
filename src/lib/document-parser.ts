import { validateTD3MRZ, type MRZValidationResult } from "./mrz-validator.ts";
import type { DocumentType } from "./types.ts";

export type ParsedDocument = {
  documentType: DocumentType;
  documentNumber: string | null;
  holderName: string | null;
  nationality: string | null;
  dateOfBirth: string | null;
  expiryDate: string | null;
  expiryStatus: "valid" | "expired" | "unknown";
  mrz: MRZValidationResult | null;
  flags: string[];
  aadhaarNumberStatus: "full" | "masked" | "not_detected";
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



function normalizeOcrText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[|]/g, "i")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u00a0]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractAadhaarNumber(text: string): { value: string | null; status: "full" | "masked" | "not_detected" } {
  const normalized = normalizeOcrText(text);

  // Prefer grouped forms because they are common in printed/PVC/e-Aadhaar
  // documents and are less likely to accidentally join unrelated digits.
  const groupedFull = normalized.match(/(?<!\d)(\d{4})[ -]?(\d{4})[ -]?(\d{4})(?!\d)/);
  if (groupedFull) {
    return {
      value: `XXXX-XXXX-${groupedFull[3]}`,
      status: "full",
    };
  }

  // Masked Aadhaar is evidence of an Aadhaar number field, not a complete
  // Aadhaar number. Preserve only the masked representation.
  const masked = normalized.match(
    /(?<![a-z0-9])(?:x{4}|\*{4}|•{4})[ -]?(?:x{4}|\*{4}|•{4})[ -]?(\d{4}|x{4}|\*{4}|•{4})(?![a-z0-9])/i,
  );
  if (masked) {
    const last = /^\d{4}$/.test(masked[1]) ? masked[1] : "XXXX";
    return { value: `XXXX-XXXX-${last}`, status: "masked" };
  }

  // OCR sometimes removes the separators entirely.
  const compactFull = normalized.match(/(?<!\d)(\d{12})(?!\d)/);
  if (compactFull) {
    return {
      value: `XXXX-XXXX-${compactFull[1].slice(-4)}`,
      status: "full",
    };
  }

  return { value: null, status: "not_detected" };
}

function aadhaarSignals(text: string): { score: number; signals: string[]; numberStatus: "full" | "masked" | "not_detected"; maskedNumber: string | null } {
  const normalized = normalizeOcrText(text);
  const signals: string[] = [];
  let score = 0;

  // Tesseract can distort the exact word, so accept common OCR variants
  // rather than requiring one literal "Aadhaar" token.
  if (/\ba+d+h+[a4]{1,2}r\b/i.test(normalized) || /a+d+h+[a4]{1,2}r/i.test(normalized)) {
    score += 3;
    signals.push("AADHAAR_TEXT");
  }
  if (/unique\s+identification\s+authority\s+of\s+india/i.test(normalized) || /u+i+d+a+i/i.test(normalized)) {
    score += 3;
    signals.push("UIDAI_MARKER");
  }
  if (/आधार/u.test(text)) {
    score += 3;
    signals.push("AADHAAR_HINDI");
  }
  if (/government\s+of\s+india/i.test(normalized) || /gov(?:ernment)?\s+of\s+india/i.test(normalized)) {
    score += 1;
    signals.push("GOVERNMENT_OF_INDIA");
  }

  const number = extractAadhaarNumber(text);
  if (number.status === "full") {
    score += 2;
    signals.push("AADHAAR_NUMBER_FORMAT");
  } else if (number.status === "masked") {
    score += 2;
    signals.push("MASKED_AADHAAR_NUMBER");
  }

  return {
    score,
    signals,
    numberStatus: number.status,
    maskedNumber: number.value,
  };
}

export function maskAadhaarNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 12) return value;
  return `XXXX-XXXX-${digits.slice(-4)}`;
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

  const aadhaar = aadhaarSignals(normalizedText);
  let documentType: ParsedDocument["documentType"] = "unknown";

  // Passport/MRZ recognition remains authoritative for passport-shaped OCR.
  // Aadhaar is selected from several independent signals so one noisy OCR
  // token cannot manufacture an Aadhaar classification.
  if (/\bpassport\b/i.test(normalizedText)) documentType = "passport";
  else if (/\bvisa\b/i.test(normalizedText)) documentType = "visa";
  else if (/\bpermit\b/i.test(normalizedText)) documentType = "permit";
  else if (aadhaar.score >= 3) documentType = "aadhaar";
  else if (/\b(?:national\s+identity\s+card|identity\s+card|id\s+card)\b/i.test(normalizedText)) documentType = "id";
  else if (lines.some((line) => /^P<[A-Z<]{3}/i.test(line.replace(/\s+/g, "")))) documentType = "passport";

  let documentNumber =
    documentType === "aadhaar"
      ? aadhaar.maskedNumber
      : fieldValue(lines, /(?:No\.?|Number|Document\s*No\.?)\s*[:#]?\s*([A-Z0-9<-]+)/i);
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
    aadhaarNumberStatus: documentType === "aadhaar" ? aadhaar.numberStatus : "not_detected",
  };
}
