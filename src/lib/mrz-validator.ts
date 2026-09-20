export type MRZValidationStatus = "MRZ_VALID" | "MRZ_INVALID" | "MRZ_INCOMPLETE";

export type MRZValidationIssue = {
  field: string;
  message: string;
};

export type TD3MRZ = {
  line1: string;
  line2: string;
  documentCode: string;
  issuingState: string;
  surname: string | null;
  givenNames: string | null;
  documentNumber: string | null;
  nationality: string | null;
  dateOfBirth: string | null;
  sex: string | null;
  expiryDate: string | null;
  optionalData: string | null;
};

export type MRZValidationResult = {
  status: MRZValidationStatus;
  issues: MRZValidationIssue[];
  parsed: TD3MRZ | null;
  checks: {
    documentNumber: boolean | null;
    dateOfBirth: boolean | null;
    expiryDate: boolean | null;
    optionalData: boolean | null;
    composite: boolean | null;
  };
  fieldConsistency?: {
    documentNumber: boolean | null;
    nationality: boolean | null;
    dateOfBirth: boolean | null;
    expiryDate: boolean | null;
    holderName: boolean | null;
  };
};

const TD3_LENGTH = 44;

function normalizeLine(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

function decodeMrzDate(value: string): string | null {
  if (!/^\d{6}$/.test(value)) return null;
  const yy = Number(value.slice(0, 2));
  const month = value.slice(2, 4);
  const day = value.slice(4, 6);
  const year = yy >= 50 ? 1900 + yy : 2000 + yy;
  const date = new Date(Date.UTC(year, Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== Number(month) ||
    date.getUTCDate() !== Number(day)
  ) {
    return null;
  }
  return `${year.toString().padStart(4, "0")}-${month}-${day}`;
}

function parseName(value: string): { surname: string | null; givenNames: string | null } {
  const parts = value.split("<<");
  const surname = parts[0]?.replace(/<+/g, " ").replace(/\s+/g, " ").trim() || null;
  const givenNames = parts
    .slice(1)
    .join(" ")
    .replace(/<+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || null;
  return { surname, givenNames };
}

function valueOf(char: string): number {
  if (char >= "0" && char <= "9") return char.charCodeAt(0) - 48;
  if (char >= "A" && char <= "Z") return char.charCodeAt(0) - 55;
  if (char === "<") return 0;
  return -1;
}

function checkDigit(data: string, expected: string): boolean {
  if (!/^\d$/.test(expected)) return false;
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) {
    const value = valueOf(data[i]);
    if (value < 0) return false;
    sum += value * weights[i % 3];
  }
  return sum % 10 === Number(expected);
}

export function validateTD3MRZ(line1Input: string, line2Input: string): MRZValidationResult {
  const line1 = normalizeLine(line1Input);
  const line2 = normalizeLine(line2Input);
  const issues: MRZValidationIssue[] = [];
  const checks = {
    documentNumber: null as boolean | null,
    dateOfBirth: null as boolean | null,
    expiryDate: null as boolean | null,
    optionalData: null as boolean | null,
    composite: null as boolean | null,
  };

  if (line1.length !== TD3_LENGTH || line2.length !== TD3_LENGTH) {
    issues.push({ field: "format", message: "TD3 MRZ must contain two lines of exactly 44 characters." });
    return {
    status: "MRZ_INCOMPLETE",
    issues,
    parsed: null,
    checks,
    fieldConsistency: { documentNumber: null, nationality: null, dateOfBirth: null, expiryDate: null, holderName: null },
  };
  }

  if (!/^P[<A-Z]/.test(line1)) {
    issues.push({ field: "documentCode", message: "TD3 line 1 does not start with a passport document code." });
  }

  const documentCode = line1.slice(0, 2);
  const issuingState = line1.slice(2, 5);
  const { surname, givenNames } = parseName(line1.slice(5));
  const documentNumberRaw = line2.slice(0, 9);
  const documentNumber = documentNumberRaw.replace(/<+$/, "") || null;
  const nationality = line2.slice(10, 13).replace(/</g, "") || null;
  const dateOfBirth = decodeMrzDate(line2.slice(13, 19));
  const sex = line2[20] === "<" ? null : line2[20];
  const expiryDate = decodeMrzDate(line2.slice(21, 27));
  const optionalData = line2.slice(28, 42).replace(/<+$/, "") || null;

  checks.documentNumber = checkDigit(line2.slice(0, 9), line2[9]);
  checks.dateOfBirth = checkDigit(line2.slice(13, 19), line2[19]);
  checks.expiryDate = checkDigit(line2.slice(21, 27), line2[27]);
  checks.optionalData = checkDigit(line2.slice(28, 42), line2[42]);
  checks.composite = checkDigit(
    line2.slice(0, 10) + line2.slice(13, 20) + line2.slice(21, 43),
    line2[43],
  );

  if (!checks.documentNumber) issues.push({ field: "documentNumber", message: "Document-number check digit is invalid." });
  if (!dateOfBirth) issues.push({ field: "dateOfBirth", message: "MRZ date of birth is invalid." });
  if (!checks.dateOfBirth) issues.push({ field: "dateOfBirth", message: "Date-of-birth check digit is invalid." });
  if (!expiryDate) issues.push({ field: "expiryDate", message: "MRZ expiry date is invalid." });
  if (!checks.expiryDate) issues.push({ field: "expiryDate", message: "Expiry-date check digit is invalid." });
  if (!checks.optionalData) issues.push({ field: "optionalData", message: "Optional-data check digit is invalid." });
  if (!checks.composite) issues.push({ field: "composite", message: "Composite check digit is invalid." });
  if (!nationality) issues.push({ field: "nationality", message: "Nationality field is empty or incomplete." });

  const parsed: TD3MRZ = {
    line1,
    line2,
    documentCode,
    issuingState,
    surname,
    givenNames,
    documentNumber,
    nationality,
    dateOfBirth,
    sex,
    expiryDate,
    optionalData,
  };

  const status: MRZValidationStatus = issues.length === 0 ? "MRZ_VALID" : "MRZ_INVALID";
  return {
    status,
    issues,
    parsed,
    checks,
    fieldConsistency: { documentNumber: null, nationality: null, dateOfBirth: null, expiryDate: null, holderName: null },
  };
}
