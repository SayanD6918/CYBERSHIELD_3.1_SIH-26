import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateRisk, type RiskEvidenceBundle } from "./risk-engine.ts";

/** A bundle in which every signal is clean and the provider is authoritative. */
function complete(overrides: Partial<RiskEvidenceBundle> = {}): RiskEvidenceBundle {
  const base: RiskEvidenceBundle = {
    document: {
      status: "passed", confidence: 96, method: "quality+ocr", issues: [],
      documentType: "passport", documentNumber: "P1234567",
      fields: { holderName: "Rahul Sharma", nationality: "Indian", dateOfBirth: "2001-05-14", expiryDate: "2031-05-14" },
    },
    mrz: {
      status: "passed", confidence: 1, method: "TD3 MRZ", issues: [], format: "TD3", detected: true, lines: 2,
      checks: { documentNumber: true, dateOfBirth: true, expiryDate: true, optionalData: true, composite: true },
      fieldConsistency: { documentNumber: true, nationality: true, dateOfBirth: true, expiryDate: true, holderName: true },
    },
    face: {
      status: "passed", confidence: null, method: "SFace", issues: [], similarity: 0.71,
      distance: 0.29, threshold: 0.363, source: "comparison",
    },
    liveness: {
      status: "passed", confidence: 0.97, method: "PAD", issues: [],
      livenessConfidence: 0.97, spoofProbability: 0.03, source: "passive",
    },
    challenge: {
      status: "passed", confidence: 0.94, method: "solvePnP", issues: [],
      challenge: "TURN_LEFT → TURN_RIGHT → LOOK_STRAIGHT", completed: true,
      challengeStatus: "PASSED", movementDetected: true, measurements: { stepsPassed: 3 }, source: "active",
    },
    identity: {
      status: "passed", confidence: 1, method: "authoritative-provider", issues: [],
      provider: "ISSUER_API", authoritative: true, provenance: "REAL",
      matchedFields: 5, mismatchedFields: 0,
    },
    watchlistHit: false,
    expiryStatus: "valid",
    ocrConfidence: 96,
    tamperStatus: "passed",
  };
  return { ...base, ...overrides };
}

describe("watchlist routing", () => {
  it("sends a watchlist hit to MANUAL_REVIEW even alongside a hard failure", () => {
    // Closing the case as NOT_VERIFIED would mean no human ever looks at a
    // watchlisted subject, which defeats the point of the watchlist.
    const result = calculateRisk(
      complete({ watchlistHit: true, face: { ...complete().face, status: "fail" } }),
    );
    assert.equal(result.finalDecision, "MANUAL_REVIEW");
  });

  it("holds a watchlist hit when auto-hold is on", () => {
    const result = calculateRisk(complete({ watchlistHit: true, autoHoldWatchlist: true }));
    assert.equal(result.finalDecision, "MANUAL_REVIEW");
    assert.equal(result.decision, "hold");
  });

  it("queues a watchlist hit for review when auto-hold is off", () => {
    const result = calculateRisk(complete({ watchlistHit: true, autoHoldWatchlist: false }));
    assert.equal(result.finalDecision, "MANUAL_REVIEW");
    assert.equal(result.decision, "manual");
  });

  it("defaults to holding when the setting is absent", () => {
    assert.equal(calculateRisk(complete({ watchlistHit: true })).decision, "hold");
  });

  it("records the auto-hold setting in the evidence", () => {
    const result = calculateRisk(complete({ watchlistHit: true, autoHoldWatchlist: false }));
    assert.equal(result.evidence.measurements?.autoHoldWatchlist, false);
  });

  it("does not change the lane for a clean case", () => {
    assert.equal(calculateRisk(complete({ autoHoldWatchlist: true })).decision, "safe");
  });
});

describe("no single signal is sufficient", () => {
  const signals: (keyof RiskEvidenceBundle)[] = ["face", "liveness", "challenge", "mrz", "document"];

  for (const signal of signals) {
    it(`${String(signal)} passing alone cannot reach VERIFIED`, () => {
      const stripped = complete({
        identity: { ...complete().identity, status: "unavailable", authoritative: false },
      });
      for (const other of signals) {
        if (other === signal) continue;
        (stripped[other] as { status: string }).status = "unavailable";
      }
      const result = calculateRisk(stripped);
      assert.notEqual(result.finalDecision, "VERIFIED");
    });
  }

  it("a non-authoritative identity provider alone blocks VERIFIED", () => {
    const result = calculateRisk(
      complete({ identity: { ...complete().identity, authoritative: false } }),
    );
    assert.equal(result.finalDecision, "UNCERTAIN");
  });

  it("an expired document is a hard failure", () => {
    assert.equal(calculateRisk(complete({ expiryStatus: "expired" })).finalDecision, "NOT_VERIFIED");
  });

  it("unmeasured OCR confidence keeps the case out of VERIFIED", () => {
    const result = calculateRisk(complete({ ocrConfidence: null, document: { ...complete().document, status: "review" } }));
    assert.notEqual(result.finalDecision, "VERIFIED");
    assert.match(result.reasons.join(" "), /OCR confidence is unavailable/);
  });
});
