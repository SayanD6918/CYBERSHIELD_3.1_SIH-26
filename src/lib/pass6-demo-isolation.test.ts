import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DemoIdentityProvider, UnverifiedIdentityProvider } from "./identity-provider.ts";
import { finalizeVerification } from "./finalize-verification.ts";
import { isDemoMode } from "./verification-config.ts";
import type { BiometricResult } from "./types.ts";

const record = {
  documentType: "passport",
  documentNumber: "P1234567",
  holderName: "Rahul Sharma",
  nationality: "Indian",
  dateOfBirth: "2001-05-14",
  expiryDate: "2031-05-14",
  riskScore: 0,
  decision: "safe" as const,
  checks: [
    { id: "ocr", label: "OCR & data extraction", status: "passed" as const, detail: "98% confidence" },
    { id: "expiry", label: "Document expiry", status: "passed" as const, detail: "Valid" },
    { id: "tamper", label: "Tamper analysis", status: "passed" as const, detail: "No anomalies" },
  ],
  rationale: "",
  flags: [],
  fileName: "real-capture.jpg",
  watchlistHit: false,
};

const realBiometric: BiometricResult = {
  provenance: "REAL",
  livenessStatus: "LIVE",
  livenessConfidence: 0.91,
  faceMatchStatus: "MATCH",
  faceSimilarity: 0.86,
  faceThreshold: 0.8,
  challenge: "Turn your head left",
  evidence: {
    challenge: {
      status: "passed",
      confidence: 0.88,
      method: "YuNet-5-landmark + solvePnP",
      issues: [],
      challenge: "Turn your head left",
      completed: true,
      requestedAction: "TURN_LEFT",
      challengeStatus: "PASSED",
      movementDetected: true,
      measurements: { validPoseFrames: 20 },
    },
  },
};

describe("PASS 6 demo isolation", () => {
  it("enables demo only for the explicit true value", () => {
    assert.equal(isDemoMode("true"), true);
    assert.equal(isDemoMode("false"), false);
    assert.equal(isDemoMode(undefined), false);
    assert.equal(isDemoMode("TRUE"), false);
  });

  it("normal identity provider cannot manufacture a biometric/identity match", () => {
    const result = new UnverifiedIdentityProvider().verify(record);
    assert.equal(result.status, "unavailable");
    assert.equal(result.authoritative, false);
    assert.equal(result.provenance, "REAL");
    assert.equal(result.provider, "UNVERIFIED");
    assert.equal(result.matchedFields, 0);
  });

  it("demo identity data is explicitly non-authoritative", () => {
    const result = new DemoIdentityProvider().verify(record);
    assert.equal(result.status, "passed");
    assert.equal(result.authoritative, false);
    assert.equal(result.provenance, "DEMO");
    assert.equal(result.provider, "DEMO / MOCK");
    assert.match(result.issues.join(" "), /not authoritative/i);
  });

  it("mock identity data cannot produce authoritative verification", () => {
    const result = new DemoIdentityProvider().verify(record);
    assert.notEqual(result.authoritative, true);
    assert.equal(result.provenance, "DEMO");
  });

  it("real biometric results reach the final verification pipeline", () => {
    const finalized = finalizeVerification(record, realBiometric);
    assert.equal(finalized.provenance, "REAL");
    assert.equal(finalized.biometric?.provenance, "REAL");
    assert.equal(finalized.biometric?.livenessStatus, "LIVE");
    assert.equal(finalized.biometric?.faceMatchStatus, "MATCH");
    assert.equal(finalized.biometric?.faceSimilarity, 0.86);
    assert.equal(finalized.biometric?.evidence?.challenge?.challengeStatus, "PASSED");
    assert.equal(finalized.databaseVerification?.authoritative, false);
    assert.equal(finalized.databaseVerification?.provider, "UNVERIFIED");
    assert.equal(finalized.checks.find((check) => check.id === "liveness")?.status, "passed");
    assert.equal(finalized.checks.find((check) => check.id === "face")?.status, "passed");
    assert.equal(finalized.checks.find((check) => check.id === "active-challenge")?.status, "passed");
  });
});
