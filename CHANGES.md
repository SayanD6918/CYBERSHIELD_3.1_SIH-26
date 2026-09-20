# CYBERSHIELD 3.1.8 — change log for this pass

Companion to `CYBERSHIELD_3.1.8_AUDIT.md`, which recorded the pre-change
state. This file records what was actually changed and why.

Two constraints held throughout: the YuNet/SFace architecture was preserved,
and **no threshold or model parameter was moved**. Every change here is a
correctness fix, and the accuracy consequences of the three biggest ones are
argued but unmeasured — see §6.

---

## 1. Bugs found

Nineteen, ordered by severity. **C** = silently wrong biometric result.

| # | Severity | Bug |
|---|---|---|
| B19 | **C** | Head-pose model frame was 180° out; the active challenge could never pass |
| B2 | **C** | SFace `alignCrop` was fed a 4-value box, so landmark alignment never happened |
| B3 | **C** | The face-match probe was the burst's last frame — the held head turn |
| B1 | **C** | `npm test` could not load `pass6-demo-isolation`; demo isolation was unguarded |
| B4 | **H** | PAD features and quality were computed on whole frames, not face crops |
| B5 | **H** | `addCase` discarded the case ID; the ID on screen never matched the stored one |
| B6 | **M** | `compare()` normalised its caller's embeddings in place |
| B7 | **M** | Detector-unavailable produced a frames/boxes length mismatch, disarming the UNCERTAIN guard |
| B8 | **M** | Malformed image payloads became HTTP 500s |
| B9 | **M** | Portrait candidates and the selected detection lived in different coordinate spaces |
| B10 | **M** | Watchlist hits could be closed as NOT_VERIFIED; `autoHoldWatchlist` did nothing |
| B11 | **M** | OCR confidence was fabricated when the TSV pass failed |
| B12 | **M** | Tesseract defaulted to a hard-coded Windows absolute path |
| B13 | **M** | Missing document-quality evidence failed open to `passed` |
| B14 | **L** | Frontend read liveness fields from the wrong response paths |
| B15 | **L** | Four dead checks and unused exports made quality gating look stronger than it was |
| B16 | **L** | One dropped frame in 36 hard-failed the challenge |
| B17 | **L** | Test suites split across pytest and unittest; pytest not in requirements |
| B20 | **M** | Watchlist matching used two-way substrings — `"Ali"` flagged `"Alistair"` |

---

## 2. Root causes

**B19 — the 180° model frame.** `MODEL_POINTS` was the generic face model
copied from the common solvePnP tutorials, which expresses the face y-up and
z-toward-viewer. OpenCV's image frame is y-down, z-away. The difference is a
proper 180° rotation about x, so solvePnP converged cleanly and returned a
pose exactly 180° out rather than failing. A frontal face measured
yaw = 180°, roll = 180°.

Consequences, all silent: `abs(initial_yaw) > 12` failed the neutral gate for
every `TURN_*`; `abs(yaw) <= 10` was unreachable for `LOOK_STRAIGHT`. The
challenge therefore returned `FAILED` for every honest attempt, which set
`evidence.challenge.status = "fail"`, which is a `hardFailure` — so **every
real verification returned NOT_VERIFIED**. The existing tests could not catch
it because they patch `estimate_head_pose` entirely and inject yaw values,
leaving the geometry with no coverage at all.

**B2 — the alignment row.** `FaceRecognizerSF::alignCrop` reads its five
alignment landmarks from columns 4 through 13 of a detector row. It was
handed `np.asarray(detection.box)` — four floats. `Mat::at` is unchecked in
release builds, so rather than raising it read adjacent memory and built the
similarity transform from it. The landmarks were available on
`FaceDetection` the whole time and simply were not passed.

**B3 — one burst, three jobs.** A single capture served the challenge, PAD
and recognition, and the probe was selected positionally (`frames[length-1]`).
For a turn challenge, the state machine waits for the held turn, so the last
frame is by construction the least frontal one in the burst.

