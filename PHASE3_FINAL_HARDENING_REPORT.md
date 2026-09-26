# CYBERSHIELD 3.1.8 — Phase 3 Final Hardening Report

## 1. Executive summary

Phase 3 hardened the verification boundary so the production verification route sends raw document/camera evidence to the application server rather than sending a client-calculated biometric/risk decision. The application server independently runs document OCR/parsing, invokes the trusted biometric service for PASS3D/PAD/SFace, and performs the final evidence fusion/risk calculation.

The browser no longer persists security-sensitive case records in localStorage. Browser watchlists/settings remain UI convenience data; the authoritative watchlist is server configuration when configured.

This phase does **not** claim biometric calibration, PAD evaluation, real-camera validation, production accuracy, or production readiness because the required real datasets, PAD artifact, model-backed deployment artifacts, and physical test evidence are absent from the repository.

## 2. Files changed

- `src/lib/analyze-document.ts`
  - Exposed the existing server-side document reader/record builder for reuse by the authoritative path.
- `src/lib/authoritative-contract.ts`
  - Defines the raw-evidence authority boundary and explicit field selection.
- `src/lib/authoritative-verification.ts`
  - New server-authoritative verification function.
  - Accepts raw document/camera evidence only.
  - Recomputes document evidence, challenge, PAD, SFace and final risk server-side.
  - Generates the authoritative case ID/timestamp server-side.
- `src/lib/biometric-result.ts`
  - Shared conversion of trusted biometric-service responses into typed biometric evidence.
- `src/lib/risk-engine.ts`
  - Deterministic precedence changed so confirmed PAD/hard failures are not downgraded by a watchlist hit.
- `src/lib/decision-policy.test.ts`
  - Added precedence regression coverage.
- `src/lib/server-authority.test.ts`
  - Added raw-evidence/client-decision boundary regression tests.
- `src/lib/store.ts`
  - Case records removed from browser persistence; localStorage is no longer an authoritative case source.
- `src/routes/_app/verify.tsx`
  - Production verification now sends raw evidence to the authoritative server function.
  - Removed client-side final risk calculation from the production verification path.
- `biometric_service/main.py`
  - Explicit image MIME validation.
  - Request body size guard.
  - Exact decoded-frame duplicate detection for active-challenge replay evidence.
  - Credentialed CORS disabled; explicit origins remain required.
- `biometric_service/test_service_contracts.py`
  - MIME and duplicate-frame security regression coverage.
- `PHASE3_FINAL_HARDENING_REPORT.md`
  - This report.

## 3. Execution flow

```text
Browser camera/document capture
        |
        | raw document image + raw challenge frames
        v
TanStack Start application server
        |
        +--> document OCR/parser (server-side)
        |
        +--> biometric service
        |      +--> YuNet
        |      +--> PASS3D active challenge
        |      +--> passive PAD
        |      +--> document portrait + SFace
        |
        +--> server-side identity-provider boundary
        |
        +--> server-configured watchlist
        |
        +--> evidence fusion + risk engine
        |
        v
Authoritative CaseRecord / decision
        |
        v
Browser display
```

### Trust analysis

**A. Browser-originated:** raw document image, camera frames, file name, document image-quality measurements, UI state.

**B. Independently recomputed:** document OCR/parser evidence; PASS3D; passive PAD; document portrait extraction; SFace face matching; evidence fusion; risk score; final decision; authoritative case ID/timestamp.

**C. Merely trusted from client:** no client-calculated decision, risk score, biometric result, or watchlist hit is accepted by the authoritative function. Browser watchlist/settings are not authoritative security inputs.

**D. Final decision location:** application server, after server-side evidence fusion/risk calculation.

**E. Final decision persistence:** authoritative case records are not persisted to browser localStorage. The current repository does not contain a server database/session store, so authoritative historical retrieval after refresh is **NOT IMPLEMENTED**.

## 4. Server-authority implementation

Status: **PASS for the implemented boundary**.

The server authority function accepts only raw evidence fields and performs the biometric/document stages itself. It does not accept a browser-supplied `decision`, `riskScore`, `biometric`, or `watchlistHit` as authoritative input.

The browser only receives the resulting authoritative record for display and in-memory UI state.

No fake server endpoint was introduced that merely trusts client-calculated biometric evidence.

### Remaining authority limitation

There is no server-side persistent case database in this repository. Therefore the authoritative result is computed on the server, but server-side historical case retrieval is **BLOCKED** until a real server persistence/authentication design is selected.

## 5. Decision precedence

Status: **PASS** for deterministic tested precedence.

Current policy:

```text
confirmed PAD SPOOF / hard failure
        >
other hard biometric/document failure
        >
watchlist / manual review
        >
other review / uncertainty
        >
VERIFIED
```

A watchlist hit remains visible for human review, but it cannot downgrade a confirmed presentation attack or hard failure into `MANUAL_REVIEW`.

The repository's identity provider remains non-authoritative, so normal repository execution cannot legitimately reach a trusted `VERIFIED` identity decision.

