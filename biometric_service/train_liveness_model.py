"""Train and evaluate a passive PAD artifact.

Dataset layout:

    <dataset>/live/<session>/*.jpg
    <dataset>/spoof/<session>/*.jpg

The session directory matters. Frames from one recording are highly
correlated, so splitting them across train and test inflates every metric.
GroupShuffleSplit keeps each session on one side of the split.

Features come from the same face crop the service uses at inference time
(liveness.crop_face -> liveness.extract_features). Training on whole images
while serving on face crops is a silent train/serve skew that still produces
an artifact passing every validity gate, so the detector runs here too.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import joblib
import numpy as np
from sklearn.ensemble import ExtraTreesClassifier
from sklearn.metrics import classification_report, confusion_matrix, roc_auc_score
from sklearn.model_selection import GroupShuffleSplit

from face_detection import DEFAULT_MODEL_PATH, YuNetDetector
from liveness import (
    EXPECTED_FEATURES,
    FEATURE_VERSION,
    PAD_ARTIFACT_VERSION,
    crop_face,
    extract_features,
)

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
LABELS = {"live": 0, "spoof": 1}


def face_crop_for_training(image: np.ndarray, detector: YuNetDetector | None) -> np.ndarray | None:
    """The same crop the service will see, or None if no single face is found."""
    if detector is None or not detector.loaded:
        # Already-cropped datasets are common; accept the image as-is only
        # when the caller explicitly opted out of detection.
        return image

    detections = detector.detect(image)
    if len(detections) != 1:
        return None
    return crop_face(image, detections[0].box)


def collect(root: Path, detector: YuNetDetector | None):
    features: list[np.ndarray] = []
    labels: list[int] = []
    groups: list[str] = []
    skipped = {"unreadable": 0, "no_single_face": 0}

    for name, label in LABELS.items():
        base = root / name
        if not base.exists():
            raise FileNotFoundError(base)

        for path in sorted(base.rglob("*")):
            if path.suffix.lower() not in IMAGE_EXTENSIONS:
                continue

            image = cv2.imread(str(path))
            if image is None:
                skipped["unreadable"] += 1
                continue

            crop = face_crop_for_training(image, detector)
            if crop is None:
                skipped["no_single_face"] += 1
                continue

            relative = path.relative_to(base)
            session = relative.parts[0] if len(relative.parts) > 1 else path.stem

            features.append(extract_features(crop))
            labels.append(label)
            groups.append(f"{name}/{session}")

    if not features:
        raise RuntimeError("No usable training images found")

    return (
        np.asarray(features, dtype=np.float32),
        np.asarray(labels),
        np.asarray(groups),
        skipped,
    )


def pad_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, float]:
    """ISO/IEC 30107-3 style rates. Accuracy alone hides the trade-off."""
    attacks = y_true == LABELS["spoof"]
    genuine = y_true == LABELS["live"]

    # APCER: attacks misclassified as genuine. BPCER: genuine rejected.
    apcer = float(np.mean(y_pred[attacks] == LABELS["live"])) if attacks.any() else float("nan")
    bpcer = float(np.mean(y_pred[genuine] == LABELS["spoof"])) if genuine.any() else float("nan")
    return {"apcer": apcer, "bpcer": bpcer, "acer": (apcer + bpcer) / 2.0}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("models/pad_model.pkl"))
    parser.add_argument("--yunet", type=Path, default=DEFAULT_MODEL_PATH)
    parser.add_argument(
        "--pre-cropped",
        action="store_true",
        help="Dataset images are already face crops; skip detection.",
    )
    parser.add_argument("--test-size", type=float, default=0.25)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    detector = None if args.pre_cropped else YuNetDetector(args.yunet)
    if detector is not None and not detector.loaded:
        raise SystemExit(
            f"YuNet is required to crop faces for training: {detector.load_error}\n"
            "Pass --pre-cropped if the dataset already contains face crops."
        )

    features, labels, groups, skipped = collect(args.dataset, detector)
    if len(np.unique(labels)) != 2:
        raise SystemExit("Both live and spoof classes are required")

    splitter = GroupShuffleSplit(n_splits=1, test_size=args.test_size, random_state=args.seed)
    train_index, test_index = next(splitter.split(features, labels, groups))

    classifier = ExtraTreesClassifier(
        n_estimators=300,
        min_samples_leaf=3,
        class_weight="balanced",
        random_state=args.seed,
        n_jobs=-1,
    )
    classifier.fit(features[train_index], labels[train_index])

    predictions = classifier.predict(features[test_index])
    spoof_column = list(classifier.classes_).index(LABELS["spoof"])
    probabilities = classifier.predict_proba(features[test_index])[:, spoof_column]

    evaluation = {
        "roc_auc": float(roc_auc_score(labels[test_index], probabilities)),
        **pad_metrics(labels[test_index], predictions),
        "confusion_matrix": confusion_matrix(labels[test_index], predictions).tolist(),
        "confusion_matrix_axes": "rows=true[live,spoof], cols=pred[live,spoof]",
        "classification_report": classification_report(
            labels[test_index], predictions, target_names=["live", "spoof"], output_dict=True
        ),
        "train_samples": int(len(train_index)),
        "test_samples": int(len(test_index)),
        "test_groups": int(len(set(groups[test_index]))),
        "skipped_images": skipped,
        "grouping": "session-level GroupShuffleSplit",
    }
    print(json.dumps(evaluation, indent=2))

    artifact = {
        "model": classifier,
        "metadata": {
            "artifact_version": PAD_ARTIFACT_VERSION,
            "model_name": "CyberShield-PAD-ExtraTrees",
            "model_version": PAD_ARTIFACT_VERSION,
            "feature_version": FEATURE_VERSION,
            "feature_dimensions": EXPECTED_FEATURES,
            "class_mapping": {"0": "live", "1": "spoof"},
            # Raise this only after running a real probability calibration
            # (e.g. CalibratedClassifierCV) on held-out data.
            "calibrated": False,
            "evaluation": evaluation,
        },
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(artifact, args.output)
    print("Saved:", args.output)


if __name__ == "__main__":
    main()
