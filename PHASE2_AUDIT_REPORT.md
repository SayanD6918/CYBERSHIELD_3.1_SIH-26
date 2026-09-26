# CYBERSHIELD 3.1.8 — Phase 2 Audit Report

## Scope

This pass independently verified the Phase 1 integration and then addressed application-specific calibration tooling, PAD train/serve controls, request hardening, artifact trust controls, and regression protection. No government identity API was added and no biometric threshold was changed.

## 1. Previous repair verification

| Requirement | Result |
|---|---|
| `/api/face-match` production call | VERIFIED in `src/routes/_app/verify.tsx` |
| `/api/liveness` production call | VERIFIED |
| `/api/active-challenge` production call | VERIFIED |
| PAD evidence reaches finalization | VERIFIED |
| Challenge evidence reaches finalization | VERIFIED |
| Risk engine consumes PAD | VERIFIED |
| Risk engine consumes challenge | VERIFIED |
| PAD SPOOF hard-fails | VERIFIED by regression tests |
| PAD UNCERTAIN remains review/uncertain | VERIFIED |
| Explicit challenge rejection fails | VERIFIED |
| Insufficient challenge evidence remains review | VERIFIED |
| Face-match evidence reaches final record | VERIFIED |
| Liveness final check exists | VERIFIED |
| Active-challenge final check exists | VERIFIED |

## 2. Threshold status

**NOT CALIBRATED.**

The repository contains no `eval/faces` dataset and no held-out genuine/impostor population. It also contains no PAD model artifact. Therefore FAR, FRR, EER, ROC-AUC, APCER, BPCER and ACER cannot honestly be reported as application measurements.

Existing operating values were not changed.

## 3. SFace evaluation changes

`evaluate_face_matching.py` now reports:

- subject count and usable subject count
- genuine/impostor pair counts
- genuine/impostor distribution statistics
- FAR and FRR at the configured operating point
- threshold sweep / DET data
- EER and candidate EER threshold
- three-state confusion counts
- ROC-AUC
- precision and recall at the operating point
- per-subject processing failures

The evaluator requires both genuine and impostor populations before producing a result.

## 4. PAD training/evaluation changes

The previous trainer grouped by `class/session`, which is not sufficient to guarantee subject-disjoint evaluation when the same subject has multiple sessions.

The trainer now requires session directories to encode a subject, e.g. `subject001_session001`, and uses the subject identifier as the `GroupShuffleSplit` group. It explicitly reports and rejects train/test subject overlap.

The PAD evaluator already separates:

- attack accepted as LIVE → APCER
- genuine rejected as SPOOF → BPCER
- ACER
- undecided rate

No PAD performance numbers were fabricated because the model and dataset are absent.

## 5. PAD artifact state

No `models/pad_model.pkl` is present in the audited repository.

Production behavior remains explicit `UNCERTAIN` / unavailable rather than synthetic LIVE.

The loader now additionally supports:

- trusted model-directory enforcement
- optional SHA-256 allowlisting through `PAD_MODEL_SHA256`
- artifact validation before use

`joblib`/pickle artifacts are treated as trusted deployment artifacts, not user uploads.

## 6. Request security hardening

The biometric service now enforces:

- strict Base64 decoding
- maximum encoded image bytes
- maximum decoded image pixel count
- explicit maximum liveness frame count
- explicit maximum face-match probe-frame count
- existing reference/challenge frame limits
- explicit HTTP methods/headers rather than wildcard methods/headers
- rejection of wildcard CORS unless explicitly enabled for a controlled environment
- production requirement for explicit CORS origins

## 7. Client trust finding

The final TypeScript risk calculation still executes in the browser and case records are persisted through Zustand/localStorage.

This remains a **security limitation**: a hostile browser can alter client state. The browser must therefore not be treated as an authoritative verification boundary.

A complete server-authoritative migration still requires moving final evidence validation/fusion behind a trusted server boundary, with the server independently validating biometric evidence rather than blindly signing client-supplied verdicts.

No fake server-side finalization endpoint was added because merely moving `calculateRisk()` behind an HTTP endpoint while accepting client-provided evidence would not solve the trust problem.

## 8. PASS3D

No PASS3D yaw/reference thresholds or state-machine thresholds were changed during this phase.

The existing production implementation remains the subject of the previously established pose-validation work.

## 9. Performance

No trustworthy end-to-end latency baseline can be produced from this repository alone because the actual YuNet/SFace/PAD model artifacts and real camera evaluation set are absent.

The architecture already loads the biometric models at service initialization rather than once per frame.

Real benchmark results remain **NOT EVALUATED — RUNTIME/MODEL DATASET REQUIRED**.

## 10. End-to-end camera validation

Not evaluated in this environment. The required real inputs are:

- actual webcam
- YuNet model
- SFace model
- real PAD model
- working OCR
- genuine/impostor/attack sessions

No result has been invented.

## 11. Regression tests

Python biometric regression suite after Phase 2 changes:

**122 passed, 0 failed**

TypeScript application suite:

**53 passed, 0 failed**

The tests cover existing biometric contracts plus new request-size/security contracts.

## 12. Remaining critical items before API integration

1. Supply a representative, permissioned, subject-disjoint SFace evaluation dataset.
2. Run genuine/impostor document-to-camera evaluation and calibrate the operating point.
3. Supply and validate a real PAD artifact with held-out subject-disjoint attack data.
4. Evaluate PAD across print, screen, replay, photograph and video attacks where data exists.
5. Capture real-camera end-to-end measurements.
6. Move the security-sensitive final verification decision to a trusted server boundary.
7. Define the authoritative identity-provider interface separately before API Setu/DigiLocker work.
8. Re-run regression, security and performance tests after the server-authoritative migration.

## Acceptance statement

The repository has measurable engineering improvements and regression coverage, but it is **not calibrated, not end-to-end evaluated, and not yet server-authoritative**. Those facts are intentional and are not being hidden behind threshold changes or fabricated metrics.