**B4 — the unit of PAD.** `analyze_sequence` received `boxes` but only passed
them to `temporal_evidence`; `extract_features` and `image_quality` both got
the whole frame. The 1536-bin YCrCb/LUV histogram was therefore dominated by
the room. The trainer had the same shape, so the two were consistent only if
the training set was whole scenes — a face-crop dataset would have produced a
train/serve skew that passed all eight artifact validity gates.

**B1 — two module resolvers.** Vite's resolver accepts extensionless
specifiers; node's `--experimental-strip-types` ESM loader does not. The test
script uses the latter, so `finalize-verification.ts` importing
`"./risk-engine"` made the whole file unloadable — and with it the only tests
guarding demo-data isolation.

**B5 — a declared parameter that was never destructured.** The store's type
said `(record, caseId?)`; the implementation's arrow took `(record)` only.

**B10 / B20 — policy never finished.** `autoHoldWatchlist` was threaded
through the UI, the store, the Zod schema and into a function parameter, then
never read. Watchlist precedence sat below `hardFailure`, so the case most
needing a human could be auto-closed. And the matcher's two-way `includes()`
meant a short entry matched almost any traveller.

---

## 3. Files changed

**Backend**

| File | Change |
|---|---|
| `active_challenge.py` | Model frame corrected; yaw sign made subject-left-positive; frame-drop tolerance |
| `face_detection.py` | `as_detection_row()` — the 15-value row OpenCV expects |
| `face_matching.py` | Full row to `alignCrop`; copy-on-compare; candidate lookup via the portrait result |
| `document_portrait.py` | `selected_candidate` carried on the result; `min_confidence` documented |
| `liveness.py` | Rewritten: face crops, feature version v2, calibration caveat, readable structure |
| `main.py` | Rewritten: typed decode errors, parallel box slots, burst-based face match |
| `frame_selection.py` | **new** — probe-frame scoring |
| `train_liveness_model.py` | Rewritten: face crops, APCER/BPCER/ACER, documented grouping |
| `evaluate_face_matching.py` | **new** — FAR/FRR/DET/EER harness |
| `evaluate_pad.py` | **new** — held-out PAD harness |
| `_stubs/fastapi_stub.py` | **new** — lets endpoint tests run without FastAPI |
| `run_unix.sh`, `run_windows.ps1` | Loopback by default; configurable host/port |
| `run_tests.sh`, `run_tests.ps1` | **new** — one command for the whole Python suite, per platform |

**Frontend**

| File | Change |
|---|---|
| `routes/_app/verify.tsx` | Three-step challenge sequence; burst to face-match; correct evidence paths; similarity shown as a score; demo generator removed |
| `lib/analyze-document.ts` | Rewritten: local OCR only, null confidence when unmeasured, Tesseract on PATH, quality fails closed |
| `lib/risk-engine.ts` | Watchlist precedence; `autoHoldWatchlist` wired; dead export removed |
| `lib/finalize-verification.ts` | Explicit import specifiers; options parameter |
| `lib/store.ts` | Case ID honoured; officer name; seed cases and phantom baseline removed; `clearCases` |
| `lib/watchlist.ts` | **new** — token-based matching, extracted to be testable |
| `lib/format.ts` | `date-fns` replaced with `Intl` |
| `routes/_app/index.tsx` | Invented throughput chart replaced with real counts |
| `routes/_app/settings.tsx` | Demo panel replaced with provenance notice and a real action |
| `routes/__root.tsx` | Auth and PWA scaffolding removed |
| `vite.config.ts`, `package.json`, `tsconfig.json` | Simplified; 19 unused dependencies dropped |

**Removed:** `.cybershield/`, `public/__grok/`, `screenshots/`, `server/`,
`migrations/`, `src/lib/auth/`, `src/lib/app-data/`, `src/lib/multiplayer/`,
`src/lib/db.ts`, the preview-host bridge, all 30 files in `scripts/`,
`.idea/`, `AGENTS.md`, and three unused UI components.

