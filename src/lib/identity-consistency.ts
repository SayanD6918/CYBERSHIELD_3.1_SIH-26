import type { CaseRecord, DatabaseVerification } from "./types";

type IdentityRecord = {
  documentNumber: string;
  name: string;
  dateOfBirth: string;
  nationality: string;
  expiryDate: string;
  status: "ACTIVE" | "REVOKED";
};

// Hackathon-only authoritative-source simulator.
const MOCK_IDENTITY_DB: IdentityRecord[] = [
  {
    documentNumber: "P1234567",
    name: "Rahul Sharma",
    dateOfBirth: "2001-05-14",
    nationality: "Indian",
    expiryDate: "2031-05-14",
    status: "ACTIVE",
  },
];

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function verifyAgainstMockDatabase(record: Pick<CaseRecord, "documentNumber" | "holderName" | "dateOfBirth" | "nationality" | "expiryDate">): DatabaseVerification {
  if (!record.documentNumber || record.documentNumber === "UNKNOWN") {
    return { status: "unavailable", matchedFields: 0, mismatchedFields: 0, issues: ["No document number available for lookup"] };
  }

  const found = MOCK_IDENTITY_DB.find((item) => normalize(item.documentNumber) === normalize(record.documentNumber));
  if (!found) {
    return { status: "review", matchedFields: 0, mismatchedFields: 0, issues: ["No matching mock authoritative record"] };
  }

  const pairs: [string, string | null | undefined, string][] = [
    ["name", record.holderName, found.name],
    ["date of birth", record.dateOfBirth, found.dateOfBirth],
    ["nationality", record.nationality, found.nationality],
    ["expiry", record.expiryDate, found.expiryDate],
  ];

  const issues: string[] = [];
  let matchedFields = 1; // document number
  let mismatchedFields = 0;

  for (const [field, actual, expected] of pairs) {
    if (!actual) continue;
    if (normalize(actual) === normalize(expected)) matchedFields += 1;
    else {
      mismatchedFields += 1;
      issues.push(`${field} mismatch`);
    }
  }

  if (found.status !== "ACTIVE") {
    mismatchedFields += 1;
    issues.push(`record status is ${found.status}`);
  } else {
    matchedFields += 1;
  }

  return {
    status: mismatchedFields > 0 ? "fail" : "passed",
    matchedFields,
    mismatchedFields,
    issues,
  };
}
