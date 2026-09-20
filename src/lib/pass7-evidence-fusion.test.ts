import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateRisk, type RiskEvidenceBundle } from "./risk-engine.ts";

function evidence(overrides: Partial<RiskEvidenceBundle> = {}): RiskEvidenceBundle {
  return {
    document: {
      status: "passed", confidence: 96, method: "quality+ocr", issues: [], documentType: "passport", documentNumber: "P1234567",
      fields: { holderName: "Rahul Sharma", nationality: "Indian", dateOfBirth: "2001-05-14", expiryDate: "2031-05-14" },
      quality: { width: 1800, height: 1200, sharpness: 120, brightness: 128, resolutionOk: true },
    },
    mrz: {
      status: "passed", confidence: 1, method: "TD3 MRZ", issues: [], format: "TD3", detected: true, lines: 2,
      checks: { documentNumber: true, dateOfBirth: true, expiryDate: true, optionalData: true, composite: true },
      fieldConsistency: { documentNumber: true, nationality: true, dateOfBirth: true, expiryDate: true, holderName: true },
    },
    face: {
      status: "passed", confidence: 0.92, method: "SFace", issues: [], similarity: 0.92, distance: 0.08, threshold: 0.8,
      source: "comparison", measurements: { documentEmbeddingGenerated: true, liveEmbeddingGenerated: true },
    },
    liveness: {
      status: "passed", confidence: 0.97, method: "PAD", issues: [], livenessConfidence: 0.97, spoofProbability: 0.03, source: "passive",
    },
    challenge: {
      status: "passed", confidence: 0.94, method: "solvePnP", issues: [], challenge: "TURN_LEFT", completed: true,
      challengeStatus: "PASSED", movementDetected: true, measurements: { validPoseFrames: 20 }, source: "active",
    },
    identity: {
      status: "passed", confidence: 1, method: "authoritative-provider", issues: [], provider: "ISSUER_API", authoritative: true,
      provenance: "REAL", matchedFields: 5, mismatchedFields: 0,
    },
    watchlistHit: false,
    expiryStatus: "valid",
    ocrConfidence: 96,
    tamperStatus: "passed",
    ...overrides,
  };
}

describe("PASS 7 evidence fusion", () => {
  it("returns VERIFIED only when all required evidence is complete", () => {
    const result = calculateRisk(evidence());
    assert.equal(result.finalDecision, "VERIFIED");
    assert.equal(result.decision, "safe");
  });

  it("does not allow face match alone to produce VERIFIED", () => {
    const input = evidence({
      mrz: { ...evidence().mrz, status: "unavailable" },
      liveness: { ...evidence().liveness, status: "unavailable" },
      challenge: { ...evidence().challenge, status: "unavailable" },
      identity: { ...evidence().identity, status: "unavailable", authoritative: false },
    });
    const result = calculateRisk(input);
    assert.notEqual(result.finalDecision, "VERIFIED");
    assert.equal(result.finalDecision, "UNCERTAIN");
  });

  it("does not allow liveness alone to produce VERIFIED", () => {
    const input = evidence({
      document: { ...evidence().document, status: "review" },
      face: { ...evidence().face, status: "unavailable" },
      challenge: { ...evidence().challenge, status: "unavailable" },
      identity: { ...evidence().identity, status: "unavailable", authoritative: false },
    });
    const result = calculateRisk(input);
    assert.notEqual(result.finalDecision, "VERIFIED");
  });

  it("turns a hard biometric/document failure into NOT_VERIFIED", () => {
    const result = calculateRisk(evidence({ face: { ...evidence().face, status: "fail", issues: ["Face mismatch"] } }));
    assert.equal(result.finalDecision, "NOT_VERIFIED");
    assert.equal(result.decision, "hold");
  });

  it("routes a watchlist hit to MANUAL_REVIEW when there is no other hard failure", () => {
    const result = calculateRisk(evidence({ watchlistHit: true }));
    assert.equal(result.finalDecision, "MANUAL_REVIEW");
  });
});