---

## 4. Exact changes worth reading

**The model frame** (`active_challenge.py`). `MODEL_POINTS` y and z negated,
putting the model in OpenCV's image convention, and yaw negated so positive
means a subject-left turn:

```python
yaw = float(np.degrees(np.arctan2(-rotation[0, 2], rotation[2, 2])))
```

**The alignment row** (`face_detection.py` / `face_matching.py`):

```python
aligned = self._model.alignCrop(image, detection.as_detection_row())
```

where `as_detection_row()` returns `[x, y, w, h, *5×(x,y), score]` shaped
`(1, 15)` and raises `FaceModelError` if the landmarks are malformed.

**The feature contract** (`liveness.py`):

```python
FEATURE_VERSION = "face-crop-ycrcb-luv-hist-v2"
```

Bumped so any artifact built on whole frames is rejected by the existing
`FEATURE_PIPELINE_MISMATCH` gate. `crop_face()` takes a 25% margin — print
bezels and replay fringes are exactly what a PAD descriptor wants to see.

**Watchlist precedence** (`risk-engine.ts`): the hit is tested before
`hardFailure`, so a watchlisted subject reaches `MANUAL_REVIEW` rather than
being auto-closed as `NOT_VERIFIED`, and `autoHoldWatchlist` chooses the
hold lane versus the review queue.

**What was deliberately not changed:** `FACE_MATCH_THRESHOLD` (0.363),
`FACE_UNCERTAIN_BAND` (0.05), the PAD 0.20/0.80 decision band, `TARGET_YAW`,
`INITIAL_NEUTRAL_YAW`, `HOLD_FRAMES`, and the risk engine's score weights.

---

## 5. Tests

**119 total, all passing.** Before this pass: 29 ran, 5 could not load.

| Suite | Tests | Covers |
|---|---|---|
| `test_head_pose_geometry.py` | 8 | **new** — renders known head turns, pins the model convention, sign and monotonicity |
| `test_face_pipeline.py` | 26 | +12: alignment row shape and layout, side-effect-free compare, selected candidate across orientations, probe-frame selection |
| `test_service_contracts.py` | 18 | **new** — decode errors, parallel box slots, endpoint contracts, similarity never a probability |
| `test_liveness.py` | 19 | Rewritten to unittest; +14 for cropping, feature version, fail-closed paths, and a regression asserting PAD sees the crop and not the frame |
| `test_active_challenge.py` | 10 | Unchanged, still green |
| `decision-policy.test.ts` | 14 | **new** — watchlist routing, auto-hold lanes, no-single-signal-suffices for all five signals |
| `watchlist.test.ts` | 8 | **new** — token matching, partial-token rejection |
| `format.test.ts` | 6 | **new** |
| `pass6` / `pass7` | 10 | Now actually load and run |

The Python suite needs no model weights, no dataset, no pytest and no
FastAPI install.

---

## 6. Biometric metrics

**None are reported, because none were measured.**

The working environment had no network egress, so the YuNet and SFace ONNX
weights could not be fetched, and no genuine/impostor or live/spoof data was
supplied. Under the rule that no accuracy claim is made without before/after
numbers on held-out data, that means no claim is made here.

What can be said precisely:

- B19 changes the active challenge from a **0% pass rate** to a functioning
  check. That is not an accuracy estimate; it is a bug that made a stage
  unpassable, demonstrated by `test_head_pose_geometry.py`.
- B2, B3 and B4 are all expected to raise genuine-pair similarity and PAD
  separability, and all three pushed in the same direction, which is why the
  0.363 threshold must not be touched until they are measured — tuning it now
  would be compensating for defects instead of fixing them.

To produce the numbers, on a machine with the models and the data:

```bash
cd biometric_service
python evaluate_face_matching.py --dataset ./eval/faces --output after.json
python evaluate_pad.py --dataset ./eval/pad --model models/pad_model.pkl
```

