from __future__ import annotations

"""Active head-pose challenge verification.

This module deliberately keeps active challenge verification separate from passive
PAD/liveness.  A PASS here means the requested, time-ordered head movement was
observed; it is never inferred from ``liveness_status == LIVE``.
"""

from dataclasses import dataclass
from statistics import median
from typing import Any, Iterable, Sequence

import cv2
import numpy as np

from face_detection import FaceDetection, FaceModelError, YuNetDetector


CHALLENGES = {"TURN_LEFT", "TURN_RIGHT", "LOOK_STRAIGHT"}

# Generic 3-D face model in millimetres, expressed in the SAME frame OpenCV
# uses for image points: +x to the right of the image, +y downwards, +z away
# from the camera. Rows follow YuNet's landmark order, which is
#   0 right eye, 1 left eye, 2 nose tip, 3 right mouth corner, 4 left mouth
# corner, all in the subject's own terms - so row 0 is the eye that appears on
# the LEFT of an unmirrored image.
#
# The widely copied version of this model uses y-up / z-toward-viewer. That is
# a 180 degree rotation about x away from the camera frame, and solvePnP duly
# returns a pose 180 degrees out: a perfectly frontal face measured yaw = 180,
# roll = 180. Every TURN challenge then failed its neutral-pose gate and
# LOOK_STRAIGHT could never reach its target, so the active challenge could not
# be passed at all. test_head_pose_geometry.py pins the corrected convention.
MODEL_POINTS = np.array(
    [
        [-225.0, -170.0, 135.0],
        [225.0, -170.0, 135.0],
        [0.0, 0.0, 0.0],
        [-150.0, 150.0, 125.0],
        [150.0, 150.0, 125.0],
    ],
    dtype=np.float32,
)

INITIAL_NEUTRAL_YAW = 12.0
TARGET_YAW = 20.0
MOVEMENT_YAW = 8.0
STRAIGHT_YAW = 10.0
STRAIGHT_START_YAW = 18.0
HOLD_FRAMES = 3
MIN_VALID_POSES = 8
MAX_POSE_REPROJECTION_ERROR = 18.0
# A webcam drops the occasional frame to a blink, motion blur or an exposure
# hunt. Demanding a face in literally every frame turned those into hard
# failures, so require a high proportion plus short gaps instead.
MIN_FACE_CONTINUITY = 0.85
MAX_CONSECUTIVE_MISSING = 3


@dataclass(frozen=True)
class PoseMeasurement:
    yaw: float
    pitch: float
    roll: float
    reprojection_error: float
    face_confidence: float


def _camera_matrix(width: int, height: int) -> np.ndarray:
    # Browser cameras normally expose no physical calibration to the server.
    # A focal length close to the image width gives a stable generic pinhole model.
    focal = 0.9 * max(width, height)
    return np.array(
        [
            [focal, 0.0, width / 2.0],
            [0.0, focal, height / 2.0],
            [0.0, 0.0, 1.0],
        ],
        dtype=np.float64,
    )


def estimate_head_pose(
    detection: FaceDetection,
    frame_shape: Sequence[int],
) -> PoseMeasurement:
    height, width = int(frame_shape[0]), int(frame_shape[1])
    image_points = np.asarray(detection.landmarks, dtype=np.float32)
    camera_matrix = _camera_matrix(width, height)
    distortion = np.zeros((4, 1), dtype=np.float64)

    ok, rvec, tvec = cv2.solvePnP(
        MODEL_POINTS,
        image_points,
        camera_matrix,
        distortion,
        flags=cv2.SOLVEPNP_SQPNP,
    )
    if not ok:
        raise ValueError("HEAD_POSE_ESTIMATION_FAILED")

    rotation, _ = cv2.Rodrigues(rvec)
    # Negated so that positive yaw means the subject turned to their OWN left,
    # which puts their nose toward the right of an unmirrored image. That is
    # the direction "turn your head to the left" asks for on screen.
    yaw = float(np.degrees(np.arctan2(-rotation[0, 2], rotation[2, 2])))
    pitch = float(
        np.degrees(
            np.arctan2(
                -rotation[1, 2],
                np.sqrt(rotation[0, 2] ** 2 + rotation[2, 2] ** 2),
            )
        )
    )
    roll = float(np.degrees(np.arctan2(rotation[1, 0], rotation[1, 1])))

    projected, _ = cv2.projectPoints(
        MODEL_POINTS, rvec, tvec, camera_matrix, distortion
    )
    error = float(
        np.mean(
            np.linalg.norm(
                projected.reshape(-1, 2) - image_points,
                axis=1,
            )
        )
    )

    if not np.isfinite(error):
        raise ValueError("HEAD_POSE_REPROJECTION_INVALID")

    return PoseMeasurement(
        yaw=yaw,
        pitch=pitch,
        roll=roll,
        reprojection_error=error,
        face_confidence=float(detection.confidence),
    )


