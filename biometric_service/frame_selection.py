"""Choosing which camera frame to recognise the person from.

The browser sends one burst that serves three purposes: the active challenge,
passive PAD, and face matching. Taking the last frame of that burst as the
recognition probe was a quiet accuracy problem - for a TURN_LEFT or
TURN_RIGHT challenge, the last frame is precisely the moment the subject is
holding their head turned away, which is the worst possible input to a face
recogniser.

This module scores every frame for how suitable it is as a recognition probe
and returns the best one, plus the evidence behind that choice.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Sequence

import cv2
import numpy as np

from active_challenge import estimate_head_pose
from face_detection import FaceDetection, FaceModelError, YuNetDetector

# Weights are deliberately blunt. Frontality dominates because off-axis pose
# costs an embedding comparison far more than a little softness does.
FRONTALITY_WEIGHT = 0.55
SHARPNESS_WEIGHT = 0.25
SIZE_WEIGHT = 0.20

# Yaw/pitch magnitude, in the uncalibrated model-relative degrees
# estimate_head_pose() returns, at which frontality scores zero.
MAX_USEFUL_OFF_AXIS = 45.0
SHARPNESS_REFERENCE = 150.0
SIZE_REFERENCE = 0.08


@dataclass(frozen=True)
class ProbeFrame:
    index: int
    image: np.ndarray
    detection: FaceDetection
    score: float
    yaw: float | None
    pitch: float | None
    sharpness: float
    relative_size: float


@dataclass(frozen=True)
class ProbeSelection:
    probe: ProbeFrame | None
    considered: int
    rejected: dict[str, int]
    issues: tuple[str, ...]

    def as_evidence(self) -> dict[str, Any]:
        evidence: dict[str, Any] = {
            "frames_considered": self.considered,
            "rejected": dict(self.rejected),
            "selection_method": "frontality + sharpness + face size over the capture burst",
            "issues": list(self.issues),
        }
        if self.probe is not None:
            evidence.update(
                {
                    "selected_frame_index": self.probe.index,
                    "selected_frame_score": round(self.probe.score, 6),
                    "selected_frame_yaw": None if self.probe.yaw is None else round(self.probe.yaw, 2),
                    "selected_frame_pitch": None if self.probe.pitch is None else round(self.probe.pitch, 2),
                    "selected_frame_sharpness": round(self.probe.sharpness, 3),
                    "selected_frame_relative_size": round(self.probe.relative_size, 6),
                }
            )
        return evidence


def _sharpness(image: np.ndarray, detection: FaceDetection) -> float:
    x, y, w, h = detection.box
    height, width = image.shape[:2]
    x0, y0 = max(0, int(round(x))), max(0, int(round(y)))
    x1, y1 = min(width, int(round(x + w))), min(height, int(round(y + h)))
    crop = image[y0:y1, x0:x1]
    if not crop.size:
        return 0.0
    return float(cv2.Laplacian(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var())


def score_frame(image: np.ndarray, detection: FaceDetection) -> ProbeFrame:
    height, width = image.shape[:2]
    relative_size = detection.area / float(max(1, width * height))
    sharpness = _sharpness(image, detection)

    try:
        pose = estimate_head_pose(detection, image.shape)
        yaw: float | None = pose.yaw
        pitch: float | None = pose.pitch
        off_axis = float(np.hypot(pose.yaw, pose.pitch))
        frontality = max(0.0, 1.0 - off_axis / MAX_USEFUL_OFF_AXIS)
    except (ValueError, cv2.error):
        # No pose is not a reason to discard the frame, but it is a reason
        # not to claim it is frontal.
        yaw = pitch = None
        frontality = 0.5

    score = (
        FRONTALITY_WEIGHT * frontality
        + SHARPNESS_WEIGHT * min(1.0, sharpness / SHARPNESS_REFERENCE)
        + SIZE_WEIGHT * min(1.0, relative_size / SIZE_REFERENCE)
    )
    return ProbeFrame(-1, image, detection, score, yaw, pitch, sharpness, relative_size)


def select_probe_frame(
    frames: Sequence[np.ndarray],
    detector: YuNetDetector,
) -> ProbeSelection:
    """Pick the most recognisable frame in a burst.

    Frames without exactly one face are skipped rather than scored: an
    ambiguous frame is not a probe, and the counts of why frames were
    dropped are returned as evidence.
    """
    rejected = {"no_face": 0, "multiple_faces": 0, "detector_error": 0}
    best: ProbeFrame | None = None

    for index, frame in enumerate(frames):
        try:
            detections = detector.detect(frame)
        except FaceModelError:
            rejected["detector_error"] += 1
            continue

        if len(detections) == 0:
            rejected["no_face"] += 1
            continue
        if len(detections) > 1:
            rejected["multiple_faces"] += 1
            continue

        candidate = score_frame(frame, detections[0])
        candidate = ProbeFrame(
            index,
            candidate.image,
            candidate.detection,
            candidate.score,
            candidate.yaw,
            candidate.pitch,
            candidate.sharpness,
            candidate.relative_size,
        )
        if best is None or candidate.score > best.score:
            best = candidate

    issues: list[str] = []
    if best is None:
        issues.append("NO_USABLE_PROBE_FRAME")
    if rejected["multiple_faces"]:
        issues.append("MULTIPLE_FACES_IN_SOME_FRAMES")

    return ProbeSelection(best, len(frames), rejected, tuple(issues))
