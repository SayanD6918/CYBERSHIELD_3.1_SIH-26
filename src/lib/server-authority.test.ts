import assert from "node:assert/strict";
import test from "node:test";
import { selectAuthoritativeInput } from "./authoritative-contract.ts";

const frame = "data:image/jpeg;base64," + "A".repeat(40);

test("authoritative selector drops client-calculated security fields", () => {
  const selected = selectAuthoritativeInput({
    documentImageDataUrl: frame,
    fileName: "document.jpg",
    imageQuality: null,
    referenceFrames: [frame],
    leftFrames: [frame],
    rightFrames: [frame],
    straightFrames: [frame],
    decision: "VERIFIED",
    riskScore: 0,
    watchlistHit: false,
    biometric: { faceMatchStatus: "MATCH", livenessStatus: "LIVE" },
  });
  assert.equal("decision" in selected, false);
  assert.equal("riskScore" in selected, false);
  assert.equal("watchlistHit" in selected, false);
  assert.equal("biometric" in selected, false);
});

test("authoritative selector copies raw evidence arrays", () => {
  const input = {
    documentImageDataUrl: frame, fileName: "document.jpg", imageQuality: null,
    referenceFrames: [frame], leftFrames: [frame], rightFrames: [frame], straightFrames: [frame],
  };
  const selected = selectAuthoritativeInput(input);
  assert.deepEqual(selected, input);
  assert.notEqual(selected.referenceFrames, input.referenceFrames);
});
