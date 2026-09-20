# CYBERSHIELD 3.1.8 — Architecture & Code Audit (pre-change)

Audit of the uploaded `CYBERSHIELD_3_1_8.zip` against the *Complete Working Manual*.
Source code treated as authoritative; the manual used as the architectural reference.
**No files have been modified.**

---

## 0. Scope, and what this environment can and cannot verify

Inspected: all 250 files, in depth for the 12 Python modules and the 20 TypeScript
modules that carry verification logic.

Executed here:

| Check | Result |
|---|---|
| `python3 -m unittest test_face_pipeline test_active_challenge` | 24 tests, all pass |
| `node --experimental-strip-types --test src/lib/pass7-evidence-fusion.test.ts` | 5 tests, all pass |
| `node --experimental-strip-types --test src/lib/pass6-demo-isolation.test.ts` | **fails to load** (see B1) |
| `python3 -m pytest test_liveness.py` | pytest not installed (see B17) |
| Targeted repro scripts for B4, B6, B7 | reproduced, output quoted below |

**Could not be executed (no network egress, no `node_modules`, no datasets):**

- YuNet / SFace ONNX weights cannot be downloaded, so nothing that calls
  `FaceDetectorYN` or `FaceRecognizerSF` can be run end to end.
- `npm install`, `tsc --noEmit`, `vite dev`, Playwright smoke — no registry access.
- Tesseract binary is absent, so the OCR path cannot be exercised.
- No genuine/impostor face pairs and no live/spoof PAD data were supplied.

**Direct consequence for the accuracy workstream:** a measurable baseline cannot be
established in this environment. By the rule you set — no threshold changes and no
accuracy claims without before/after numbers on held-out data — **`FACE_MATCH_THRESHOLD
= 0.363`, `FACE_UNCERTAIN_BAND = 0.05`, the PAD 0.20/0.80 bands and the active-challenge
yaw constants must stay exactly where they are** until a baseline is produced on a
machine that has the models and the data. Section 4 specifies that baseline.

---

## 1. Architecture as built

### 1.1 Module responsibility map

**Python biometric service** (`biometric_service/`, FastAPI, port 8765)

| File | Responsibility |
|---|---|
| `main.py` | App wiring, model construction at import time, 3 endpoints + `/health` |
| `face_detection.py` | `YuNetDetector` — OpenCV `FaceDetectorYN`, conf 0.9 / NMS 0.3, returns box + 5 landmarks + score |
| `face_extraction.py` | `select_single_face` (rejects 0 or >1 faces), `FaceQuality` |
| `document_portrait.py` | 4-orientation sweep → layout classification (MRZ-band heuristic + aspect ratio) → expected-region priors → candidate scoring → quality gate → `selected` / `uncertain` |
| `face_matching.py` | `FaceRecognizer` (SFace), `prepare_face_pair`, cosine compare, MATCH/NO_MATCH/UNCERTAIN |
| `liveness.py` | YCrCb+LUV 1536-d histogram features, quality, temporal evidence, PAD artifact validation, `analyze_sequence` |
| `active_challenge.py` | solvePnP(SQPNP) head pose, initial-pose gate, movement→target→hold state machine |
| `train_liveness_model.py` | ExtraTrees PAD training with `GroupShuffleSplit` |

**Frontend** (`src/`, React 19 + TanStack Start + Vite, port 8080)

| File | Responsibility |
|---|---|
| `routes/_app/verify.tsx` | The whole operator workflow: upload → analyze → camera → burst → 3 API calls → finalize |
| `lib/document-image.ts` | Client-side downscale to 1280 px max edge, JPEG q0.78, canvas quality metrics |
| `lib/analyze-document.ts` | **Server function**: Tesseract subprocess (text + TSV confidence), optional xAI path, `buildRecord` |
| `lib/document-parser.ts` / `mrz-validator.ts` | Field extraction; TD3 parse + ICAO check digits (implementation verified correct against the ICAO 9303 field offsets and 7-3-1 weighting) |
| `lib/identity-provider.ts` | `UnverifiedIdentityProvider` (normal) / `DemoIdentityProvider` (opt-in) |
| `lib/risk-engine.ts` | Additive score + hard-failure/review overrides → VERIFIED / NOT_VERIFIED / UNCERTAIN / MANUAL_REVIEW |
| `lib/finalize-verification.ts` | Assembles the evidence bundle and calls the risk engine |
| `lib/store.ts` | Zustand + `persist` to `localStorage` key `cybershield-v1` |

