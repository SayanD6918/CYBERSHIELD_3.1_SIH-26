import type { CaseRecord, DatabaseVerification } from "./types.ts";

export type IdentityProviderResult = DatabaseVerification & {
  provider: string;
  authoritative: boolean;
  provenance: "REAL" | "DEMO";
};

export interface IdentityProvider {
  verify(
    record: Pick<CaseRecord, "documentNumber" | "holderName" | "dateOfBirth" | "nationality" | "expiryDate">,
  ): IdentityProviderResult;
}

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Real provider boundary. Replace this implementation with an authorised
 * government/issuer integration when credentials and an actual endpoint are
 * available. It deliberately never fabricates an identity result.
 */
export class UnverifiedIdentityProvider implements IdentityProvider {
  verify(_record: Pick<CaseRecord, "documentNumber" | "holderName" | "dateOfBirth" | "nationality" | "expiryDate">): IdentityProviderResult {
    return {
      status: "unavailable",
      matchedFields: 0,
      mismatchedFields: 0,
      issues: ["No authoritative identity provider is configured"],
      provider: "UNVERIFIED",
      authoritative: false,
      provenance: "REAL",
    };
  }
}

type DemoIdentityRecord = {
  documentNumber: string;
  name: string;
  dateOfBirth: string;
  nationality: string;
  expiryDate: string;
  status: "ACTIVE" | "REVOKED";
};

const DEMO_IDENTITY_DB: DemoIdentityRecord[] = [
  {
    documentNumber: "P1234567",
    name: "Rahul Sharma",
    dateOfBirth: "2001-05-14",
    nationality: "Indian",
    expiryDate: "2031-05-14",
    status: "ACTIVE",
  },
];

/** Explicitly non-authoritative demo provider. Never use this in normal mode. */
export class DemoIdentityProvider implements IdentityProvider {
  verify(record: Pick<CaseRecord, "documentNumber" | "holderName" | "dateOfBirth" | "nationality" | "expiryDate">): IdentityProviderResult {
    if (!record.documentNumber || record.documentNumber === "UNKNOWN") {
      return {
        status: "unavailable", matchedFields: 0, mismatchedFields: 0,
        issues: ["No document number available for demo lookup"],
        provider: "DEMO / MOCK", authoritative: false, provenance: "DEMO",
      };
    }

    const found = DEMO_IDENTITY_DB.find((item) => normalize(item.documentNumber) === normalize(record.documentNumber));
    if (!found) {
      return {
        status: "review", matchedFields: 0, mismatchedFields: 0,
        issues: ["No matching demo record"],
        provider: "DEMO / MOCK", authoritative: false, provenance: "DEMO",
      };
    }

    const pairs: [string, string | null | undefined, string][] = [
      ["name", record.holderName, found.name],
      ["date of birth", record.dateOfBirth, found.dateOfBirth],
      ["nationality", record.nationality, found.nationality],
      ["expiry", record.expiryDate, found.expiryDate],
    ];
    const issues: string[] = [];
    let matchedFields = 1;
    let mismatchedFields = 0;

    for (const [field, actual, expected] of pairs) {
      if (!actual) continue;
      if (normalize(actual) === normalize(expected)) matchedFields += 1;
      else { mismatchedFields += 1; issues.push(`${field} mismatch`); }
    }

    if (found.status !== "ACTIVE") {
      mismatchedFields += 1;
      issues.push(`record status is ${found.status}`);
    } else matchedFields += 1;

    return {
      status: mismatchedFields > 0 ? "fail" : "passed",
      matchedFields,
      mismatchedFields,
      issues: [...issues, "DEMO / MOCK identity data — not authoritative"],
      provider: "DEMO / MOCK",
      authoritative: false,
      provenance: "DEMO",
    };
  }
}

export function createIdentityProvider(demoMode: boolean): IdentityProvider {
  return demoMode ? new DemoIdentityProvider() : new UnverifiedIdentityProvider();
}
