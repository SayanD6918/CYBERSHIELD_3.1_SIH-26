"""Passive presentation-attack detection.

The camera sends a burst of frames; this module turns that burst into
evidence. Face crops feed the PAD classifier and the per-frame quality
checks, while the bounding boxes across the burst feed the temporal checks
(tracking stability, scale stability, motion).

Nothing here ever invents a verdict. When the PAD artifact is missing or
fails validation the module reports UNCERTAIN and says why, rather than
letting an unvalidated probability stand in for liveness.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

import cv2
import joblib
import numpy as np

# Bumped from "legacy-ycrcb-luv-hist-v1" when PAD moved from whole frames to
# face crops. An artifact trained against the old contract measures a
# different thing entirely, so it must be rejected rather than reused: the
# FEATURE_PIPELINE_MISMATCH gate in load_pad_model() does that.
FEATURE_VERSION = "face-crop-ycrcb-luv-hist-v2"
SUPPORTED_PAD_FEATURE_VERSIONS = {FEATURE_VERSION}
PAD_ARTIFACT_VERSION = "3.0.0"
EXPECTED_FEATURES = 1536
MIN_FRAMES = 5

# Context kept around the detector box before feature extraction. Print and
# replay attacks often show their tell at the edge of the face - a bezel, a
# paper border, a moire fringe - so a little margin helps.
FACE_CROP_MARGIN = 0.25
MIN_CROP_EDGE = 32

SPOOF_DECISION_THRESHOLD = 0.80
LIVE_DECISION_THRESHOLD = 0.20
MAX_FRAME_DISAGREEMENT = 0.18


@dataclass(frozen=True)
class QualityEvidence:
    sharpness: float
    brightness: float
    contrast: float
    saturation: float
    clipping_ratio: float
    issues: tuple[str, ...]


@dataclass(frozen=True)
class TemporalEvidence:
    frame_count: int
    face_count_consistent: bool
    mean_iou: float
    bbox_center_jitter: float
    bbox_size_cv: float
    median_motion: float
    frame_difference: float
    issues: tuple[str, ...]


@dataclass(frozen=True)
class PadModelInfo:
    loaded: bool
    valid: bool
    model_name: str
    model_version: str
    feature_version: str
    class_mapping: dict[int, str]
    calibrated: bool
    issues: tuple[str, ...]


def crop_face(
    frame: np.ndarray,
    box: Sequence[float] | None,
    margin: float = FACE_CROP_MARGIN,
) -> np.ndarray | None:
    """Cut the face (plus a margin) out of a frame.

    Returns None when there is no box or the resulting crop is too small to
    carry a usable colour histogram, so the caller can drop that frame from
    the PAD sample instead of silently scoring the background.
    """
    if box is None or frame is None or frame.size == 0:
        return None

    x, y, w, h = (float(v) for v in box)
    if w <= 0 or h <= 0:
        return None

    pad_x = w * margin
    pad_y = h * margin
    height, width = frame.shape[:2]

    x0 = max(0, int(round(x - pad_x)))
    y0 = max(0, int(round(y - pad_y)))
    x1 = min(width, int(round(x + w + pad_x)))
    y1 = min(height, int(round(y + h + pad_y)))

    if x1 - x0 < MIN_CROP_EDGE or y1 - y0 < MIN_CROP_EDGE:
        return None

    crop = frame[y0:y1, x0:x1]
    return crop if crop.size else None


def calc_hist(img: np.ndarray) -> np.ndarray:
    channels = []
    for channel in range(3):
        hist = cv2.calcHist([img], [channel], None, [256], [0, 256]).reshape(-1)
        peak = float(hist.max()) or 1e-5
        channels.append(hist * (255.0 / peak))
    return np.asarray(channels, dtype=np.float32)


def extract_features(face: np.ndarray) -> np.ndarray:
    """1536-d YCrCb + LUV histogram descriptor for one face crop.

    The input must be a face crop, not a whole frame - see FEATURE_VERSION.
    """
    if face is None or face.size == 0:
        raise ValueError("Empty face crop")
    ycrcb = cv2.cvtColor(face, cv2.COLOR_BGR2YCR_CB)
    luv = cv2.cvtColor(face, cv2.COLOR_BGR2LUV)
    return np.append(calc_hist(ycrcb).ravel(), calc_hist(luv).ravel()).astype(np.float32)


def image_quality(face: np.ndarray) -> QualityEvidence:
    """Quality of one face crop. Poor input makes the PAD score meaningless."""
    gray = cv2.cvtColor(face, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(face, cv2.COLOR_BGR2HSV)

    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    brightness = float(gray.mean())
    contrast = float(gray.std())
    saturation = float(hsv[:, :, 1].mean()) if hsv.size else 0.0
    clipping = float(np.mean((gray <= 3) | (gray >= 252))) if gray.size else 1.0

    issues: list[str] = []
    if sharpness < 35:
        issues.append("BLURRY_FACE")
    if brightness < 45 or brightness > 215:
        issues.append("POOR_EXPOSURE")
    if contrast < 18:
        issues.append("LOW_CONTRAST")
    if clipping > 0.18:
        issues.append("HIGHLIGHT_SHADOW_CLIPPING")
    if face.shape[0] < 90 or face.shape[1] < 90:
        issues.append("FACE_TOO_SMALL")

    return QualityEvidence(
        sharpness, brightness, contrast, saturation, clipping, tuple(dict.fromkeys(issues))
    )


def _iou(a: Sequence[float], b: Sequence[float]) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ix1, iy1 = max(ax, bx), max(ay, by)
    ix2, iy2 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    intersection = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    union = aw * ah + bw * bh - intersection
    return float(intersection / union) if union > 0 else 0.0


def temporal_evidence(frames: Sequence[np.ndarray], boxes: Sequence[Any]) -> TemporalEvidence:
    """Stability and motion across the burst.

    A photograph held in front of the camera tends to track cleanly but move
    as one rigid plane; a screen replay often shows too little frame-to-frame
    variation. Neither is decisive on its own, which is why this is evidence
    rather than a verdict.
    """
    frame_count = len(frames)
    tracked = [np.asarray(b, dtype=np.float32) for b in boxes if b is not None]
    consistent = len(tracked) == frame_count and frame_count > 0

    if len(tracked) >= 2:
        ious = [_iou(tracked[i - 1], tracked[i]) for i in range(1, len(tracked))]
        centers = np.asarray([[b[0] + b[2] / 2, b[1] + b[3] / 2] for b in tracked])
        sizes = np.asarray([max(1.0, b[2] * b[3]) for b in tracked])
        dims = np.asarray([[frames[i].shape[1], frames[i].shape[0]] for i in range(len(tracked))])
        jitter = float(np.mean(np.linalg.norm(np.diff(centers / dims, axis=0), axis=1)))
        size_cv = float(np.std(sizes) / max(float(np.mean(sizes)), 1e-6))
    else:
        ious, jitter, size_cv = [], 0.0, 0.0

    motions: list[float] = []
    differences: list[float] = []
    for i in range(1, frame_count):
        previous = cv2.resize(cv2.cvtColor(frames[i - 1], cv2.COLOR_BGR2GRAY), (160, 120))
        current = cv2.resize(cv2.cvtColor(frames[i], cv2.COLOR_BGR2GRAY), (160, 120))
        differences.append(float(np.mean(cv2.absdiff(previous, current))))
        flow = cv2.calcOpticalFlowFarneback(previous, current, None, 0.5, 3, 15, 3, 5, 1.2, 0)
        motions.append(float(np.median(np.linalg.norm(flow, axis=2))))

    mean_iou = float(np.mean(ious)) if ious else 0.0
    median_motion = float(np.median(motions)) if motions else 0.0
    frame_difference = float(np.median(differences)) if differences else 0.0

    issues: list[str] = []
    if not consistent:
        issues.append("FACE_TRACKING_INCONSISTENT")
    if ious and mean_iou < 0.55:
        issues.append("FACE_TRACKING_JITTER")
    if size_cv > 0.30:
        issues.append("FACE_SCALE_INCONSISTENT")
    if frame_count >= MIN_FRAMES and median_motion < 0.08 and frame_difference < 1.5:
        issues.append("LOW_TEMPORAL_VARIATION")

    return TemporalEvidence(
        frame_count,
        consistent,
        mean_iou,
        jitter,
        size_cv,
        median_motion,
        frame_difference,
        tuple(dict.fromkeys(issues)),
    )


def load_pad_model(path: Path) -> tuple[Any | None, PadModelInfo]:
    """Load and validate a PAD artifact, or explain why it cannot be used.

    Every failure returns (None, info): there is deliberately no path that
    yields a usable classifier from an artifact that did not pass all of the
    checks below.
    """
    if not path.exists():
        return None, PadModelInfo(
            False, False, "CyberShield-PAD", "unavailable", FEATURE_VERSION, {}, False,
            ("MODEL_FILE_NOT_FOUND",),
        )

    try:
        artifact = joblib.load(path)
    except Exception as exc:
        return None, PadModelInfo(
            False, False, "CyberShield-PAD", "load-error", FEATURE_VERSION, {}, False,
            (f"MODEL_LOAD_ERROR:{type(exc).__name__}", str(exc)),
        )

    if not isinstance(artifact, dict) or "model" not in artifact or "metadata" not in artifact:
        return None, PadModelInfo(
            False, False, "Legacy-ExtraTrees-PAD", "unversioned", FEATURE_VERSION, {}, False,
            ("MODEL_METADATA_MISSING", "CLASS_SEMANTICS_UNVERIFIED"),
        )

    model = artifact["model"]
    metadata = artifact["metadata"]
    issues: list[str] = []

    if not hasattr(model, "predict_proba") or not hasattr(model, "classes_"):
        issues.append("MODEL_NOT_PROBABILISTIC")
    if getattr(model, "n_features_in_", None) != EXPECTED_FEATURES:
        issues.append("FEATURE_DIMENSION_MISMATCH")
    if metadata.get("feature_version") not in SUPPORTED_PAD_FEATURE_VERSIONS:
        issues.append("FEATURE_PIPELINE_MISMATCH")

    declared_mapping = metadata.get("class_mapping")
    class_mapping: dict[int, str] = {}
    if isinstance(declared_mapping, dict):
        for key, value in declared_mapping.items():
            try:
                class_mapping[int(key)] = str(value).lower()
            except (TypeError, ValueError):
                issues.append("INVALID_CLASS_MAPPING")
    else:
        issues.append("CLASS_SEMANTICS_UNVERIFIED")

    if {int(c) for c in getattr(model, "classes_", [])} != set(class_mapping):
        issues.append("CLASS_MAPPING_DOES_NOT_MATCH_MODEL")

    from sklearn.ensemble import ExtraTreesClassifier

    if not isinstance(model, ExtraTreesClassifier):
        issues.append("UNEXPECTED_MODEL_TYPE")

    trees = getattr(model, "estimators_", [])
    if not trees or all(getattr(tree.tree_, "node_count", 1) <= 1 for tree in trees):
        issues.append("DEGENERATE_MODEL_NO_SPLITS")

    info = PadModelInfo(
        loaded=not issues,
        valid=not issues,
        model_name=str(metadata.get("model_name", "CyberShield-PAD")),
        model_version=str(metadata.get("model_version", "unknown")),
        feature_version=str(metadata.get("feature_version", "unknown")),
        class_mapping=class_mapping,
        calibrated=bool(metadata.get("calibrated", False)),
        issues=tuple(dict.fromkeys(issues)),
    )
    return (model if info.valid else None), info


def predict_pad(model: Any, info: PadModelInfo, face: np.ndarray) -> float:
    """Probability that one face crop is a presentation attack."""
    probabilities = np.asarray(
        model.predict_proba(extract_features(face).reshape(1, -1))[0], dtype=float
    )
    positions = {int(cls): index for index, cls in enumerate(model.classes_)}
    spoof_class = next((cls for cls, label in info.class_mapping.items() if label == "spoof"), None)
    if spoof_class is None or spoof_class not in positions:
        raise ValueError("No explicit spoof class in PAD artifact")
    return float(np.clip(probabilities[positions[spoof_class]], 0.0, 1.0))


def aggregate_spoof_probability(values: Sequence[float]) -> tuple[float, float]:
    """Median across the burst, plus the spread used to spot disagreement."""
    samples = np.asarray(values, dtype=np.float64)
    return float(np.median(samples)), float(np.std(samples))


def decide(
    spoof_probability: float,
    quality_issues: Sequence[str],
    temporal: TemporalEvidence,
    *,
    calibrated: bool,
) -> tuple[str, float, list[str]]:
    """Turn a spoof probability plus context into LIVE / SPOOF / UNCERTAIN.

    Returns the verdict, a confidence, and any caveats that belong in the
    evidence record.
    """
    caveats: list[str] = []

    if {"BLURRY_FACE", "POOR_EXPOSURE", "FACE_TOO_SMALL"}.intersection(quality_issues):
        return "UNCERTAIN", 0.5, caveats
    if {"FACE_TRACKING_INCONSISTENT", "FACE_TRACKING_JITTER"}.intersection(temporal.issues):
        return "UNCERTAIN", 0.5, caveats

    confidence = max(spoof_probability, 1.0 - spoof_probability)

    if spoof_probability >= SPOOF_DECISION_THRESHOLD:
        return "SPOOF", confidence, caveats
    if spoof_probability <= LIVE_DECISION_THRESHOLD:
        # The score is a classifier output, not a calibrated probability,
        # unless the artifact says otherwise. Say so rather than dropping the
        # flag on the floor.
        if not calibrated:
            caveats.append("PAD_MODEL_NOT_CALIBRATED")
        return "LIVE", confidence, caveats
    return "UNCERTAIN", confidence, caveats


def _unavailable(
    model_info: PadModelInfo,
    issues: Sequence[str],
    *,
    evidence: dict[str, Any] | None = None,
    quality: dict[str, float] | None = None,
) -> dict[str, Any]:
    return {
        "liveness_status": "UNCERTAIN",
        "confidence": 0.0,
        "model": model_info.model_name,
        "model_version": model_info.model_version,
        "feature_version": FEATURE_VERSION,
        "model_loaded": model_info.loaded,
        "model_valid": model_info.valid,
        "calibrated": model_info.calibrated,
        "evidence": evidence or {},
        "quality": quality or {},
        "issues": list(dict.fromkeys(issues)),
        "active_challenge": {"status": "NOT_RUN"},
    }


def analyze_sequence(
    frames: Sequence[np.ndarray],
    boxes: Sequence[Any],
    model: Any | None,
    model_info: PadModelInfo,
) -> dict[str, Any]:
    """Score a camera burst.

    `boxes` must line up one-to-one with `frames`; a None entry means no
    single unambiguous face was found in that frame.
    """
    if len(frames) < MIN_FRAMES:
        return _unavailable(model_info, [f"INSUFFICIENT_FRAMES:{len(frames)}/{MIN_FRAMES}"])

    if len(boxes) != len(frames):
        # A caller that cannot supply one box per frame cannot have measured
        # a face in each of them, so there is nothing to be confident about.
        return _unavailable(model_info, ["FACE_EVIDENCE_INCOMPLETE"])

    crops = [crop_face(frame, box) for frame, box in zip(frames, boxes)]
    usable = [crop for crop in crops if crop is not None]

    temporal = temporal_evidence(frames, boxes)

    if len(usable) < MIN_FRAMES:
        return _unavailable(
            model_info,
            [*model_info.issues, *temporal.issues, f"INSUFFICIENT_FACE_CROPS:{len(usable)}/{MIN_FRAMES}"],
            evidence={"frames_analyzed": len(frames), "face_crops": len(usable), "temporal": temporal.__dict__},
        )

    qualities = [image_quality(crop) for crop in usable]
    quality_issues = sorted({issue for quality in qualities for issue in quality.issues})
    quality_summary = {
        "sharpness_median": float(np.median([q.sharpness for q in qualities])),
        "brightness_median": float(np.median([q.brightness for q in qualities])),
        "contrast_median": float(np.median([q.contrast for q in qualities])),
        "saturation_median": float(np.median([q.saturation for q in qualities])),
        "clipping_ratio_median": float(np.median([q.clipping_ratio for q in qualities])),
    }
    issues = list(dict.fromkeys([*model_info.issues, *quality_issues, *temporal.issues]))

    if model is None:
        return _unavailable(
            model_info,
            issues,
            evidence={
                "frames_analyzed": len(frames),
                "face_crops": len(usable),
                "temporal": temporal.__dict__,
                "pad": {"status": "UNAVAILABLE"},
            },
            quality=quality_summary,
        )

    probabilities = [predict_pad(model, model_info, crop) for crop in usable]
    spoof_probability, dispersion = aggregate_spoof_probability(probabilities)
    status, confidence, caveats = decide(
        spoof_probability, quality_issues, temporal, calibrated=model_info.calibrated
    )
    issues.extend(caveats)

    if dispersion > MAX_FRAME_DISAGREEMENT and status != "SPOOF":
        status = "UNCERTAIN"
        issues.append("PAD_FRAME_DISAGREEMENT")

    return {
        "liveness_status": status,
        "confidence": round(confidence, 4),
        "model": model_info.model_name,
        "model_version": model_info.model_version,
        "feature_version": FEATURE_VERSION,
        "model_loaded": True,
        "model_valid": model_info.valid,
        "calibrated": model_info.calibrated,
        "evidence": {
            "frames_analyzed": len(frames),
            "face_crops": len(usable),
            "temporal": temporal.__dict__,
            "pad": {
                "spoof_probability_median": round(spoof_probability, 4),
                "spoof_probability_std": round(dispersion, 4),
                "per_frame_spoof_probability": [round(p, 4) for p in probabilities],
            },
        },
        "quality": quality_summary,
        "issues": list(dict.fromkeys(issues)),
        "active_challenge": {"status": "NOT_RUN"},
    }
