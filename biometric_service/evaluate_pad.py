"""Measure a trained passive PAD artifact on held-out captures.

Run this against data the artifact was never trained on. The trainer already
reports metrics on its own split; this exists so the artifact can be
re-checked independently and so PAD and face matching are never conflated
into one "accuracy" number.

Dataset layout mirrors the trainer:

    <dataset>/live/<session>/*.jpg
    <dataset>/spoof/<session>/*.jpg

    python evaluate_pad.py --dataset ./eval/pad --model models/pad_model.pkl
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from face_detection import DEFAULT_MODEL_PATH, YuNetDetector
from liveness import (
    LIVE_DECISION_THRESHOLD,
    SPOOF_DECISION_THRESHOLD,
    crop_face,
    load_pad_model,
    predict_pad,
)

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def collect_scores(root: Path, detector, model, info, pre_cropped: bool):
    scores: dict[str, list[float]] = {"live": [], "spoof": []}
    skipped = {"unreadable": 0, "no_single_face": 0}

    for label in ("live", "spoof"):
        base = root / label
        if not base.exists():
            raise FileNotFoundError(base)

        for path in sorted(base.rglob("*")):
            if path.suffix.lower() not in IMAGE_EXTENSIONS:
                continue
            image = cv2.imread(str(path))
            if image is None:
                skipped["unreadable"] += 1
                continue

            if pre_cropped:
                crop = image
            else:
                detections = detector.detect(image)
                crop = crop_face(image, detections[0].box) if len(detections) == 1 else None

            if crop is None:
                skipped["no_single_face"] += 1
                continue

            scores[label].append(predict_pad(model, info, crop))

    return scores, skipped


def rates(live: np.ndarray, spoof: np.ndarray) -> dict:
    """Three-state outcome counts, plus APCER/BPCER/ACER on the decided ones."""
    def bucket(values: np.ndarray) -> dict[str, int]:
        return {
            "SPOOF": int(np.sum(values >= SPOOF_DECISION_THRESHOLD)),
            "UNCERTAIN": int(
                np.sum((values > LIVE_DECISION_THRESHOLD) & (values < SPOOF_DECISION_THRESHOLD))
            ),
            "LIVE": int(np.sum(values <= LIVE_DECISION_THRESHOLD)),
        }

    live_counts = bucket(live)
    spoof_counts = bucket(spoof)

    # An attack accepted as live, and a genuine capture rejected as spoof.
    apcer = spoof_counts["LIVE"] / len(spoof) if len(spoof) else float("nan")
    bpcer = live_counts["SPOOF"] / len(live) if len(live) else float("nan")

    return {
        "live_outcomes": live_counts,
        "spoof_outcomes": spoof_counts,
        "apcer": apcer,
        "bpcer": bpcer,
        "acer": (apcer + bpcer) / 2.0,
        "undecided_rate": (live_counts["UNCERTAIN"] + spoof_counts["UNCERTAIN"])
        / max(1, len(live) + len(spoof)),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--model", type=Path, default=Path("models/pad_model.pkl"))
    parser.add_argument("--yunet", type=Path, default=DEFAULT_MODEL_PATH)
    parser.add_argument("--pre-cropped", action="store_true")
    parser.add_argument("--output", type=Path, default=Path("pad_metrics.json"))
    args = parser.parse_args()

    model, info = load_pad_model(args.model)
    if model is None:
        raise SystemExit(
            "PAD artifact is not usable: " + "; ".join(info.issues) + "\n"
            "Train one with train_liveness_model.py. Nothing here fabricates a model."
        )

    detector = None
    if not args.pre_cropped:
        detector = YuNetDetector(args.yunet)
        if not detector.loaded:
            raise SystemExit(detector.load_error)

    scores, skipped = collect_scores(args.dataset, detector, model, info, args.pre_cropped)
    live = np.asarray(scores["live"])
    spoof = np.asarray(scores["spoof"])
    if live.size == 0 or spoof.size == 0:
        raise SystemExit("Both live and spoof samples are required.")

    try:
        from sklearn.metrics import roc_auc_score

        labels = np.concatenate([np.zeros(live.size), np.ones(spoof.size)])
        auc = float(roc_auc_score(labels, np.concatenate([live, spoof])))
    except Exception:
        auc = None

    report = {
        "model": info.model_name,
        "model_version": info.model_version,
        "feature_version": info.feature_version,
        "calibrated": info.calibrated,
        "decision_band": {"live_at_or_below": LIVE_DECISION_THRESHOLD, "spoof_at_or_above": SPOOF_DECISION_THRESHOLD},
        "samples": {"live": int(live.size), "spoof": int(spoof.size)},
        "skipped_images": skipped,
        "roc_auc": auc,
        **rates(live, spoof),
        "note": "Scores are classifier outputs; they are calibrated probabilities only if 'calibrated' is true.",
    }

    args.output.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