### 1.2 Confirmed-good invariants

These were specifically checked and are intact:

- No `compareHist`, `matchTemplate`, or pixel-correlation matching anywhere in code
  (only three prose mentions in READMEs saying they are *not* used).
- No `MOCK_IDENTITY_DB` in the normal path; `createIdentityProvider(false)` returns
  `UNVERIFIED` / `authoritative: false` / `matchedFields: 0`.
- No `liveness_model.pkl` fallback. `load_pad_model` fails closed through eight distinct
  validity gates (dict shape, `predict_proba`, `n_features_in_ == 1536`, feature version,
  class mapping, mapping↔`classes_` agreement, model type, degenerate-tree check) and
  returns `(None, info)` on any of them.
- `analyze_sequence` returns `UNCERTAIN` with `pad.status = "UNAVAILABLE"` when the model
  is `None`. It never emits `LIVE` without a valid artifact.
- The active challenge never reads `liveness_status`.
- No single signal can reach `VERIFIED`: `pass7-evidence-fusion.test.ts` asserts this for
  face and liveness, and the `reviewNeeded` disjunction requires all eight evidence
  classes to pass plus `identity.authoritative`.

### 1.3 Documented deviations from the manual

| # | Manual says | Code does |
|---|---|---|
| D1 | §3.7, §16.11: challenge sequence `TURN LEFT → TURN RIGHT → LOOK STRAIGHT` | `verify.tsx:67` picks **one** challenge at random per session |
| D2 | §7: passive PAD uses an **8-frame** burst | `verify.tsx:280` captures **36** frames; `/api/liveness` truncates to 32, `/api/active-challenge` to 48 |
| D3 | §5 and both READMEs: YuNet 5-landmark alignment → SFace | `face_matching.py:65` passes only the 4-value bbox to `alignCrop` (**B2**) |
| D4 | §7: face detection/tracking → quality → PAD model | PAD features and quality are computed on **whole frames**; boxes feed only temporal stats (**B4**) |
| D5 | §15: server-authoritative decisioning not implemented | Confirmed — `finalizeVerification` and `calculateRisk` run in the browser; cases persist to `localStorage` |

D1 and D2 are not bugs, but the manual and the demo script currently describe a workflow
the build does not perform. One of the two has to move.

---

## 2. Bugs

Severity: **C** critical (silently wrong biometric result), **H** high, **M** medium, **L** low.

---

### B1 · C · `npm test` cannot load half the suite — extensionless imports

**Where:** `src/lib/finalize-verification.ts:2-4`

**Evidence (reproduced):**

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/claude/cs/src/lib/risk-engine'
    imported from /home/claude/cs/src/lib/finalize-verification.ts
