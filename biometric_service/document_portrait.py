from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import cv2
import numpy as np

from face_detection import FaceDetection, FaceModelError, YuNetDetector


@dataclass(frozen=True)
class DocumentLayout:
    kind: str
    orientation: int
    expected_regions: tuple[tuple[str, tuple[float, float, float, float], float], ...]
    issues: tuple[str, ...]


@dataclass(frozen=True)
class PortraitCandidate:
    detection: FaceDetection
    score: float
    region: str
    in_expected_region: bool
    quality: dict[str, float | str | bool | None]
    issues: tuple[str, ...]


@dataclass(frozen=True)
class DocumentPortraitResult:
    status: str
    face_count: int
    selected: FaceDetection | None
    selected_score: float | None
    extraction_method: str
    layout: DocumentLayout
    candidates: tuple[PortraitCandidate, ...]
    issues: tuple[str, ...]
    confidence: float | None
    # The candidate `selected` was derived from, so callers can read its
    # quality figures without re-matching boxes across coordinate spaces.
    selected_candidate: PortraitCandidate | None = None


def _rotate(image: np.ndarray, orientation: int) -> np.ndarray:
    if orientation == 0:
        return image
    if orientation == 90:
        return cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
    if orientation == 180:
        return cv2.rotate(image, cv2.ROTATE_180)
    return cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)


def _map_box_back(box: tuple[float, float, float, float], orientation: int, original_shape: tuple[int, ...]) -> tuple[float, float, float, float]:
    x, y, w, h = box
    height, width = original_shape[:2]
    if orientation == 0:
        return box
    if orientation == 90:
        return (float(y), float(height - x - w), float(h), float(w))
    if orientation == 180:
        return (float(width - x - w), float(height - y - h), float(w), float(h))
    return (float(width - y - h), float(x), float(h), float(w))


def _map_detection_back(detection: FaceDetection, orientation: int, original_shape: tuple[int, ...]) -> FaceDetection:
    if orientation == 0:
        return detection
    box = _map_box_back(detection.box, orientation, original_shape)
    landmarks = np.asarray(detection.landmarks, dtype=np.float32).copy()
    height, width = original_shape[:2]
    if orientation == 90:
        landmarks = np.column_stack((landmarks[:, 1], height - landmarks[:, 0]))
    elif orientation == 180:
        landmarks = np.column_stack((width - landmarks[:, 0], height - landmarks[:, 1]))
    elif orientation == 270:
        landmarks = np.column_stack((width - landmarks[:, 1], landmarks[:, 0]))
    return FaceDetection(box, landmarks, detection.confidence)


