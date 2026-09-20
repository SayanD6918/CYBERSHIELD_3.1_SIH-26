import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { initialsFromName, maskDocumentNumber, formatCaseTime, decisionLabel } from "./format.ts";

describe("display formatting", () => {
  it("masks all but the first and last characters of a document number", () => {
    assert.equal(maskDocumentNumber("P1234567"), "P••••67");
  });

  it("leaves very short document numbers alone", () => {
    assert.equal(maskDocumentNumber("P12"), "P12");
    assert.equal(maskDocumentNumber("   "), "—");
  });

  it("builds initials from the first and last name", () => {
    assert.equal(initialsFromName("Sayan DN"), "SD");
    assert.equal(initialsFromName("Sayan"), "SA");
    assert.equal(initialsFromName("   "), "OF");
  });

  it("describes recent case times relatively", () => {
    const now = new Date("2026-09-19T12:00:00.000Z");
    assert.match(formatCaseTime("2026-09-19T11:57:00.000Z", now), /minute/);
    assert.match(formatCaseTime("2026-09-17T12:00:00.000Z", now), /day/);
    assert.equal(formatCaseTime("2026-09-19T11:59:45.000Z", now), "just now");
  });

  it("falls back for an unparseable timestamp", () => {
    assert.equal(formatCaseTime("not-a-date"), "just now");
  });

  it("labels each decision lane", () => {
    assert.equal(decisionLabel("safe"), "Safe to proceed");
    assert.equal(decisionLabel("manual"), "Manual review");
    assert.equal(decisionLabel("hold"), "Hold");
  });
});
