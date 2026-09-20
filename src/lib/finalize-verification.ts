import type { CaseRecord, BiometricResult, DatabaseVerification, ScanCheck, IdentityEvidence, DocumentEvidence, MRZEvidence, FaceEvidence, LivenessEvidence, ChallengeEvidence } from "./types.ts";
import { calculateRisk } from "./risk-engine.ts";
import { createIdentityProvider } from "./identity-provider.ts";
import { DEMO_MODE } from "./verification-config.ts";

function statusFrom(value: string | undefined, fallback: "passed" | "review" | "fail" | "unavailable" | "unknown") {
  return value === "passed" || value === "review" || value === "fail" || value === "unavailable" ? value : fallback;
}

export type FinalizeOptions = {
  /** Officer setting: send watchlist hits straight to the hold lane. */
  autoHoldWatchlist?: boolean;
};

export function finalizeVerification(
  record: Omit<CaseRecord, "id" | "createdAt">,
  biometric: BiometricResult,
  options: FinalizeOptions = {},
): Omit<CaseRecord, "id" | "createdAt"> {
  const identityProvider = createIdentityProvider(DEMO_MODE);
  const databaseVerification: DatabaseVerification = identityProvider.verify(record);

  const document: DocumentEvidence = record.evidence?.document ?? {
    status: "review",
    confidence: null,
    method: "Document evidence unavailable",
    issues: ["Document evidence unavailable"],
    documentType: record.documentType,
    documentNumber: record.documentNumber,
    fields: {
      holderName: record.holderName,
      nationality: record.nationality,
      dateOfBirth: record.dateOfBirth,
      expiryDate: record.expiryDate,
    },
  };
  const mrz: MRZEvidence = record.evidence?.mrz ?? {
    status: "unavailable", confidence: null, method: "MRZ evidence unavailable", issues: ["MRZ evidence unavailable"],
    format: "unknown", detected: false, lines: 0,
    checks: { documentNumber: null, dateOfBirth: null, expiryDate: null, optionalData: null, composite: null },
    fieldConsistency: { documentNumber: null, nationality: null, dateOfBirth: null, expiryDate: null, holderName: null },
  };
  const face: FaceEvidence = biometric.evidence?.face ?? {
    status: biometric.faceMatchStatus === "MATCH" ? "passed" : biometric.faceMatchStatus === "NO_MATCH" ? "fail" : "unavailable",
    confidence: biometric.faceSimilarity, method: "Face comparison", issues: [],
    similarity: biometric.faceSimilarity, threshold: biometric.faceThreshold, source: "comparison",
  };
  const liveness: LivenessEvidence = biometric.evidence?.liveness ?? {
    status: biometric.livenessStatus === "LIVE" ? "passed" : biometric.livenessStatus === "SPOOF" ? "fail" : "unavailable",
    confidence: biometric.livenessConfidence, method: "Passive PAD", issues: [],
    livenessConfidence: biometric.livenessConfidence, spoofProbability: null, source: "passive",
  };
  const challenge: ChallengeEvidence = biometric.evidence?.challenge ?? {
    status: "unavailable", confidence: null, method: "Active challenge unavailable", issues: ["Active challenge unavailable"],
    challenge: biometric.challenge ?? null, completed: false, challengeStatus: "NOT_RUN", measurements: {}, source: "active",
  };
  const identity: IdentityEvidence = {
    status: statusFrom(databaseVerification.status, "unavailable"),
    confidence: databaseVerification.authoritative ? 1 : null,
    method: databaseVerification.provider ?? "Identity provider",
    issues: databaseVerification.issues,
    provider: databaseVerification.provider ?? "UNVERIFIED",
    authoritative: databaseVerification.authoritative === true,
    provenance: databaseVerification.provenance ?? "REAL",
    matchedFields: databaseVerification.matchedFields,
    mismatchedFields: databaseVerification.mismatchedFields,
    measurements: { authoritative: databaseVerification.authoritative === true },
  };

  const expiryStatus = record.expiryDate
    ? (record.checks.find((c) => c.id === "expiry")?.status === "fail" ? "expired" : record.checks.find((c) => c.id === "expiry")?.status === "passed" ? "valid" : "unknown")
    : "unknown";
  const ocrConfidence = document.confidence;
  const tamperStatus = statusFrom(record.checks.find((c) => c.id === "tamper")?.status, "unknown");

  const risk = calculateRisk({
    document,
    mrz,
    face,
    liveness,
    challenge,
    identity,
    watchlistHit: record.watchlistHit,
    expiryStatus,
    ocrConfidence,
    tamperStatus: tamperStatus === "unavailable" ? "unknown" : tamperStatus,
    autoHoldWatchlist: options.autoHoldWatchlist,
  });

  const checks: ScanCheck[] = [
    ...record.checks.filter((c) => !["face", "liveness", "active-challenge", "database", "mrz"].includes(c.id)),
    { id: "mrz", label: "MRZ validation", status: mrz.status === "unknown" ? "review" : mrz.status, detail: mrz.issues.length ? mrz.issues.join("; ") : mrz.detected ? "ICAO check digits and field consistency evaluated" : "Not detected" },
    { id: "face", label: "Face match", status: face.status === "unknown" ? "review" : face.status, detail: face.similarity == null ? "No similarity score" : `Similarity ${face.similarity.toFixed(4)} · distance ${face.distance == null ? "—" : face.distance.toFixed(4)}` },
    { id: "liveness", label: "Passive liveness", status: liveness.status === "unknown" ? "review" : liveness.status, detail: liveness.livenessConfidence == null ? "No confidence" : `Classifier confidence ${liveness.livenessConfidence.toFixed(2)} (uncalibrated)` },
    { id: "active-challenge", label: "Active challenge", status: challenge.status === "unknown" ? "review" : challenge.status, detail: challenge.failureReason ?? (challenge.challengeStatus === "PASSED" ? "Movement verified" : "Not confirmed") },
    { id: "identity", label: "Identity record", status: identity.status === "unknown" ? "review" : identity.status, detail: `${identity.provider} · ${identity.authoritative ? "authoritative" : "not authoritative"}` },
    { id: "watchlist", label: "Watchlist", status: record.watchlistHit ? "fail" : "passed", detail: record.watchlistHit ? "Potential match detected" : "No configured watchlist match" },
  ];

  const flags = [...record.flags, ...risk.reasons.filter((r) => !record.flags.includes(r))];
  return {
    ...record,
    provenance: record.provenance ?? "REAL",
    finalDecision: risk.finalDecision,
    biometric,
    databaseVerification,
    evidence: { document, mrz, face, liveness, challenge, identity, risk: risk.evidence },
    riskScore: risk.score,
    decision: risk.decision,
    checks,
    flags,
    rationale: risk.reasons.length ? risk.reasons.join(". ") + "." : "All required evidence passed fusion.",
  };
}