def _median_pose(poses: Sequence[PoseMeasurement]) -> dict[str, float]:
    return {
        "yaw": round(float(median(p.yaw for p in poses)), 2),
        "pitch": round(float(median(p.pitch for p in poses)), 2),
        "roll": round(float(median(p.roll for p in poses)), 2),
    }


def _direction_target(challenge: str) -> float:
    return TARGET_YAW if challenge == "TURN_LEFT" else -TARGET_YAW


def _movement_detected(challenge: str, initial_yaw: float, yaw: float) -> bool:
    delta = yaw - initial_yaw
    if challenge == "TURN_LEFT":
        return delta >= MOVEMENT_YAW
    if challenge == "TURN_RIGHT":
        return delta <= -MOVEMENT_YAW
    # LOOK_STRAIGHT requires movement toward zero.
    return abs(initial_yaw) - abs(yaw) >= MOVEMENT_YAW


def _target_reached(challenge: str, yaw: float) -> bool:
    if challenge == "TURN_LEFT":
        return yaw >= TARGET_YAW
    if challenge == "TURN_RIGHT":
        return yaw <= -TARGET_YAW
    return abs(yaw) <= STRAIGHT_YAW


def _pose_confidence(poses: Sequence[PoseMeasurement]) -> float:
    if not poses:
        return 0.0
    reprojection = float(np.mean([p.reprojection_error for p in poses]))
    face_conf = float(np.mean([p.face_confidence for p in poses]))
    reprojection_conf = max(
        0.0, min(1.0, 1.0 - reprojection / MAX_POSE_REPROJECTION_ERROR)
    )
    return round(max(0.0, min(1.0, 0.65 * face_conf + 0.35 * reprojection_conf)), 4)