```

**Root cause:** `package.json` runs the lib tests through
`node --experimental-strip-types`, whose ESM resolver requires explicit file specifiers.
`pass7-evidence-fusion.test.ts` imports `./risk-engine.ts`; `finalize-verification.ts`
imports `./risk-engine`, `./identity-provider`, `./verification-config` without the
extension. Vite's resolver is permissive, so this only fails in the test runner — which
is exactly why it went unnoticed.

**Impact:** `pass6-demo-isolation.test.ts` — the suite that enforces *demo data never
becomes authoritative* — has never actually run. That invariant is currently unguarded.

**Fix:** add `.ts` to the three runtime imports. No behaviour change. Re-run both suites.

---

### B2 · C · SFace is fed a 4-element box, so landmark alignment never happens

**Where:** `biometric_service/face_matching.py:65`

```python
aligned = self._model.alignCrop(image, np.asarray(detection.box, dtype=np.float32))
```

**Root cause:** OpenCV's `FaceRecognizerSF::alignCrop` expects one **full detection row** —
`[x, y, w, h, x_re, y_re, x_le, y_le, x_nt, y_nt, x_rcm, y_rcm, x_lcm, y_lcm, score]`, 15
floats — and reads the five alignment points from columns 4 through 13. It is handed 4
floats. `Mat::at` is unchecked in release builds, so instead of raising, it reads adjacent
memory and builds the similarity transform from garbage.

**Impact:** the crop handed to `feature()` is not the canonically aligned 112×112 face
SFace was trained on. Embeddings are wrong and non-reproducible run to run. This is the
single largest suspected source of face-match error, and the manual, both READMEs and
`/health` all claim landmark alignment is happening. It fails silently and never appears
in `issues[]`.

**Cannot be executed here** (no SFace weights) — this is read from the OpenCV contract, and
must be confirmed on a machine with the models before and after the fix.

**Fix:** build the 15-value row from `detection.box`, `detection.landmarks` (already
carried through `FaceDetection` and correctly re-mapped through orientation changes by
`_map_detection_back`) and `detection.confidence`. Test with a fake recognizer asserting
shape `(1, 15)` and landmark ordering.

---

### B3 · C · The face-match live frame is the *turned-head* frame

**Where:** `src/routes/_app/verify.tsx:280-281`

```ts
const liveFrames = await captureBurst(36, 140);
const liveFrame  = liveFrames[liveFrames.length - 1];
```

**Root cause:** one burst serves three purposes. The last frame of that burst is, for
`TURN_LEFT` and `TURN_RIGHT`, the moment the subject is *holding the turn* — the pose the
challenge state machine explicitly waited for. That frame is then sent to `/api/face-match`
as the live probe.

**Impact:** recognition is performed on a large-yaw, often motion-blurred face. SFace
similarity degrades sharply off-frontal, so genuine subjects are pushed toward
`UNCERTAIN`/`NO_MATCH` — a direct, structural FRR inflation that no threshold change can
legitimately repair. Note the interaction with B2: both push similarity down, and tuning
the threshold to compensate would be exactly the illegitimate "improvement" your brief
rules out.

**Fix:** select the probe frame by measured pose and quality rather than by position.
The service already computes per-frame yaw/pitch/roll and reprojection error in
`active_challenge.py` and per-frame quality in `liveness.py`. Preferred: send the burst to
`/api/face-match` and let the service pick the most frontal, sharpest, single-face frame,
returning which index it used as evidence.

---

### B4 · H · PAD features and quality are computed on whole frames, not faces

**Where:** `biometric_service/liveness.py:160-175`, `main.py:110-133`

**Evidence (reproduced):**

```
C) analyze_sequence crops face? False
```

`analyze_sequence(frames, boxes, ...)` passes `boxes` only to `temporal_evidence`.
`image_quality(f)` and `predict_pad(model, info, f)` both receive the **full frame**.

**Impact:**

1. The 1536-d YCrCb/LUV histogram is dominated by the room, not the face. Print/replay
   discrimination lives in the face's colour and texture statistics; this throws that away.
2. `image_quality`'s `FACE_TOO_SMALL` test is `face.shape[0] < 90 or face.shape[1] < 90` —
   applied to a 480×640 frame it can never fire, so one of the four quality gates feeding
   `decide()` is dead.
3. `train_liveness_model.py:collect` also calls `extract_features(im)` on whole images. So
   train and serve are consistent *only if* the training set is full scenes. If you train
   on face crops — which is what Print-Attack/Replay-Attack derived sets usually give you —
   you get a silent train/serve mismatch, and the PAD artifact will validate cleanly
   through all eight `load_pad_model` gates while being meaningless at inference.

**Fix:** crop with a fixed relative margin from the per-frame box before both
`extract_features` and `image_quality`; make the same crop the unit in the trainer; bump
`FEATURE_VERSION` to a new value so any artifact built against the old contract is
rejected by the existing `FEATURE_PIPELINE_MISMATCH` gate rather than silently reused.
The fail-closed behaviour for a missing artifact is unchanged — no artifact is fabricated.

---

### B5 · H · `addCase` silently discards the case ID, so the operator sees a different ID than the one stored

**Where:** `src/lib/store.ts:140` (signature) vs `:185` (implementation); callers at
`verify.tsx:439` and `:554`

```ts
addCase: (record: Omit<CaseRecord, "id">, caseId?: string) => CaseRecord;   // declared
addCase: (record) => { ... id: `BS-2026-${...}` ... }                       // implemented
```

**Impact:** `verify.tsx:37` mints `CASE-2026-######` and renders it as **"CASE ID · …"**
for the whole session; the persisted record gets an unrelated `BS-2026-#####`. The ID an
officer reads off the screen mid-verification does not exist in the case list. Reproducible
on every single run.

