import assert from "node:assert/strict";
import test from "node:test";

import { maskAadhaarNumber, parseDocumentText } from "./document-parser.ts";

test("detects Aadhaar from explicit Aadhaar text", () => {
  const parsed = parseDocumentText(
    "Government of India\nAadhaar\nName: Sayan Debnath\n1234 5678 9012",
  );
  assert.equal(parsed.documentType, "aadhaar");
  assert.equal(parsed.documentNumber, "XXXX-XXXX-9012");
  assert.equal(parsed.aadhaarNumberStatus, "full");
});

test("detects Aadhaar when the exact Aadhaar word is missing but UIDAI signals remain", () => {
  const parsed = parseDocumentText(
    "Unique Identification Authority of India\nGovernment of India\n1234 5678 9012",
  );
  assert.equal(parsed.documentType, "aadhaar");
  assert.equal(parsed.aadhaarNumberStatus, "full");
  assert.equal(parsed.documentNumber, "XXXX-XXXX-9012");
});

test("detects a noisy Aadhaar spelling without requiring one exact OCR token", () => {
  const parsed = parseDocumentText(
    "Government of India\nAadh4ar\nName: Example\n1234-5678-9012",
  );
  assert.equal(parsed.documentType, "aadhaar");
  assert.equal(parsed.documentNumber, "XXXX-XXXX-9012");
});

test("existing passport detection remains intact", () => {
  const parsed = parseDocumentText("PASSPORT\nSurname: TEST\nP<INDTEST<<EXAMPLE");
  assert.equal(parsed.documentType, "passport");
});

test("existing visa detection remains intact", () => {
  assert.equal(parseDocumentText("VISA\nDocument No: V12345").documentType, "visa");
});

test("existing permit detection remains intact", () => {
  assert.equal(parseDocumentText("PERMIT\nDocument No: R12345").documentType, "permit");
});

test("generic ID card detection remains conservative and intact", () => {
  assert.equal(parseDocumentText("NATIONAL ID CARD\nName: Example").documentType, "id");
});

test("unknown documents remain unknown", () => {
  assert.equal(parseDocumentText("Library membership card\nExample text").documentType, "unknown");
});

test("masked Aadhaar is never classified as a complete number", () => {
  const parsed = parseDocumentText(
    "Unique Identification Authority of India\nXXXX XXXX 1234",
  );
  assert.equal(parsed.documentType, "aadhaar");
  assert.equal(parsed.aadhaarNumberStatus, "masked");
  assert.equal(parsed.documentNumber, "XXXX-XXXX-1234");
});

test("complete Aadhaar numbers are masked before they enter the parsed document", () => {
  const raw = "234567890123";
  const parsed = parseDocumentText(`Aadhaar\n${raw}`);
  assert.equal(parsed.aadhaarNumberStatus, "full");
  assert.equal(parsed.documentNumber, "XXXX-XXXX-0123");
  assert.ok(!parsed.documentNumber?.includes(raw));
  assert.equal(maskAadhaarNumber(raw), "XXXX-XXXX-0123");
});
