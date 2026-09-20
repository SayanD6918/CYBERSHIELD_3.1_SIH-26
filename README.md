# CyberShield biometric service

FastAPI service exposing three deliberately independent signals. None of
them is sufficient on its own; the operator UI's risk engine fuses them with
document, MRZ, identity-provider and watchlist evidence.

| Endpoint | Purpose |
|---|---|
| `GET /health` | Model load state, versions, thresholds — all reported honestly |
| `POST /api/liveness` | Passive presentation-attack detection over a frame burst |
| `POST /api/active-challenge` | One machine-verified head movement |
| `POST /api/face-match` | Document portrait vs live face, by embedding |

## Face matching

```text
document image                         live capture burst
      |                                        |
4-orientation sweep                   per-frame detection
      |                                        |
layout classification                 frontality + sharpness scoring
      |                                        |
expected-region scoring               best probe frame
      |                                        |
quality gate                                   |
      +--------------> YuNet 5 landmarks <-----+
                              |
                    SFace alignCrop (full 15-value detection row)
                              |
                       SFace embedding
                              |
                     explicit L2 normalisation
                              |
                       cosine similarity
                              |
                 MATCH / NO_MATCH / UNCERTAIN
```

Two things worth knowing about this path:

**Alignment.** `alignCrop` reads the five landmarks from columns 4–13 of a
detector row. Handing it a bare four-value bounding box makes it read past
the end of the array and build the warp from whatever follows in memory — it
raises nothing and produces plausible-looking garbage. `FaceDetection.as_detection_row()`
builds the full row, and `test_face_pipeline.py` asserts its shape and layout.

**Probe frame.** The browser sends one burst serving three purposes. Taking
its last frame as the recognition probe meant recognising a turned head, so
`frame_selection.py` scores every frame on frontality, sharpness and face
size and returns the best, along with the reasons frames were skipped.

Portrait extraction never picks "the largest face". It classifies the layout,
scores candidates against expected portrait regions, and returns `uncertain`
rather than guessing when the document is ambiguous or the crop is poor.

## Thresholds

`FACE_MATCH_THRESHOLD` defaults to `0.363` — OpenCV's SFace LFW reference
figure. It is **not calibrated for a document-to-camera population**, and
`/health` and every response say so via `calibrated: false`.
`FACE_UNCERTAIN_BAND` (`0.05`) is an application policy band, not a
statistical interval.

A cosine similarity is a similarity measurement. Responses carry the raw
score, the metric, the threshold, the model and its version so the caller can
never mistake it for a probability.

Use `evaluate_face_matching.py` before touching either value.

## Passive PAD

```text
burst -> YuNet detection -> face crops -> quality -> temporal evidence
                                  |
                           validated PAD model
                                  |
                      LIVE / SPOOF / UNCERTAIN
```

**Features come from face crops**, with a 25% margin so print bezels and
replay fringes stay in frame. An earlier revision computed the 1536-bin
YCrCb/LUV histogram over the whole frame, which let the room dominate the
descriptor and meant one of the four quality gates could never fire. The
feature contract is versioned `face-crop-ycrcb-luv-hist-v2`; an artifact
built against the old whole-frame contract is rejected with
`FEATURE_PIPELINE_MISMATCH` rather than silently reused.

**No PAD artifact ships here.** `load_pad_model` runs eight validity gates —
dict shape, `predict_proba`, feature dimension, feature version, class
mapping, mapping/`classes_` agreement, model type, and degenerate trees — and
every failure returns `(None, info)`. There is no code path that yields a
classifier from an artifact that did not pass all of them. When none is
available the service returns `UNCERTAIN` and names the reason.

Training:

```bash
python train_liveness_model.py --dataset ./data/pad --output models/pad_model.pkl
```

The dataset is `live/<session>/*.jpg` and `spoof/<session>/*.jpg`. Session
grouping is enforced with `GroupShuffleSplit`: frames from one recording are
highly correlated, and splitting them across train and test inflates every
metric. The trainer crops faces exactly as the service does, and records
ROC-AUC, APCER, BPCER, ACER and the confusion matrix into the artifact's
metadata. `calibrated` stays `false` until a real probability calibration is
run, and an uncalibrated `LIVE` verdict carries a `PAD_MODEL_NOT_CALIBRATED`
caveat in its evidence.

## Active challenge

```text
challenge -> burst -> YuNet 5 landmarks -> solvePnP (SQPNP)
    -> initial-pose gate -> movement -> target yaw -> multi-frame hold
```

Independent of passive PAD by construction: this endpoint never reads
`liveness_status`, and passing here says only that the requested movement
was observed.

**On the 3-D model frame.** `MODEL_POINTS` is expressed in OpenCV's image
convention: +x right, +y down, +z away from the camera. The widely copied
version of this generic face model uses y-up and z-toward-viewer, which is a
180° rotation away from the camera frame — with it, a perfectly frontal face
measured yaw = 180° and roll = 180°, every `TURN_*` failed its neutral gate,
and `LOOK_STRAIGHT` could never reach its target. `test_head_pose_geometry.py`
renders synthetic landmarks from known head turns and pins the convention.

Yaw is positive when the subject turns to their own left, matching the
on-screen instruction against an unmirrored camera frame. It is reported in
**uncalibrated model-relative degrees**, not true head angle — the generic
model's proportions differ from any real face, so the mapping is monotonic
but not metric.

A face is allowed to drop out of a few frames (`MIN_FACE_CONTINUITY = 0.85`,
no gap longer than 3). Demanding a detection in literally every frame turned
a blink into a hard failure.

## Models

Two ONNX files are required and are not committed:

```bash
python download_face_models.py
```

See `models/README.md` for sources and licensing notes. The service fails
explicitly when either is missing — it never substitutes histogram, template
or pixel-correlation matching.

## Tests

```bash
./run_tests.sh          # macOS/Linux: 81 tests, stdlib unittest only
```

```powershell
.\run_tests.ps1          # Windows equivalent
```

No model weights, no pytest, no FastAPI install needed: `_stubs/fastapi_stub.py`
stands in for the framework so endpoint contracts are still covered.
