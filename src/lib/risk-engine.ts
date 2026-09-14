import type { Decision } from "./types";

export type RiskInputs = {
  ocrConfidence: number;
  expiryStatus: "valid" | "expired" | "unknown";
  tamperStatus: "passed" | "review" | "fail" | "unknown";
  faceStatus: "passed" | "review" | "fail" | "unknown";
  livenessStatus: "passed" | "review" | "fail" | "unavailable";
  databaseStatus: "passed" | "review" | "fail" | "unavailable";
  documentTypeKnown: boolean;
  documentNumberPresent: boolean;
  holderNamePresent: boolean;
  nationalityPresent: boolean;
  dobPresent: boolean;
  expiryDatePresent: boolean;
  watchlistHit: boolean;
};

export type RiskResult = {
  score: number;
  decision: Decision;
  reasons: string[];
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

export function calculateRisk(inputs: RiskInputs): RiskResult {
  let score = 0;
  const reasons: string[] = [];

  const ocr = clamp(inputs.ocrConfidence);
  if (ocr < 60) { score += 10; reasons.push("Low OCR confidence"); }
  else if (ocr < 85) { score += 5; reasons.push("Moderate OCR confidence"); }

  if (inputs.expiryStatus === "expired") { score += 15; reasons.push("Document is expired"); }
  else if (inputs.expiryStatus === "unknown") { score += 7; reasons.push("Document expiry could not be confirmed"); }

  if (inputs.tamperStatus === "fail") { score += 20; reasons.push("Possible document tampering detected"); }
  else if (inputs.tamperStatus === "review") { score += 10; reasons.push("Document requires tamper review"); }

  if (inputs.databaseStatus === "fail") { score += 20; reasons.push("Authoritative identity data mismatch"); }
  else if (inputs.databaseStatus === "review") { score += 8; reasons.push("Identity data requires database review"); }
  else if (inputs.databaseStatus === "unavailable") { score += 5; reasons.push("Authoritative identity check unavailable"); }

  if (inputs.faceStatus === "fail") { score += 15; reasons.push("Face comparison failed"); }
  else if (inputs.faceStatus === "review") { score += 7; reasons.push("Face comparison requires review"); }

  if (inputs.livenessStatus === "fail") { score += 20; reasons.push("Liveness check failed"); }
  else if (inputs.livenessStatus === "unavailable") { score += 5; reasons.push("Liveness could not be evaluated"); }
  else if (inputs.livenessStatus === "review") { score += 8; reasons.push("Liveness is uncertain"); }

  if (!inputs.documentTypeKnown) { score += 10; reasons.push("Document type could not be identified"); }

  const missingFields = [
    !inputs.documentNumberPresent,
    !inputs.holderNamePresent,
    !inputs.nationalityPresent,
    !inputs.dobPresent,
    !inputs.expiryDatePresent,
  ].filter(Boolean).length;
  if (missingFields > 0) {
    score += Math.min(15, missingFields * 3);
    reasons.push(`${missingFields} document field(s) could not be confirmed`);
  }

  if (inputs.watchlistHit) { score += 25; reasons.push("Watchlist match detected"); }

  const criticalRisk =
    inputs.watchlistHit ||
    inputs.tamperStatus === "fail" ||
    inputs.livenessStatus === "fail" ||
    inputs.databaseStatus === "fail" ||
    inputs.faceStatus === "fail";

  if (criticalRisk) score = Math.max(score, 70);
  score = clamp(Math.round(score));

  const decision: Decision = score >= 70 ? "hold" : score >= 35 ? "manual" : "safe";
  return { score, decision, reasons };
}