To get a genuine before/after, check out the pre-change revision, run the
same harness on the same data, and diff. Minimum useful sample: ~200 genuine
pairs and ~2,000 impostor pairs from the real capture pipeline (1280 px
q0.78 document JPEG, webcam probe); for PAD, live plus print and replay
captures grouped by session.

---

## 7. Remaining limitations

1. **No PAD artifact.** Passive liveness reports `UNCERTAIN` and will until
   one is trained. This is intended behaviour, not an outage.
2. **Non-authoritative identity.** `VERIFIED` is structurally unreachable in
   normal mode. Correct, but it means the `VERIFIED` branch of the decision
   engine is exercised only by tests.
3. **Client-side decisioning.** `finalizeVerification` and `calculateRisk`
   run in the browser and cases persist to `localStorage`. Anything with
   DevTools can write a `VERIFIED` case. This is the largest gap to a
   product.
4. **Unauthenticated service.** `/api/*` accepts image uploads from any
   reachable client. Now loopback-bound by default, which is mitigation, not
   a fix.
5. **Uncalibrated everything.** The face threshold, the PAD band and the yaw
   constants are all uncalibrated, and all say so in their output.
6. **Yaw is model-relative.** Reported degrees are monotonic in true head
   angle but not equal to it.
7. **Not build-verified here.** `npm install`, `npm run build` and
   `tsc --noEmit` could not be run — no registry access. The dependency list
   changed, so run them before demonstrating.
8. **MRZ scope.** TD3 only. TD1/TD2 and non-passport MRZ are not parsed.
9. **No tamper detection.** The `tamper` check is permanently `review`; no
   forensic analysis is implemented.

---

## 8. Commands

All commands below assume your shell is already **inside the extracted
project folder** — the one containing this file, `package.json`, and
`biometric_service/`. If you just unzipped the archive, that folder is
nested one level down (`CYBERSHIELD_3.1.8/`), so the very first thing to run
is:

```bash
cd CYBERSHIELD_3.1.8
```

Every command from here on is run from that directory, in a fresh shell if
you switch terminals.

### 8.1 First-time setup

Install the Node dependencies, then fetch the two ONNX models the biometric
service needs (YuNet and SFace — not committed to the repository):

```bash
npm install
```

```bash
cd biometric_service
python download_face_models.py
cd ..
```

### 8.2 Validate

Run before trusting any change — all should pass/succeed with no network
access and no model weights required:

```bash
npm test                              # 38 TypeScript tests
```

```bash
npm run typecheck
```

```bash
npm run lint
```

**macOS/Linux:**

```bash
bash biometric_service/run_tests.sh   # 81 Python tests
```

**Windows:**

```powershell
biometric_service\run_tests.ps1       # 81 Python tests
```

### 8.3 Run the app

Two processes, in two terminals. Start the biometric service first.

**Terminal 1 — biometric service:**

```bash
cd biometric_service
./run_unix.sh        # Windows: .\run_windows.ps1
```

**Terminal 2 — operator UI:**

```bash
npm run dev
```

### 8.4 Confirm the service is healthy

```bash
curl http://127.0.0.1:8765/health
```

Check the response for:

| Field | Expected |
|---|---|
| `face_detector_loaded` | `true` |
| `face_recognizer_loaded` | `true` |
| `liveness_model_valid` | `false`, until a PAD artifact has been trained |

### 8.5 Measure biometric accuracy

Requires the models from §8.1 plus a labelled evaluation dataset (layouts
documented at the top of each script — see §4 above):

```bash
cd biometric_service
python evaluate_face_matching.py --dataset ./eval/faces --output after.json
python evaluate_pad.py --dataset ./eval/pad --model models/pad_model.pkl
```

### 8.6 Train a PAD artifact

Requires a labelled `live/` + `spoof/` dataset, grouped by recording session:

```bash
cd biometric_service
python train_liveness_model.py --dataset ./data/pad --output models/pad_model.pkl
```

---

**Windows note:** Tesseract must be on `PATH`, or set `TESSERACT_CMD` in
`.env`.
