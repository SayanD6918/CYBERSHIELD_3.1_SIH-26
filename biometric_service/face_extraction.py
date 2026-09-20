from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from face_detection import FaceDetection


@dataclass(frozen=True)
class FaceQuality:
    face_count: int
    box_width: float | None
    box_height: float | None
    relative_size: float | None
    detection_confidence: float | None
    sharpness: float | None
    brightness: float | None
    pose: str | None
    alignment_quality: str
    issues: tuple[str, ...]


@dataclass(frozen=True)
class ExtractedFace:
    image: np.ndarray
    detection: FaceDetection
    quality: FaceQuality


def _quality(image: np.ndarray, detection: FaceDetection, face_count: int) -> FaceQuality:
    x, y, w, h = detection.box
    x0 = max(0, int(round(x)))
    y0 = max(0, int(round(y)))
    x1 = min(image.shape[1], int(round(x + w)))
    y1 = min(image.shape[0], int(round(y + h)))
    crop = image[y0:y1, x0:x1]

    issues: list[str] = []
    if face_count != 1:
        issues.append("MULTIPLE_FACES" if face_count > 1 else "NO_FACE")

    relative_size = (w * h) / float(max(1, image.shape[0] * image.shape[1]))
    if min(w, h) < 80:
        issues.append("FACE_TOO_SMALL")
    if detection.confidence < 0.9:
        issues.append("LOW_DETECTION_CONFIDENCE")

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

    # YuNet's five landmarks are used by SFace for alignment. We expose a
    # conservative quality label rather than inventing a pose angle.
    alignment_quality = "supported" if detection.landmarks.shape == (5, 2) else "unavailable"

    return FaceQuality(
        face_count=face_count,
        box_width=w,
        box_height=h,
        relative_size=relative_size,
        detection_confidence=detection.confidence,
        sharpness=sharpness,
        brightness=brightness,
        pose=None,
        alignment_quality=alignment_quality,
        issues=tuple(dict.fromkeys(issues)),
    )


def select_single_face(image: np.ndarray, detections: list[FaceDetection]) -> ExtractedFace | None:
    if len(detections) != 1:
        return None
    detection = detections[0]
    x, y, w, h = detection.box
    x0 = max(0, int(round(x)))
    y0 = max(0, int(round(y)))
    x1 = min(image.shape[1], int(round(x + w)))
    y1 = min(image.shape[0], int(round(y + h)))
    crop = image[y0:y1, x0:x1]
    return ExtractedFace(crop, detection, _quality(image, detection, len(detections)))