def _mrz_like(image: np.ndarray) -> bool:
    """Heuristic only: detects the dense horizontal dark bands typical of an MRZ area."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape[:2]
    if h < 100 or w < 160:
        return False
    bottom = gray[int(h * 0.68):]
    dark = bottom < 120
    row_density = dark.mean(axis=1)
    runs = 0
    in_run = False
    for value in row_density:
        now = value > 0.18
        if now and not in_run:
            runs += 1
        in_run = now
    return runs >= 2


def classify_document_layout(image: np.ndarray, orientation: int = 0) -> DocumentLayout:
    h, w = image.shape[:2]
    ratio = w / max(h, 1)
    issues: list[str] = []

    if _mrz_like(image) and 1.15 <= ratio <= 1.9:
        kind = "passport_style"
        regions = (
            ("right_portrait", (0.52, 0.10, 0.43, 0.72), 0.78),
            ("left_portrait", (0.05, 0.10, 0.40, 0.72), 0.68),
        )
    elif ratio >= 1.20:
        kind = "landscape_id_or_permit"
        regions = (
            ("right_portrait", (0.55, 0.08, 0.40, 0.78), 0.76),
            ("left_portrait", (0.05, 0.08, 0.40, 0.78), 0.64),
            ("center_portrait", (0.30, 0.08, 0.40, 0.78), 0.50),
        )
    elif ratio <= 0.90:
        kind = "portrait_document"
        regions = (
            ("upper_portrait", (0.08, 0.05, 0.84, 0.55), 0.70),
            ("lower_portrait", (0.08, 0.20, 0.84, 0.65), 0.48),
        )
    else:
        kind = "unknown_layout"
        # No generic fallback region: without a layout prior, selecting the
        # largest/central face would recreate the failure mode this extractor
        # is designed to eliminate.
        regions = ()
        issues.append("UNUSUAL_DOCUMENT_LAYOUT")

    return DocumentLayout(kind, orientation, tuple(regions), tuple(issues))


def _inside_region(box: tuple[float, float, float, float], region: tuple[float, float, float, float], image_shape: tuple[int, ...]) -> bool:
    x, y, w, h = box
    rx, ry, rw, rh = region
    iw, ih = image_shape[1], image_shape[0]
    cx = x + w / 2
    cy = y + h / 2
    return rx * iw <= cx <= (rx + rw) * iw and ry * ih <= cy <= (ry + rh) * ih


def _candidate_quality(image: np.ndarray, detection: FaceDetection) -> tuple[dict[str, float | str | bool | None], list[str]]:
    x, y, w, h = detection.box
    ih, iw = image.shape[:2]
    x0, y0 = max(0, int(round(x))), max(0, int(round(y)))
    x1, y1 = min(iw, int(round(x + w))), min(ih, int(round(y + h)))
    crop = image[y0:y1, x0:x1]
    issues: list[str] = []
    sharpness = None
    brightness = None
    if crop.size:
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        brightness = float(gray.mean())
        if sharpness < 35:
            issues.append("BLURRY_FACE")
        if brightness < 45 or brightness > 215:
            issues.append("POOR_EXPOSURE")

    relative_size = (w * h) / float(max(1, iw * ih))
    if min(w, h) < 60:
        issues.append("FACE_TOO_SMALL")
    if min(w, h) < 90:
        issues.append("SMALL_PORTRAIT")
    if x <= 2 or y <= 2 or x + w >= iw - 2 or y + h >= ih - 2:
        issues.append("POOR_CROP_MARGIN")
    if detection.confidence < 0.85:
        issues.append("LOW_DETECTION_CONFIDENCE")

    return {
        "width": round(w, 2),
        "height": round(h, 2),
        "relative_size": round(relative_size, 6),
        "detection_confidence": round(detection.confidence, 6),
        "sharpness": None if sharpness is None else round(sharpness, 3),
        "brightness": None if brightness is None else round(brightness, 3),
    }, issues


def _score_candidate(image: np.ndarray, detection: FaceDetection, layout: DocumentLayout) -> PortraitCandidate:
    quality, issues = _candidate_quality(image, detection)
    best_region = "outside_expected_region"
    region_score = 0.0
    in_expected = False
    for name, region, prior in layout.expected_regions:
        if _inside_region(detection.box, region, image.shape):
            if prior > region_score:
                best_region = name
                region_score = prior
                in_expected = True

    size = float(quality["relative_size"] or 0.0)
    size_score = min(1.0, size / 0.035)
    detection_score = float(detection.confidence)
    sharpness = float(quality["sharpness"] or 0.0)
    sharpness_score = min(1.0, sharpness / 150.0)
    score = 0.48 * region_score + 0.22 * detection_score + 0.18 * size_score + 0.12 * sharpness_score
    if "FACE_TOO_SMALL" in issues:
        score -= 0.25
    if "POOR_CROP_MARGIN" in issues:
        score -= 0.12
    if "BLURRY_FACE" in issues:
        score -= 0.12
    return PortraitCandidate(detection, float(score), best_region, in_expected, quality, tuple(dict.fromkeys(issues)))


def extract_document_portrait(
    image: np.ndarray,
    detector: YuNetDetector,
    *,
    # Floor for a detection to be scored at all. The YuNet instance already
    # applies its own (higher) threshold, so this is a backstop for callers
    # that pass a more permissive detector.
    min_confidence: float = 0.75,
) -> DocumentPortraitResult:
    if image is None or image.size == 0:
        layout = classify_document_layout(np.zeros((1, 1, 3), dtype=np.uint8))
        return DocumentPortraitResult("uncertain", 0, None, None, "document-layout + face-detection", layout, (), ("INVALID_IMAGE",), None)

    original_shape = image.shape
    orientation_results: list[tuple[float, int, DocumentLayout, list[FaceDetection], list[PortraitCandidate]]] = []
    detection_errors: list[str] = []

    for orientation in (0, 90, 180, 270):
        oriented = _rotate(image, orientation)
        layout = classify_document_layout(oriented, orientation)
        try:
            detections = detector.detect(oriented)
        except FaceModelError:
            raise
        mapped = [_map_detection_back(d, orientation, original_shape) for d in detections]
        # Candidate scoring must use the oriented image because its layout regions are oriented.
        candidates = [_score_candidate(oriented, d, layout) for d in detections if d.confidence >= min_confidence]
        if candidates:
            best = max(candidates, key=lambda c: c.score)
            orientation_results.append((best.score, orientation, layout, mapped, candidates))
        else:
            orientation_results.append((0.0, orientation, layout, mapped, candidates))

    # Prefer an orientation that actually produced candidates; otherwise a
    # negative quality score could cause an empty rotation to win.
    best_score, orientation, layout, mapped_detections, candidates = max(
        orientation_results, key=lambda item: (1 if item[4] else 0, item[0])
    )
    face_count = len(mapped_detections)
    issues = list(layout.issues)

    if face_count == 0:
        return DocumentPortraitResult("uncertain", 0, None, None, "document-layout + multi-orientation face-detection", layout, tuple(candidates), tuple(dict.fromkeys([*issues, "NO_FACE"])), None)

    # Use all detections from the winning orientation for evidence, not only high-confidence candidates.
    if len(mapped_detections) > 1:
        plausible = [c for c in candidates if c.in_expected_region and "FACE_TOO_SMALL" not in c.issues]
        if len(plausible) != 1:
            return DocumentPortraitResult(
                "uncertain", face_count, None, None,
                "document-layout + expected-region face selection",
                layout, tuple(candidates), tuple(dict.fromkeys([*issues, "MULTIPLE_PLAUSIBLE_FACES"])), None,
            )
        selected_candidate = plausible[0]
    else:
        selected_candidate = candidates[0] if candidates else None
        if selected_candidate is None:
            return DocumentPortraitResult("uncertain", face_count, None, None, "face-detection", layout, (), tuple(dict.fromkeys([*issues, "NO_CONFIDENT_FACE_DETECTION"])), None)

    if not selected_candidate.in_expected_region:
        issues.append("FACE_OUTSIDE_EXPECTED_PORTRAIT_REGION")
    issues.extend(selected_candidate.issues)

    # A document portrait is not accepted merely because it is the only detected face.
    hard_failures = {"FACE_TOO_SMALL", "POOR_CROP_MARGIN", "BLURRY_FACE"}
    if hard_failures.intersection(selected_candidate.issues) or not selected_candidate.in_expected_region:
        return DocumentPortraitResult(
            "uncertain", face_count, None, selected_candidate.score,
            "document-layout + expected-region face selection + quality validation",
            layout, tuple(candidates), tuple(dict.fromkeys(issues)), max(0.0, min(1.0, selected_candidate.score)),
        )

    # Require separation from the next plausible candidate when more than one face exists.
    ranked = sorted(candidates, key=lambda c: c.score, reverse=True)
    if len(ranked) > 1 and ranked[0].in_expected_region and ranked[1].in_expected_region:
        if ranked[0].score - ranked[1].score < 0.12:
            return DocumentPortraitResult(
                "uncertain", face_count, None, ranked[0].score,
                "document-layout + candidate scoring",
                layout, tuple(candidates), tuple(dict.fromkeys([*issues, "AMBIGUOUS_PORTRAIT_CANDIDATES"])), None,
            )

    selected = _map_detection_back(selected_candidate.detection, orientation, original_shape)
    confidence = max(0.0, min(1.0, selected_candidate.score))
    return DocumentPortraitResult(
        "selected", face_count, selected, selected_candidate.score,
        "document-layout + orientation normalization + expected-region face selection + quality validation",
        layout, tuple(candidates), tuple(dict.fromkeys(issues)), confidence,
        selected_candidate,
    )