**Fix:** honour the supplied ID, keeping the serial counter for the generated path.

---

### B6 · M · `FaceRecognizer.compare` mutates its caller's embeddings

**Where:** `biometric_service/face_matching.py:79-80`

**Evidence (reproduced):**

```
A) caller embedding mutated by compare(): True  [3. 4.] -> [0.6 0.8]
```

**Root cause:** `np.asarray(x, dtype=np.float32)` returns the *same object* for a float32
input; `a /= norm` is then an in-place write to the caller's array.

**Impact:** benign in today's single-comparison flow because `embedding()` already
L2-normalizes. It is a live corruption bug for any caller that reuses an embedding — 1:N
matching, and in particular the evaluation harness proposed in §4, which compares one
document embedding against many probes.

**Fix:** copy before normalizing.

---

### B7 · M · Detector-unavailable produces a frames/boxes length mismatch and disarms the UNCERTAIN guard

**Where:** `biometric_service/main.py:115-133`

**Evidence (reproduced):** `temporal_evidence(frames=8, boxes=0)` →
`frame_count=8, face_count_consistent=False`.

**Root cause:** when `face_detector.loaded` is false, `boxes` stays `[]` while `frames`
has N entries. Then:

- `face_count_per_frame` reports `[]` for an N-frame burst — the evidence record claims
  nothing about N frames rather than claiming nothing was found;
- `any(b is None for b in boxes)` is `False` over an empty list, so the guard at
  `main.py:130` that forces `UNCERTAIN` **does not fire**.

**Impact:** masked today only because the PAD model is absent too, so `analyze_sequence`
returns `UNCERTAIN` anyway. Once a valid PAD artifact exists, a missing or broken detector
would run PAD over full frames with zero face evidence and could return **LIVE**. That is
precisely the failure mode the fail-closed design exists to prevent.

**Fix:** always emit one box slot per frame (`[None] * len(frames)`), and treat
detector-unavailable as an explicit hard `UNCERTAIN` with
`FACE_DETECTOR_MODEL_UNAVAILABLE`.

---

### B8 · M · Malformed image payloads become HTTP 500s

**Where:** `main.py:73-80` (`decode_data_url`), called unguarded at `:117`, `:167`, `:177-178`

`cv2.imdecode` returning `None`, a truncated base64 string, or a non-image upload raises
`ValueError`/`binascii.Error` inside the handler. FastAPI turns that into a 500, and the
frontend's `if (!response.ok)` reports "service unavailable" — the operator is told the
service is down when the real problem is the image.

**Fix:** catch per frame and return the normal response shape with
`INVALID_IMAGE_DATA` in `issues[]` and status `UNCERTAIN`; add an explicit payload-size cap.

---

### B9 · M · Portrait candidates and the selected detection are in different coordinate spaces

**Where:** `document_portrait.py:250-300` vs `face_matching.py:112-120`

`DocumentPortraitResult.candidates` hold detections in the **winning orientation's**
coordinates; `selected` is mapped back to the **original** image. `prepare_face_pair` then
recovers the chosen candidate by minimising L2 distance between those two boxes — which is
only valid when orientation is 0. For a 90/180/270 document it picks the wrong candidate,
so the reported `document_face.sharpness` / `.brightness` belong to a different face.

Evidence-only (the embedding itself uses `portrait.selected`, which is correctly mapped),
but it is evidence surfaced in the case record.

**Fix:** carry the mapped detection on the candidate, or have `extract_document_portrait`
return the selected candidate object directly.

---

### B10 · M · Watchlist policy is inconsistent, and the `autoHoldWatchlist` setting does nothing