## 6. SFace calibration

Status: **NOT CALIBRATED**.

The evaluator supports genuine/impostor distributions, FAR, FRR, EER, ROC-AUC, threshold sweeps, confusion/precision/recall/F1 and operating-point reporting.

No real subject-disjoint application dataset is present in this repository. No threshold was changed to fit test images.

## 7. PAD model/evaluation

Status: **NOT EVALUATED**.

The repository contains PAD loading/validation and subject-disjoint training/evaluation infrastructure, including feature-version/model metadata checks and trusted-artifact validation.

No valid production PAD model artifact is present in the Phase-2 repository. No APCER/BPCER/ACER or attack-class performance is claimed.

The service fails closed to `UNCERTAIN`/review when the PAD model is unavailable.

## 8. Active challenge hardening

Status: **PASS for the implemented regression-covered controls**.

Existing PASS3D reference acquisition and thresholds were preserved. This phase additionally rejects exact decoded-frame duplicates across the complete challenge session as replay evidence.

The existing sequence, reference immutability, temporal ordering, frame-count limits, movement validation and return-to-reference logic remain in place.

Physical camera challenge validation is still **NOT VALIDATED**.

## 9. Security changes

Status: **PASS for implemented automated controls**.

Implemented/retained:

- strict Base64 decoding
- explicit supported image MIME types
- maximum encoded image size
- maximum decoded pixel count
- maximum frame counts
- maximum application-server request body size guard
- explicit CORS origins
- non-credentialed biometric-service CORS
- trusted PAD model directory enforcement
- optional PAD SHA-256 allowlist
- YuNet/SFace SHA-256 verification
- duplicate-frame replay detection for PASS3D
- no client-calculated final decision accepted by server authority
- security-sensitive case records removed from localStorage persistence

Known limitation: the repository does not implement a production authentication/session/authorization system for the application server.

## 10. Performance

Status: **NOT BENCHMARKED**.

No production model artifacts/hardware and no repeatable physical camera benchmark dataset are available in the repository. No latency or memory numbers were fabricated.

## 11. Tests

### Python biometric suite

**124 passed, 0 failed** in the Phase-3 working tree.

### TypeScript suite

**58 passed, 0 failed** using:

```text
node --experimental-strip-types --test
```

### Additional security coverage

Covered by the suites:

- malformed Base64
- unsupported MIME type
- oversized image
- excessive pixel count
- excessive frame bursts
- duplicate decoded challenge frames
- PAD missing/invalid states
- model checksum/path controls
- authority input field selection
- watchlist/hard-failure precedence
- challenge sequence/replay-related regressions

A full `npm run typecheck`/production Vite build was not claimed because `node_modules` is not present in this working tree.

## 12. Real-camera validation

Status: **NOT VALIDATED**.

The required physical scenarios—genuine conditions, impostor, printed photo, screen replay, video replay, difficult lighting, blur, occlusion, multiple faces and resolution changes—were not executed in this environment.

## 13. Known limitations

1. Application-server historical case persistence is not implemented.
2. Authentication/authorization for the application server is not implemented.
3. SFace is not application-calibrated.
4. PAD is not evaluated with a held-out real attack dataset and no production PAD artifact is bundled.
5. Real-camera end-to-end performance/accuracy is not validated.
6. No authoritative external identity provider is configured.
7. Government/API Setu/DigiLocker/Aadhaar APIs remain intentionally unimplemented.

## 14. Remaining blockers

- Real subject-disjoint SFace calibration dataset and evaluation.
- Valid trained/validated PAD model plus held-out attack dataset.
- Physical camera validation and performance measurement.
- Production server persistence, authentication and authorization.
- Deployment security review.
- Authoritative identity-provider integration in a later phase.

## 15. Exact next steps

1. Supply a legally usable subject-disjoint SFace genuine/impostor dataset.
2. Run the evaluator and select/document an operating threshold from measured distributions.
3. Supply/train/validate the PAD artifact using subject- and attack-disjoint data.
4. Execute the full physical-camera validation matrix and record per-test diagnostics/latency.
5. Add authenticated server persistence and server-side case retrieval.
6. Perform deployment security review.
7. Only after those gates are satisfied, evaluate readiness for a separate API-integration phase.

## Acceptance-gate status

| Gate | Status |
|---|---|
| A — Server Authority | **PASS** for computation boundary; persistence/authentication remain limited |
| B — Decision Precedence | **PASS** |
| C — SFace Calibration | **NOT CALIBRATED** |
| D — PAD Evaluation | **NOT EVALUATED** |
| E — Camera Validation | **NOT VALIDATED** |
| F — Regression | **PASS** |
| G — Security | **PASS** for tested client-trust/resource/model controls; deployment auth remains outstanding |

## Final engineering status

**NOT READY FOR API-INTEGRATION PHASE**

Automated tests passing is not sufficient to advance the system. The missing real biometric/PAD datasets, physical-camera validation, and production server persistence/authentication remain genuine blockers.
