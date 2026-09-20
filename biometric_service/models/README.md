# Model files

No pretrained weights are committed to this repository.

## Face models (required)

```bash
python ../download_face_models.py
```

Or place them here manually / point the environment at them:

| File | Variable | Source |
|---|---|---|
| `face_detection_yunet_2023mar.onnx` | `YUNET_MODEL_PATH` | [opencv_zoo/face_detection_yunet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) |
| `face_recognition_sface_2021dec.onnx` | `SFACE_MODEL_PATH` | [opencv_zoo/face_recognition_sface](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface) |

YuNet supplies the box and the five landmarks; SFace uses those landmarks to
align the crop before embedding. The service fails explicitly when either is
unavailable and never falls back to histogram, template or pixel-correlation
matching.

OpenCV Zoo documents YuNet under MIT and SFace under Apache-2.0. Model and
training-data provenance should still be reviewed before any production or
commercial deployment.

## Passive PAD model (optional, none supplied)

Place a trained artifact at `pad_model.pkl`, or point `LIVENESS_MODEL_PATH`
at one. It must satisfy every gate in `load_pad_model`:

- a dict with `model` and `metadata` keys
- a probabilistic classifier exposing `predict_proba` and `classes_`
- exactly 1536 input features
- `feature_version` of `face-crop-ycrcb-luv-hist-v2`
- an explicit `class_mapping` of `{"0": "live", "1": "spoof"}` agreeing with
  the model's own `classes_`
- non-degenerate trees

Build one with `train_liveness_model.py`, which writes all of the above plus
held-out evaluation metrics into the metadata.

Anything that fails a gate is refused, and passive liveness reports
`UNCERTAIN`. That is the intended behaviour: an unvalidated artifact must
never stand in for a liveness decision.
