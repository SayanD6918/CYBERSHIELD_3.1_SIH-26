import type { CaseRecord, BiometricResult, DatabaseVerification, ScanCheck } from "./types";
import { calculateRisk } from "./risk-engine";
import { verifyAgainstMockDatabase } from "./identity-consistency";

export function finalizeVerification(
  record: Omit<CaseRecord, "id" | "createdAt">,
  biometric: BiometricResult,
): Omit<CaseRecord, "id" | "createdAt"> {
  const databaseVerification: DatabaseVerification = verifyAgainstMockDatabase(record);

  const risk = calculateRisk({
    ocrConfidence: Number(record.checks.find((c) => c.id === "ocr")?.detail.match(/\d+/)?.[0] ?? 0),
    expiryStatus: record.checks.find((c) => c.id === "expiry")?.status === "passed" ? "valid" : record.expiryDate ? "unknown" : "unknown",
    tamperStatus: record.checks.find((c) => c.id === "tamper")?.status === "fail" ? "fail" : record.checks.find((c) => c.id === "tamper")?.status === "review" ? "review" : "passed",
    faceStatus: biometric.faceMatchStatus === "NO_MATCH" ? "fail" : biometric.faceMatchStatus === "UNCERTAIN" || biometric.faceMatchStatus === "UNAVAILABLE" ? "review" : "passed",
    livenessStatus: biometric.livenessStatus === "SPOOF" ? "fail" : biometric.livenessStatus === "UNCERTAIN" || biometric.livenessStatus === "UNAVAILABLE" ? "unavailable" : "passed",
    databaseStatus: databaseVerification.status,
    documentTypeKnown: record.documentType !== "unknown",
    documentNumberPresent: record.documentNumber !== "UNKNOWN",
    holderNamePresent: Boolean(record.holderName),
    nationalityPresent: Boolean(record.nationality),
    dobPresent: Boolean(record.dateOfBirth),
    expiryDatePresent: Boolean(record.expiryDate),
    watchlistHit: record.watchlistHit,
  });

  const checks: ScanCheck[] = [
    ...record.checks.filter((c) => c.id !== "face" && c.id !== "liveness"),
    {
      id: "database",
      label: "Identity database",
      status: databaseVerification.status === "fail" ? "fail" : databaseVerification.status === "passed" ? "passed" : "review",
      detail: databaseVerification.issues.length ? databaseVerification.issues.join("; ") : `${databaseVerification.matchedFields} fields matched`,
    },
    {
      id: "liveness",
      label: "Liveness detection",
      status: biometric.livenessStatus === "LIVE" ? "passed" : biometric.livenessStatus === "SPOOF" ? "fail" : "review",
      detail: biometric.livenessConfidence == null ? biometric.livenessStatus : `${Math.round(biometric.livenessConfidence * 100)}% live confidence`,
    },
    {
      id: "face",
      label: "Face match",
      status: biometric.faceMatchStatus === "MATCH" ? "passed" : biometric.faceMatchStatus === "NO_MATCH" ? "fail" : "review",
      detail: biometric.faceSimilarity == null ? biometric.faceMatchStatus : `${Math.round(biometric.faceSimilarity * 100)}% similarity`,
    },
  ];

  const flags = [...record.flags, ...risk.reasons.filter((r) => !record.flags.includes(r))];
  return {
    ...record,
    biometric,
    databaseVerification,
    riskScore: risk.score,
    decision: risk.decision,
    checks,
    flags,
    rationale: risk.reasons.length ? risk.reasons.join(". ") + "." : "All available verification signals are consistent.",
  };
}