def verify_active_challenge(
    challenge: str,
    frames: Sequence[np.ndarray],
    detector: YuNetDetector,
) -> dict[str, Any]:
    challenge = challenge.upper().strip()
    if challenge not in CHALLENGES:
        return {
            "requested_action": challenge,
            "initial_pose": None,
            "observed_pose": None,
            "movement_detected": False,
            "challenge_status": "FAILED",
            "confidence": 0.0,
            "evidence": {},
            "failure_reason": "UNKNOWN_CHALLENGE",
        }

    if not frames:
        return {
            "requested_action": challenge,
            "initial_pose": None,
            "observed_pose": None,
            "movement_detected": False,
            "challenge_status": "FAILED",
            "confidence": 0.0,
            "evidence": {"frames_received": 0},
            "failure_reason": "NO_FRAMES_PROVIDED",
        }

    poses: list[PoseMeasurement] = []
    frame_states: list[dict[str, Any]] = []
    multiple_faces = False
    missing_frames = 0
    longest_missing_run = 0
    current_missing_run = 0

    for index, frame in enumerate(frames[:48]):
        try:
            detections = detector.detect(frame)
        except FaceModelError as exc:
            return {
                "requested_action": challenge,
                "initial_pose": None,
                "observed_pose": None,
                "movement_detected": False,
                "challenge_status": "FAILED",
                "confidence": 0.0,
                "evidence": {"frame_index": index},
                "failure_reason": f"FACE_DETECTOR_ERROR:{exc}",
            }

        if len(detections) == 0:
            missing_frames += 1
            current_missing_run += 1
            longest_missing_run = max(longest_missing_run, current_missing_run)
            frame_states.append({"frame": index, "status": "NO_FACE"})
            continue

        current_missing_run = 0

        if len(detections) > 1:
            multiple_faces = True
            frame_states.append(
                {"frame": index, "status": "MULTIPLE_FACES", "face_count": len(detections)}
            )
            continue

        try:
            pose = estimate_head_pose(detections[0], frame.shape)
        except ValueError as exc:
            frame_states.append(
                {"frame": index, "status": "POSE_ERROR", "reason": str(exc)}
            )
            continue

        if pose.reprojection_error > MAX_POSE_REPROJECTION_ERROR:
            frame_states.append(
                {
                    "frame": index,
                    "status": "LOW_POSE_QUALITY",
                    "reprojection_error": round(pose.reprojection_error, 2),
                }
            )
            continue

        poses.append(pose)
        frame_states.append(
            {
                "frame": index,
                "status": "POSE",
                "yaw": round(pose.yaw, 2),
                "pitch": round(pose.pitch, 2),
                "roll": round(pose.roll, 2),
            }
        )

    base = {
        "requested_action": challenge,
        "initial_pose": None,
        "observed_pose": _median_pose(poses[-5:]) if poses else None,
        "movement_detected": False,
        "challenge_status": "FAILED",
        "confidence": _pose_confidence(poses),
        "evidence": {
            "frames_received": len(frames),
            "valid_pose_frames": len(poses),
            "frame_states": frame_states,
            "yaw_range": (
                round(min(p.yaw for p in poses), 2),
                round(max(p.yaw for p in poses), 2),
            )
            if poses
            else None,
            "pitch_range": (
                round(min(p.pitch for p in poses), 2),
                round(max(p.pitch for p in poses), 2),
            )
            if poses
            else None,
            "roll_range": (
                round(min(p.roll for p in poses), 2),
                round(max(p.roll for p in poses), 2),
            )
            if poses
            else None,
            "missing_face_frames": missing_frames,
            "longest_missing_face_run": longest_missing_run,
            "pose_method": "YuNet-5-landmark + solvePnP(SQPNP)",
            "yaw_convention": "positive=subject-left for unmirrored camera frames",
            "yaw_scale": "uncalibrated model-relative degrees, not true head angle",
        },
        "failure_reason": None,
    }

    if multiple_faces:
        base["failure_reason"] = "MULTIPLE_FACES_DETECTED"
        return base

    analysed = min(len(frames), 48)
    continuity = 1.0 - (missing_frames / analysed) if analysed else 0.0
    base["evidence"]["face_continuity"] = round(continuity, 4)
    if continuity < MIN_FACE_CONTINUITY or longest_missing_run > MAX_CONSECUTIVE_MISSING:
        base["failure_reason"] = "FACE_LOST_DURING_CHALLENGE"
        return base

    if len(poses) < MIN_VALID_POSES:
        base["failure_reason"] = "INSUFFICIENT_VALID_POSE_FRAMES"
        return base

    # The first five stable frames establish the starting pose.
    initial_samples = poses[:5]
    initial = _median_pose(initial_samples)
    base["initial_pose"] = initial

    initial_yaw = initial["yaw"]
    if challenge in {"TURN_LEFT", "TURN_RIGHT"}:
        if abs(initial_yaw) > INITIAL_NEUTRAL_YAW:
            base["failure_reason"] = "INITIAL_POSE_NOT_NEUTRAL"
            return base
    elif abs(initial_yaw) < STRAIGHT_START_YAW:
        base["failure_reason"] = "INITIAL_POSE_ALREADY_STRAIGHT"
        return base

    movement = False
    hold = 0
    target = _direction_target(challenge) if challenge != "LOOK_STRAIGHT" else 0.0

    for pose in poses[5:]:
        if _movement_detected(challenge, initial_yaw, pose.yaw):
            movement = True

        if _target_reached(challenge, pose.yaw):
            hold += 1
        else:
            hold = 0

        if movement and hold >= HOLD_FRAMES:
            base["challenge_status"] = "PASSED"
            base["movement_detected"] = True
            base["observed_pose"] = {
                "yaw": round(pose.yaw, 2),
                "pitch": round(pose.pitch, 2),
                "roll": round(pose.roll, 2),
            }
            base["confidence"] = round(
                min(1.0, base["confidence"] * min(1.0, abs(pose.yaw - initial_yaw) / 30.0 + 0.25)),
                4,
            )
            base["evidence"]["target_yaw"] = target
            base["evidence"]["hold_frames"] = hold
            base["failure_reason"] = None
            return base

    base["movement_detected"] = movement
    base["evidence"]["target_yaw"] = target
    base["evidence"]["hold_frames"] = hold

    if not movement:
        base["failure_reason"] = "REQUESTED_MOVEMENT_NOT_DETECTED"
    else:
        base["failure_reason"] = "TARGET_POSE_NOT_HELD"
    return base