**Where:** `risk-engine.ts:156-160`; `analyze-document.ts:325` / `:485`

1. `finalDecision` tests `hardFailure` **before** `watchlistHit`, so a watchlisted subject
   who also has any hard failure returns `NOT_VERIFIED` and never reaches `MANUAL_REVIEW`.
   Manual §10 and §12 say a watchlist condition routes to human review.
2. `autoHoldWatchlist` is a UI switch (`settings.tsx:75`), is threaded through the store,
   the Zod schema and into `buildRecord`'s parameter list — and is **never read**. The
   toggle has no effect on any decision.

**Fix:** decide the policy explicitly (my recommendation: a watchlist hit always yields at
minimum `MANUAL_REVIEW`, and `NOT_VERIFIED` cases with a watchlist hit are flagged for
review as well), implement it, wire the setting or delete it, and test both branches.

---

### B11 · M · OCR confidence is fabricated when the TSV pass fails

**Where:** `src/lib/analyze-document.ts:183`

```ts
ocrConfidence = Math.min(95, 45 + extractedFieldCount * 10);
```

When Tesseract's TSV confidence pass fails, a number is invented from the count of
extracted fields. It then drives the OCR term in `calculateRisk` (`< 60` → +12, `< 85` →
+5), sets the `ocr` check to passed/review/fail, and is displayed to the operator as
"NN% confidence". It is not a measurement of anything.

**Fix:** return `null`, letting the risk engine take its existing "OCR confidence is
unavailable" branch (+8), and label the check `unavailable`.

---

### B12 · M · Tesseract path defaults to a hard-coded Windows absolute path

**Where:** `src/lib/analyze-document.ts:75-76`

```ts
process.env.TESSERACT_CMD || "C:\\Program Files\\Tesseract-OCR\\tesseract.exe"
```

On Linux/macOS, or on a Windows box with Tesseract elsewhere, `execFile` throws ENOENT,
`analyzeWithLocalOcr` rejects, and the operator gets a bare "Scan failed." toast with no
indication that OCR is simply not installed. The `run_unix.sh` script implies Linux/macOS
is a supported target.

**Fix:** default to `tesseract` on `PATH`, probe once at startup, and surface
`OCR_ENGINE_NOT_FOUND` as document evidence instead of throwing.

---

### B13 · L/M · Missing document-quality evidence fails open

**Where:** `src/lib/analyze-document.ts:205-211`

`documentStatus` is `review` only when `imageQuality` exists *and* has issues. When
`imageQuality` is `null` — evidence genuinely unavailable — the status can be `passed`.
Everywhere else in this codebase missing evidence degrades to review; this one place does
the opposite.

---

### B14 · L · Frontend reads liveness fields at the wrong path

**Where:** `verify.tsx:387-397` vs `liveness.py:174`

`live.spoof_probability` and `live.frames_analyzed` do not exist at the top level; the
service returns `evidence.pad.spoof_probability_median` and `evidence.frames_analyzed`.
`spoofProbability` is therefore always `null` in every stored record, and `framesAnalyzed`
only resolves because of the `face_count_per_frame.length` fallback — which B7 can make
`0`.

---

### B15 · L · Dead checks and unused exports

- `face_extraction.py:52` — `detection.confidence < 0.9` can never fire; `YuNetDetector`'s
  own threshold is already 0.9, so `LOW_DETECTION_CONFIDENCE` is unreachable on live faces.
- `document_portrait.py:205` — `min_confidence=0.75` is below the same 0.9 detector
  threshold, so the candidate filter is a no-op.
- `risk-engine.ts:188` — `hasCompleteVerificationEvidence` is exported and never called.
- `liveness.py:145` — `decide(..., calibrated=...)` takes the flag and ignores it; an
  uncalibrated model still produces hard LIVE/SPOOF verdicts at 0.20/0.80.

These matter mainly because they make the quality gating look stronger than it is.

---

### B16 · L · Zero tolerance for a single dropped frame in the challenge

**Where:** `active_challenge.py:196-201`, `:265-267`

