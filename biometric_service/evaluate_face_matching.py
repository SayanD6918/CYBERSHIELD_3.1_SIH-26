"""Measure the document-to-camera face matcher.

There is no honest way to move FACE_MATCH_THRESHOLD without this. The
default 0.363 comes from OpenCV's SFace LFW reference and says nothing about
a population of compressed passport scans compared against webcam frames.

Dataset layout - one directory per subject:

    <dataset>/<subject_id>/document.jpg     the ID document (or scan)
    <dataset>/<subject_id>/live/*.jpg       live capture(s) of that subject

Genuine pairs are document vs that subject's own live frames. Impostor pairs
are document vs every other subject's live frames. Run it before and after a
change and diff the JSON.

    python evaluate_face_matching.py --dataset ./eval/faces --output baseline.json
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from sklearn.metrics import precision_score, recall_score, roc_auc_score

from document_portrait import extract_document_portrait
from face_detection import DEFAULT_MODEL_PATH, YuNetDetector
from face_extraction import select_single_face
from face_matching import DEFAULT_RECOGNITION_MODEL, FaceRecognizer

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


@dataclass
class Subject:
    subject_id: str
    document_embedding: np.ndarray | None
    live_embeddings: list[np.ndarray]
    failures: list[str]


def _document_embedding(path: Path, detector, recognizer, failures: list[str], document_type: str):
    image = cv2.imread(str(path))
    if image is None:
        failures.append(f"document_unreadable:{path.name}")
        return None

    portrait = extract_document_portrait(image, detector, document_type=document_type)
    if portrait.status != "selected" or portrait.selected is None:
        failures.append(f"portrait_{portrait.status}:{','.join(portrait.issues) or 'unknown'}")
        return None
    return recognizer.embedding(image, portrait.selected)


def _live_embeddings(directory: Path, detector, recognizer, failures: list[str]):
    embeddings = []
    for path in sorted(directory.iterdir()):
        if path.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        image = cv2.imread(str(path))
        if image is None:
            failures.append(f"live_unreadable:{path.name}")
            continue
        face = select_single_face(image, detector.detect(image))
        if face is None:
            failures.append(f"live_no_single_face:{path.name}")
            continue
        embeddings.append(recognizer.embedding(image, face.detection))
    return embeddings


def load_subjects(root: Path, detector, recognizer, document_type: str = "aadhaar") -> list[Subject]:
    subjects: list[Subject] = []
    for directory in sorted(p for p in root.iterdir() if p.is_dir()):
        failures: list[str] = []
        documents = [
            p for p in directory.iterdir()
            if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS
        ]
        live_dir = directory / "live"

        document_embedding = (
            _document_embedding(documents[0], detector, recognizer, failures, document_type)
            if documents
            else None
        )
        if not documents:
            failures.append("no_document_image")

        live = (
            _live_embeddings(live_dir, detector, recognizer, failures)
            if live_dir.is_dir()
            else []
        )
        if not live_dir.is_dir():
            failures.append("no_live_directory")

        subjects.append(Subject(directory.name, document_embedding, live, failures))
    return subjects


def score_pairs(subjects: list[Subject], recognizer: FaceRecognizer):
    genuine: list[float] = []
    impostor: list[float] = []

    usable = [s for s in subjects if s.document_embedding is not None and s.live_embeddings]
    for subject in usable:
        for embedding in subject.live_embeddings:
            genuine.append(recognizer.compare(subject.document_embedding, embedding))
        for other in usable:
            if other.subject_id == subject.subject_id:
                continue
            for embedding in other.live_embeddings:
                impostor.append(recognizer.compare(subject.document_embedding, embedding))

    return np.asarray(genuine), np.asarray(impostor), usable


def operating_points(genuine: np.ndarray, impostor: np.ndarray, thresholds: np.ndarray):
    """FRR and FAR at each threshold - the DET curve in tabular form."""
    points = []
    for threshold in thresholds:
        frr = float(np.mean(genuine < threshold)) if genuine.size else float("nan")
        far = float(np.mean(impostor >= threshold)) if impostor.size else float("nan")
        points.append({"threshold": round(float(threshold), 4), "frr": frr, "far": far})
    return points


def equal_error_rate(points: list[dict]) -> dict:
    finite = [p for p in points if np.isfinite(p["frr"]) and np.isfinite(p["far"])]
    if not finite:
        return {"eer": None, "threshold": None}
    best = min(finite, key=lambda p: abs(p["frr"] - p["far"]))
    return {"eer": (best["frr"] + best["far"]) / 2.0, "threshold": best["threshold"]}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("face_matching_metrics.json"))
    parser.add_argument("--yunet", type=Path, default=DEFAULT_MODEL_PATH)
    parser.add_argument("--sface", type=Path, default=DEFAULT_RECOGNITION_MODEL)
    parser.add_argument("--threshold", type=float, default=None, help="Operating point to report.")
    parser.add_argument("--document-type", default="aadhaar", help="Document type passed to portrait extraction (default: aadhaar).")
    args = parser.parse_args()

    detector = YuNetDetector(args.yunet)
    recognizer = FaceRecognizer(args.sface)
    if not detector.loaded:
        raise SystemExit(detector.load_error)
    if not recognizer.loaded:
        raise SystemExit(recognizer.load_error)

    operating_threshold = args.threshold if args.threshold is not None else recognizer.match_threshold

    subjects = load_subjects(args.dataset, detector, recognizer, args.document_type)
    genuine, impostor, usable = score_pairs(subjects, recognizer)

    if genuine.size == 0 or impostor.size == 0:
        raise SystemExit(
            "Not enough usable subjects to form both genuine and impostor pairs.\n"
            + "\n".join(f"  {s.subject_id}: {'; '.join(s.failures)}" for s in subjects if s.failures)
        )

    thresholds = np.round(np.arange(0.00, 1.001, 0.01), 4)
    points = operating_points(genuine, impostor, thresholds)
    operating_frr = float(np.mean(genuine < operating_threshold))
    operating_far = float(np.mean(impostor >= operating_threshold))
    at_operating = {
        "threshold": float(operating_threshold),
        "frr": operating_frr,
        "far": operating_far,
    }

    # Confusion matrix at the operating point, in the service's own
    # three-state vocabulary.
    band = recognizer.uncertain_band
    def classify(score: float) -> str:
        if score >= operating_threshold + band:
            return "MATCH"
        if score <= operating_threshold - band:
            return "NO_MATCH"
        return "UNCERTAIN"

    confusion = {
        "genuine": {state: 0 for state in ("MATCH", "UNCERTAIN", "NO_MATCH")},
        "impostor": {state: 0 for state in ("MATCH", "UNCERTAIN", "NO_MATCH")},
    }
    for score in genuine:
        confusion["genuine"][classify(float(score))] += 1
    for score in impostor:
        confusion["impostor"][classify(float(score))] += 1

    y_true = np.concatenate([np.ones(genuine.size, dtype=int), np.zeros(impostor.size, dtype=int)])
    y_score = np.concatenate([genuine, impostor])
    roc_auc = float(roc_auc_score(y_true, y_score)) if len(np.unique(y_true)) == 2 else None
    predicted = (y_score >= operating_threshold).astype(int)

    report = {
        "metric": "cosine_similarity",
        "note": "Similarity is a distance-derived score, not a probability of identity.",
        "model": "SFace/face_recognition_sface_2021dec",
        "operating_threshold": operating_threshold,
        "uncertain_band": band,
        "document_type": args.document_type,
        "genuine_similarity_values": [float(v) for v in genuine],
        "impostor_similarity_values": [float(v) for v in impostor],
        "subjects_total": len(subjects),
        "subjects_usable": len(usable),
        "genuine_pairs": int(genuine.size),
        "impostor_pairs": int(impostor.size),
        "genuine_similarity": {
            "mean": float(genuine.mean()), "std": float(genuine.std()),
            "min": float(genuine.min()), "p05": float(np.percentile(genuine, 5)),
            "median": float(np.median(genuine)), "max": float(genuine.max()),
        },
        "impostor_similarity": {
            "mean": float(impostor.mean()), "std": float(impostor.std()),
            "min": float(impostor.min()), "p95": float(np.percentile(impostor, 95)),
            "median": float(np.median(impostor)), "max": float(impostor.max()),
        },
        "at_operating_threshold": at_operating,
        "equal_error_rate": equal_error_rate(points),
        "roc_auc": roc_auc,
        "precision_at_operating_threshold": float(precision_score(y_true, predicted, zero_division=0)),
        "recall_at_operating_threshold": float(recall_score(y_true, predicted, zero_division=0)),
        "three_state_confusion": confusion,
        "det_curve": points,
        "per_subject_failures": {s.subject_id: s.failures for s in subjects if s.failures},
    }

    args.output.write_text(json.dumps(report, indent=2))
    summary = {k: report[k] for k in (
        "genuine_pairs", "impostor_pairs", "at_operating_threshold", "equal_error_rate"
    )}
    print(json.dumps({**summary, "roc_auc": roc_auc}, indent=2))
    print("Full report:", args.output)


if __name__ == "__main__":
    main()
