import type {
  DocumentEvidence,
  FinalDecision,
  IdentityEvidence,
  LivenessEvidence,
  ChallengeEvidence,
  FaceEvidence,
  MRZEvidence,
  RiskEvidence,
} from "./types.ts";

export type RiskEvidenceBundle = {
  document: DocumentEvidence;
  mrz: MRZEvidence;
  face: FaceEvidence;
  liveness: LivenessEvidence;
  challenge: ChallengeEvidence;
  identity: IdentityEvidence;
  watchlistHit: boolean;
  expiryStatus: "valid" | "expired" | "unknown";
  ocrConfidence: number | null;
  tamperStatus: "passed" | "review" | "fail" | "unknown";
  /**
   * Officer setting. A watchlist hit always needs a human either way; this
   * decides whether the case lands in the hold lane immediately or in the
   * ordinary manual-review queue.
   */
  autoHoldWatchlist?: boolean;
};

export type RiskResult = {
  score: number;
  decision: "safe" | "manual" | "hold";
  finalDecision: FinalDecision;
  reasons: string[];
  evidence: RiskEvidence;
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

export function calculateRisk(evidence: RiskEvidenceBundle): RiskResult {
  let score = 0;
  const reasons: string[] = [];

  const ocr = evidence.ocrConfidence == null ? null : clamp(evidence.ocrConfidence);
  if (ocr == null) {
    score += 8;
    reasons.push("OCR confidence is unavailable");
  } else if (ocr < 60) {
    score += 12;
    reasons.push("Low OCR confidence");
  } else if (ocr < 85) {
    score += 5;
    reasons.push("Moderate OCR confidence");
  }

  if (evidence.document.status === "fail") {
    score += 20;
    reasons.push("Document evidence failed");
  } else if (evidence.document.status !== "passed") {
    score += 8;
    reasons.push("Document evidence requires review");
  }

  if (evidence.mrz.status === "fail") {
    score += 20;
    reasons.push("MRZ validation failed");
  } else if (evidence.mrz.status !== "passed") {
    score += 8;
    reasons.push("MRZ validation is not confirmed");
  }

  if (evidence.expiryStatus === "expired") {
    score += 15;
    reasons.push("Document is expired");
  } else if (evidence.expiryStatus === "unknown") {
    score += 7;
    reasons.push("Document expiry could not be confirmed");
  }

  if (evidence.tamperStatus === "fail") {
    score += 20;
    reasons.push("Possible document tampering detected");
  } else if (evidence.tamperStatus !== "passed") {
    score += 8;
    reasons.push("Visual tamper status requires review");
  }

  if (evidence.face.status === "fail") {
    score += 20;
    reasons.push("Face comparison failed");
  } else if (evidence.face.status !== "passed") {
    score += 8;
    reasons.push("Face comparison is not confirmed");
  }

  // Passive PAD is a mandatory biometric signal whenever the production
  // verification flow invokes it. SPOOF is a definitive presentation-attack
  // signal; UNCERTAIN/UNAVAILABLE means evidence is insufficient, not spoof.
  if (evidence.liveness.status === "fail") {
    score += 30;
    reasons.push("Passive PAD detected a presentation attack");
  } else if (evidence.liveness.status !== "passed") {
    score += 10;
    reasons.push("Passive PAD is not confirmed");
  }

  // The active challenge is also mandatory in challenge-enabled mode. A
  // timeout/face-loss is review evidence; an explicit challenge rejection is
  // a failed required check.
  const challengeFailureReason = evidence.challenge.issues.join(" ");
  const challengeInsufficient = /TIMEOUT|FACE_LOSS|NO_FACE|NOT_ESTABLISHED|MODEL_UNAVAILABLE|UNAVAILABLE|INSUFFICIENT|INVALID_IMAGE/i.test(challengeFailureReason);
  if (evidence.challenge.status === "fail") {
    if (challengeInsufficient) {
      score += 10;
      reasons.push("Active challenge evidence is insufficient");
    } else {
      score += 25;
      reasons.push("Active challenge failed");
    }
  } else if (evidence.challenge.status !== "passed") {
    score += 10;
    reasons.push("Active challenge is not confirmed");
  }

  if (evidence.identity.status === "fail") {
    score += 20;
    reasons.push("Identity provider returned a mismatch");
  } else if (!evidence.identity.authoritative) {
    score += 8;
    reasons.push("Authoritative identity verification is unavailable");
  } else if (evidence.identity.status !== "passed") {
    score += 8;
    reasons.push("Identity record requires review");
  }

  if (evidence.watchlistHit) {
    score += 25;
    reasons.push("Watchlist match detected");
  }

  const hardFailure =
    evidence.document.status === "fail" ||
    evidence.mrz.status === "fail" ||
    evidence.expiryStatus === "expired" ||
    evidence.tamperStatus === "fail" ||
    evidence.face.status === "fail" ||
    evidence.liveness.status === "fail" ||
    (evidence.challenge.status === "fail" && !challengeInsufficient) ||
    evidence.identity.status === "fail";

  const reviewNeeded =
    evidence.document.status !== "passed" ||
    evidence.mrz.status !== "passed" ||
    evidence.expiryStatus !== "valid" ||
    evidence.tamperStatus !== "passed" ||
    evidence.face.status !== "passed" ||
    evidence.liveness.status !== "passed" ||
    evidence.challenge.status !== "passed" ||
    !evidence.identity.authoritative ||
    evidence.identity.status !== "passed";

  if (hardFailure) score = Math.max(score, 70);
  else if (reviewNeeded) score = Math.max(score, 35);
  if (evidence.watchlistHit && !hardFailure) score = Math.max(score, 55);

  score = clamp(Math.round(score));

  // Security-sensitive failures take precedence over routing signals. A
  // watchlist hit remains visible and reviewable, but it must not downgrade a
  // confirmed presentation attack or hard biometric/document failure into a
  // softer lane. This ordering is deterministic and covered by regression tests.
  let finalDecision: FinalDecision;
  if (evidence.liveness.status === "fail") finalDecision = "NOT_VERIFIED";
  else if (hardFailure) finalDecision = "NOT_VERIFIED";
  else if (evidence.watchlistHit) finalDecision = "MANUAL_REVIEW";
  else if (!evidence.identity.authoritative || reviewNeeded) finalDecision = "UNCERTAIN";
  else finalDecision = "VERIFIED";

  const autoHold = evidence.autoHoldWatchlist !== false;
  const decision: RiskResult["decision"] =
    finalDecision === "VERIFIED"
      ? "safe"
      : finalDecision === "NOT_VERIFIED"
        ? "hold"
        : finalDecision === "MANUAL_REVIEW" && evidence.watchlistHit && autoHold
          ? "hold"
          : "manual";

  const riskEvidence: RiskEvidence = {
    status: finalDecision === "VERIFIED" ? "passed" : finalDecision === "NOT_VERIFIED" ? "fail" : "review",
    confidence: finalDecision === "VERIFIED" ? 1 : null,
    method: "Structured evidence fusion + rule-based risk engine",
    issues: reasons,
    score,
    decision,
    finalDecision,
    reasons,
    measurements: {
      evidenceComplete: !reviewNeeded,
      hardFailure,
      watchlistHit: evidence.watchlistHit,
      autoHoldWatchlist: autoHold,
      identityAuthoritative: evidence.identity.authoritative,
      livenessPassed: evidence.liveness.status === "passed",
      challengePassed: evidence.challenge.status === "passed",
    },
  };

  return { score, decision, finalDecision, reasons, evidence: riskEvidence };
}