Any frame out of 36 with no detected face sets `missing_face`, which hard-fails the whole
challenge with `FACE_LOST_DURING_CHALLENGE`. One blink, one motion-blurred frame during
the turn, or one autoexposure hunt is enough. Over a ~5-second burst on consumer webcams
this is a substantial FRR driver.

**Fix (after baseline, not before):** replace zero tolerance with a continuity criterion —
e.g. ≥90% valid frames and no gap longer than 2 consecutive frames — and report the actual
counts as evidence. This changes pass rates, so it belongs in the measured stage.

---

### B17 · L · Test infrastructure is split and partly unrunnable

`test_liveness.py` is pytest-style; `test_face_pipeline.py` and `test_active_challenge.py`
are unittest. `pytest` is not in `requirements.txt`, and no documented command runs all
three. Combined with B1, roughly half the declared test surface does not execute.

---

### B18 · Info · Security posture

Not bugs in the "make it work" sense, but they belong in the record:

- The entire decision path is client-side. `finalizeVerification` → `calculateRisk` runs in
  the browser and results persist to `localStorage`; anything in DevTools can write a
  `VERIFIED` case. Manual §15 already states this; it is the largest gap between prototype
  and product.
- `/api/*` accepts unauthenticated image uploads from any reachable client;
  `run_unix.sh`/`run_windows.ps1` bind `0.0.0.0`.
- `CORSMiddleware` is configured with `allow_credentials=True` alongside an
  env-driven origin list — safe as configured, fragile if someone sets `CORS_ORIGINS=*`.

---

## 3. Head-pose sign convention — verify before touching any yaw constant

`MODEL_POINTS` in `active_challenge.py:23-32` is the classic Mallick generic face model,
commented "left eye, right eye, nose, left mouth, right mouth". Two things need checking:

1. **Landmark ordering.** YuNet emits landmarks as right-eye, left-eye, nose, right-mouth-
   corner, left-mouth-corner in *subject* terms — index 0 is the eye on the **image-left**.
   The model's point 0 has x = −225. Whether "model x increases to image right" holds
   depends on that pairing.
2. **Handedness.** The model uses y-up (eyes at +170, mouth at −150) while image
   coordinates are y-down. Combined with (1) the two flips may cancel — this is the
   well-known quirk of that model — but it may not.

If the sign is inverted, `TURN_LEFT` and `TURN_RIGHT` are transposed: the subject follows
the on-screen instruction and the state machine scores it as the opposite movement.
`test_active_challenge.py` cannot catch this because it patches `estimate_head_pose`
entirely and injects yaw values directly — the geometry has no test coverage at all.

One thing that *is* clean: `captureFrame` (`verify.tsx:236-263`) uses a plain
`drawImage`, and the `<video>` element carries no mirroring transform, so the frames sent
to the server match what the operator sees. There is no CSS-mirror/capture mismatch.

**Action:** record one clip of a known left turn, run `estimate_head_pose` over it, and
confirm the yaw sign against the documented convention. This is a 10-minute check with the
models present and it gates every active-challenge constant.

---

## 4. Accuracy work — required baseline before any tuning

Errors must be attributed per stage. A single end-to-end accuracy number would hide the
fact that B2, B3 and B4 are three independent defects stacking in the same direction.

| Stage | Metric | Data needed |
|---|---|---|
| Face detection | miss rate, false-detection rate, IoU vs annotated boxes | labelled document scans + webcam frames |
| Portrait selection | selected-vs-annotated IoU; rate of `uncertain` by cause (`MULTIPLE_PLAUSIBLE_FACES`, `FACE_OUTSIDE_EXPECTED_PORTRAIT_REGION`, `AMBIGUOUS_PORTRAIT_CANDIDATES`) | ≥100 documents across passport / landscape ID / portrait layouts, including rotated |
| Face quality | distribution of each issue flag on genuine captures — a gate that fires on 40% of good captures is a defect, not a safeguard | the same captures |
| Embedding / matching | **FAR, FRR at threshold; full DET curve; EER; operating point** | ≥200 genuine document↔live pairs and ≥2,000 impostor pairs, generated through the *real* pipeline (1280px / q0.78 document JPEG, webcam probe) |
| Passive PAD | **APCER, BPCER, ACER** + ROC; grouped by subject/session | live captures + print and replay attacks; `GroupShuffleSplit` on session is already correct in the trainer and must not be relaxed |
| Active challenge | pass rate on compliant attempts (FRR), pass rate on non-compliant attempts (FAR), failure-reason histogram | scripted compliant and non-compliant clips per challenge |
| OCR / MRZ | field-level accuracy vs transcription; MRZ check-digit pass rate; TD3 detection rate | transcribed ground truth |
| Decision engine | 4×4 confusion matrix over VERIFIED / NOT_VERIFIED / UNCERTAIN / MANUAL_REVIEW | per-case expected outcome labels |

Two framing rules carried through into the harness and any report it produces: cosine
similarity is reported as a similarity value with its threshold, never as a percentage or
probability; and any metric is reported with its sample size and its held-out split.

Related presentation defect to fix while we are here: `verify.tsx:830` renders
`Math.round(faceSimilarity * 100)}% similarity`, and `analyze-document.ts:428` renders
`${Math.round(faceScore)}% match`. Both read as probabilities to an operator. The
`EvidenceCard` at `:910` already does this correctly (`similarity 0.4132 · distance
0.5868`) — the BioLine should match it.

---

## 5. Proposed staged plan

Each stage ends with the relevant suites green before the next begins.

**Stage 0 — make the tests runnable.** B1, B17. Add `.ts` extensions; unify the Python
tests on `unittest` (or add `pytest` to requirements) and document one command per suite.
Zero behaviour change. Gate: `pass6` and `pass7` both execute; all three Python modules run.

**Stage 1 — correctness, no metric impact.** B5, B6, B7, B8, B9, B11, B12, B13, B14, B15.
Each gets a regression test. Gate: full suites green; `/health` unchanged.

**Stage 2 — the three accuracy-critical data-flow fixes.** B2 (alignment row), B3 (probe
frame selection), B4 (face-crop PAD features + `FEATURE_VERSION` bump). Thresholds
untouched. These change numbers, so they must be measured before and after — which means
Stage 3 lands first in practice, or Stage 2 lands behind an env flag so both paths can be
measured on the same data.

**Stage 3 — measurement harness.** Offline scripts producing the §4 tables from a directory
of labelled data. No product behaviour change. This is what makes Stage 2 defensible.

**Stage 4 — baseline, then and only then tuning.** Run the harness on your machine with the
models and data, record the numbers, then revisit B10 (watchlist policy), B16 (frame-drop
tolerance), D1/D2 (challenge sequence and burst length), and finally the threshold.

**Stage 5 — documentation.** Reconcile the manual with the build for D1/D2, and correct the
README claim that landmark alignment is in use (currently false — see B2).

---

## 6. Explicitly out of scope

Will not be done, under any framing:

- Fabricating, downloading, or synthesising a PAD artifact; reinstating
  `liveness_model.pkl`; or mapping missing PAD evidence to `LIVE`.
- Restoring `MOCK_IDENTITY_DB` or making `DemoIdentityProvider` reachable in normal mode.
- Replacing YuNet/SFace with histogram, template, or correlation matching.
- Moving `FACE_MATCH_THRESHOLD`, `FACE_UNCERTAIN_BAND`, the PAD 0.20/0.80 bands, or the
  active-challenge yaw constants without a before/after measurement on held-out data.
- Making any single signal sufficient for `VERIFIED`, or collapsing the four-state
  decision space.
- Claiming an accuracy improvement without numbers.

---

## 7. Open questions

1. **D1/D2:** should the build move to the manual's three-challenge sequence, or should the
   manual be corrected to the single random challenge the code performs?
2. **B10:** what is the intended watchlist policy — does a hit always force at least
   `MANUAL_REVIEW`, and should `autoHoldWatchlist` be wired up or removed?
3. **Evaluation data:** do you have any labelled genuine/impostor pairs or live/spoof
   captures? Without them Stage 4 cannot happen, and Stage 2's fixes will have to ship as
   "architecturally correct, unmeasured".
4. **Server-authoritative decisioning (B18):** in scope for this pass, or deferred?
