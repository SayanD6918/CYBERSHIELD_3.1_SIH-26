from __future__ import annotations

"""PASS 3D active head-pose challenge state machine.

The pose estimator remains YuNet five landmarks + SQPNP + Rodrigues/Euler.
PASS 3C supplies the immutable temporal reference. After that reference is
established, every challenge decision is made in the same relative coordinate
system.
"""

from dataclasses import dataclass
from statistics import median
from typing import Any, Sequence

import cv2
import numpy as np

from face_detection import FaceDetection, FaceModelError, YuNetDetector
from temporal_reference import (
    MAX_REPROJECTION_ERROR,
    MIN_FACE_CONFIDENCE,
    MIN_FACE_HEIGHT,
    MIN_FACE_WIDTH,
    ReferencePoseSample,
    TemporalReferenceEstimator,
)

CHALLENGES = {"TURN_LEFT", "TURN_RIGHT", "LOOK_STRAIGHT"}
CHALLENGE_SEQUENCE = ("TURN_LEFT", "TURN_RIGHT", "LOOK_STRAIGHT")
# Compatibility names retained for the pose-geometry regression suite. They are
# not used as challenge-state thresholds after PASS 3C reference acquisition.
INITIAL_NEUTRAL_YAW = 12.0
STRAIGHT_YAW = 10.0

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

# Existing movement/target magnitudes are preserved. They are now explicitly
# interpreted as displacement from the PASS 3C reference, never as raw yaw.
MOVEMENT_YAW = 8.0
TARGET_YAW = 20.0
HOLD_FRAMES = 3
TRAJECTORY_WINDOW = 5
RETURN_YAW_TOLERANCE = 6.0
RETURN_PITCH_TOLERANCE = 8.0
RETURN_ROLL_TOLERANCE = 8.0
MAX_CONSECUTIVE_MISSING = 3
MAX_CHALLENGE_FRAMES = 96


@dataclass(frozen=True)
class PoseMeasurement:
    yaw: float
    pitch: float
    roll: float
    reprojection_error: float
    face_confidence: float
    face_width: float = 0.0
    face_height: float = 0.0


def _camera_matrix(width: int, height: int) -> np.ndarray:
    focal = 0.9 * max(width, height)
    return np.array(
        [[focal, 0.0, width / 2.0], [0.0, focal, height / 2.0], [0.0, 0.0, 1.0]],
        dtype=np.float64,
    )


def estimate_head_pose(detection: FaceDetection, frame_shape: Sequence[int]) -> PoseMeasurement:
    height, width = int(frame_shape[0]), int(frame_shape[1])
    image_points = np.asarray(detection.landmarks, dtype=np.float32)
    camera_matrix = _camera_matrix(width, height)
    distortion = np.zeros((4, 1), dtype=np.float64)

    ok, rvec, tvec = cv2.solvePnP(
        MODEL_POINTS, image_points, camera_matrix, distortion, flags=cv2.SOLVEPNP_SQPNP
    )
    if not ok:
        raise ValueError("HEAD_POSE_ESTIMATION_FAILED")

    rotation, _ = cv2.Rodrigues(rvec)
    yaw = float(np.degrees(np.arctan2(-rotation[0, 2], rotation[2, 2])))
    pitch = float(np.degrees(np.arctan2(-rotation[1, 2], np.sqrt(rotation[0, 2] ** 2 + rotation[2, 2] ** 2))))
    roll = float(np.degrees(np.arctan2(rotation[1, 0], rotation[1, 1])))

    projected, _ = cv2.projectPoints(MODEL_POINTS, rvec, tvec, camera_matrix, distortion)
    error = float(np.mean(np.linalg.norm(projected.reshape(-1, 2) - image_points, axis=1)))
    if not np.isfinite(error):
        raise ValueError("HEAD_POSE_REPROJECTION_INVALID")

    box = getattr(detection, "box", None)
    face_width = float(box[2]) if box is not None else 0.0
    face_height = float(box[3]) if box is not None else 0.0
    return PoseMeasurement(yaw, pitch, roll, error, float(detection.confidence), face_width, face_height)


def _median_pose(poses: Sequence[PoseMeasurement]) -> dict[str, float] | None:
    if not poses:
        return None
    return {
        "yaw": round(float(median(p.yaw for p in poses)), 2),
        "pitch": round(float(median(p.pitch for p in poses)), 2),
        "roll": round(float(median(p.roll for p in poses)), 2),
    }


def _pose_confidence(poses: Sequence[PoseMeasurement]) -> float:
    if not poses:
        return 0.0
    reprojection = float(np.mean([p.reprojection_error for p in poses]))
    face_conf = float(np.mean([p.face_confidence for p in poses]))
    reprojection_conf = max(0.0, min(1.0, 1.0 - reprojection / MAX_REPROJECTION_ERROR))
    return round(max(0.0, min(1.0, 0.65 * face_conf + 0.35 * reprojection_conf)), 4)


def _relative_dict(reference, pose: PoseMeasurement) -> dict[str, float]:
    return {
        "yaw": pose.yaw - reference.yaw,
        "pitch": pose.pitch - reference.pitch,
        "roll": pose.roll - reference.roll,
    }


def _return_to_reference(relative: dict[str, float]) -> bool:
    return (
        abs(relative["yaw"]) <= RETURN_YAW_TOLERANCE
        and abs(relative["pitch"]) <= RETURN_PITCH_TOLERANCE
        and abs(relative["roll"]) <= RETURN_ROLL_TOLERANCE
    )


def _target_reached(action: str, relative_yaw: float) -> bool:
    if action == "TURN_LEFT":
        return relative_yaw >= TARGET_YAW
    if action == "TURN_RIGHT":
        return relative_yaw <= -TARGET_YAW
    return False


def _movement_consistent(action: str, recent: Sequence[float]) -> bool:
    if len(recent) < 2:
        return False
    deltas = [b - a for a, b in zip(recent, recent[1:])]
    if action == "TURN_LEFT":
        return sum(d >= -2.0 for d in deltas) >= len(deltas) - 1 and recent[-1] >= MOVEMENT_YAW
    if action == "TURN_RIGHT":
        return sum(d <= 2.0 for d in deltas) >= len(deltas) - 1 and recent[-1] <= -MOVEMENT_YAW
    return False


def _target_evidence(action: str, recent: Sequence[float]) -> bool:
    if len(recent) < TRAJECTORY_WINDOW:
        return False
    if not _movement_consistent(action, recent):
        return False
    target_count = sum(_target_reached(action, yaw) for yaw in recent[-HOLD_FRAMES:])
    return target_count == HOLD_FRAMES


def _step_result(action: str, state: str, reference, poses: list[PoseMeasurement], evidence: dict[str, Any], reason: str | None = None) -> dict[str, Any]:
    return {
        "requested_action": action,
        "initial_pose": (
            {"yaw": round(reference.yaw, 2), "pitch": round(reference.pitch, 2), "roll": round(reference.roll, 2)}
            if reference is not None else None
        ),
        "observed_pose": _median_pose(poses[-5:]),
        "movement_detected": bool(evidence.get("movement_detected", False)),
        "challenge_status": "PASSED" if reason is None else "FAILED",
        "confidence": _pose_confidence(poses),
        "evidence": evidence,
        "failure_reason": reason,
        "state": state,
    }


def _failure(action: str, reason: str, evidence: dict[str, Any] | None = None) -> dict[str, Any]:
    return _step_result(action, "FAILED", None, [], evidence or {}, reason)


def _process_reference(frames: Sequence[np.ndarray], detector: YuNetDetector) -> tuple[Any, dict[str, Any] | None]:
    estimator = TemporalReferenceEstimator()
    states: list[dict[str, Any]] = []
    valid: list[PoseMeasurement] = []
    missing_run = 0
    longest_missing = 0

    for index, frame in enumerate(frames):
        try:
            detections = detector.detect(frame)
        except FaceModelError as exc:
            return None, _failure("REFERENCE", f"FACE_DETECTOR_ERROR:{exc}", {"frame_index": index})
        if len(detections) == 0:
            missing_run += 1
            longest_missing = max(longest_missing, missing_run)
            states.append({"frame": index, "status": "NO_FACE"})
            estimator.observe(ReferencePoseSample(0, 0, 0, 0, 0, 0, 0, face_count=0, pose_valid=False))
            if missing_run > MAX_CONSECUTIVE_MISSING:
                return None, _failure("REFERENCE", "PERSISTENT_FACE_LOSS", {"frame_index": index})
            continue
        missing_run = 0
        if len(detections) > 1:
            states.append({"frame": index, "status": "MULTIPLE_FACES", "face_count": len(detections)})
            return None, _failure("REFERENCE", "MULTIPLE_FACES_DETECTED", {"frame_index": index, "face_count": len(detections)})
        try:
            pose = estimate_head_pose(detections[0], frame.shape)
        except ValueError as exc:
            states.append({"frame": index, "status": "POSE_ERROR", "reason": str(exc)})
            estimator.observe(ReferencePoseSample(0, 0, 0, 0, 0, 0, 0, face_count=1, pose_valid=False))
            continue
        valid.append(pose)
        sample = ReferencePoseSample(
            pose.yaw, pose.pitch, pose.roll, pose.reprojection_error, pose.face_confidence,
            pose.face_width, pose.face_height, 1, True,
        )
        status = estimator.observe(sample)
        states.append({"frame": index, "status": status, "yaw": round(pose.yaw, 2), "pitch": round(pose.pitch, 2), "roll": round(pose.roll, 2)})

    if not estimator.established:
        return None, _failure(
            "REFERENCE", "REFERENCE_NOT_ESTABLISHED",
            {"valid_candidate_observations": estimator.valid_candidate_count, "states": states, "longest_missing_face_run": longest_missing},
        )
    return estimator, None


def verify_active_challenge_sequence(
    reference_frames: Sequence[np.ndarray],
    challenge_steps: Sequence[tuple[str, Sequence[np.ndarray]]],
    detector: YuNetDetector,
) -> dict[str, Any]:
    """Verify the complete PASS 3D session as one continuous state machine."""
    if not reference_frames:
        return {"challenge_status": "FAILED", "failure_reason": "NO_REFERENCE_FRAMES_PROVIDED", "steps": []}
    if not challenge_steps:
        return {"challenge_status": "FAILED", "failure_reason": "NO_CHALLENGE_STEPS_PROVIDED", "steps": []}
    if len(challenge_steps) != len(CHALLENGE_SEQUENCE) or tuple(a.upper() for a, _ in challenge_steps) != CHALLENGE_SEQUENCE:
        return {"challenge_status": "FAILED", "failure_reason": "INVALID_CHALLENGE_SEQUENCE", "steps": []}

    total_frames = sum(len(frames) for _, frames in challenge_steps)
    if total_frames > MAX_CHALLENGE_FRAMES:
        return {"challenge_status": "FAILED", "failure_reason": "CHALLENGE_TIMEOUT", "steps": []}

    estimator, ref_failure = _process_reference(reference_frames, detector)
    if ref_failure is not None:
        return {"challenge_status": "FAILED", "failure_reason": ref_failure["failure_reason"], "steps": [ref_failure]}
    reference = estimator.reference
    assert reference is not None

    states = ["READY_AT_REFERENCE", "MOVE_TO_LEFT_TARGET", "HOLD_LEFT_TARGET", "RETURN_TO_REFERENCE", "MOVE_TO_RIGHT_TARGET", "HOLD_RIGHT_TARGET", "RETURN_TO_REFERENCE", "FINAL_RETURN_TO_REFERENCE"]
    state = states[0]
    expected = ["TURN_LEFT", "TURN_RIGHT", "LOOK_STRAIGHT"]
    step_results: list[dict[str, Any]] = []
    all_poses: list[PoseMeasurement] = []
    recent_yaws: list[float] = []
    hold_count = 0
    ready_hold = 0
    movement_detected = False
    missing_run = 0
    longest_missing = 0
    contradiction_count = 0
    frame_states: list[dict[str, Any]] = []
    step_pose_lists: dict[str, list[PoseMeasurement]] = {a: [] for a in expected}

    for step_index, (action, frames) in enumerate(challenge_steps):
        action = action.upper()
        step_start_state = state
        for frame_index, frame in enumerate(frames):
            try:
                detections = detector.detect(frame)
            except FaceModelError as exc:
                return {"challenge_status": "FAILED", "failure_reason": f"FACE_DETECTOR_ERROR:{exc}", "steps": step_results}
            if len(detections) == 0:
                missing_run += 1
                longest_missing = max(longest_missing, missing_run)
                frame_states.append({"step": action, "frame": frame_index, "status": "NO_FACE", "state": state})
                recent_yaws.clear()
                hold_count = 0
                if missing_run > MAX_CONSECUTIVE_MISSING:
                    return {"challenge_status": "FAILED", "failure_reason": "PERSISTENT_FACE_LOSS", "steps": step_results, "evidence": {"state": state}}
                continue
            missing_run = 0
            if len(detections) > 1:
                return {"challenge_status": "FAILED", "failure_reason": "MULTIPLE_FACES_DETECTED", "steps": step_results, "evidence": {"state": state}}
            try:
                pose = estimate_head_pose(detections[0], frame.shape)
            except ValueError:
                recent_yaws.clear()
                hold_count = 0
                frame_states.append({"step": action, "frame": frame_index, "status": "POSE_ERROR", "state": state})
                continue
            if (
                pose.reprojection_error > MAX_REPROJECTION_ERROR
                or pose.face_confidence < MIN_FACE_CONFIDENCE
                or pose.face_width < MIN_FACE_WIDTH
                or pose.face_height < MIN_FACE_HEIGHT
            ):
                recent_yaws.clear()
                hold_count = 0
                frame_states.append({"step": action, "frame": frame_index, "status": "LOW_POSE_QUALITY", "state": state, "reprojection_error": round(pose.reprojection_error, 2)})
                continue

            all_poses.append(pose)
            step_pose_lists[action].append(pose)
            relative = _relative_dict(reference, pose)
            recent_yaws.append(relative["yaw"])
            if len(recent_yaws) > TRAJECTORY_WINDOW:
                recent_yaws.pop(0)
            frame_states.append({"step": action, "frame": frame_index, "status": "POSE", "state": state, "relative_yaw": round(relative["yaw"], 2), "relative_pitch": round(relative["pitch"], 2), "relative_roll": round(relative["roll"], 2)})

            if state == "READY_AT_REFERENCE":
                if _return_to_reference(relative):
                    ready_hold += 1
                    if ready_hold >= HOLD_FRAMES:
                        state = "MOVE_TO_LEFT_TARGET"
                        recent_yaws.clear()
                        ready_hold = 0
                else:
                    ready_hold = 0
                    # A subject already moving before the first target is not
                    # allowed to redefine the reference or skip READY.
                    continue

            elif state == "MOVE_TO_LEFT_TARGET":
                if relative["yaw"] <= -MOVEMENT_YAW:
                    contradiction_count += 1
                    if contradiction_count >= 2:
                        return {"challenge_status": "FAILED", "failure_reason": "CONTRADICTORY_MOVEMENT", "steps": step_results, "evidence": {"state": state}}
                if relative["yaw"] >= MOVEMENT_YAW:
                    movement_detected = True
                if _target_evidence("TURN_LEFT", recent_yaws):
                    state = "HOLD_LEFT_TARGET"
                    hold_count = HOLD_FRAMES
                    recent_yaws.clear()
                
            elif state == "HOLD_LEFT_TARGET":
                if _target_reached("TURN_LEFT", relative["yaw"]):
                    hold_count += 1
                    if hold_count >= HOLD_FRAMES:
                        state = "RETURN_TO_REFERENCE"
                        contradiction_count = 0
                        hold_count = 0
                        recent_yaws.clear()
                else:
                    hold_count = 0
                    state = "MOVE_TO_LEFT_TARGET"
                    recent_yaws.clear()

            elif state == "MOVE_TO_RIGHT_TARGET":
                if relative["yaw"] >= MOVEMENT_YAW:
                    contradiction_count += 1
                    if contradiction_count >= 2:
                        return {"challenge_status": "FAILED", "failure_reason": "CONTRADICTORY_MOVEMENT", "steps": step_results, "evidence": {"state": state}}
                if relative["yaw"] <= -MOVEMENT_YAW:
                    movement_detected = True
                if _target_evidence("TURN_RIGHT", recent_yaws):
                    state = "HOLD_RIGHT_TARGET"
                    contradiction_count = 0
                    hold_count = HOLD_FRAMES
                    recent_yaws.clear()

            elif state == "HOLD_RIGHT_TARGET":
                if _target_reached("TURN_RIGHT", relative["yaw"]):
                    hold_count += 1
                    if hold_count >= HOLD_FRAMES:
                        state = "FINAL_RETURN_TO_REFERENCE"
                        contradiction_count = 0
                        hold_count = 0
                        recent_yaws.clear()
                else:
                    hold_count = 0
                    state = "MOVE_TO_RIGHT_TARGET"
                    recent_yaws.clear()

            elif state in {"RETURN_TO_REFERENCE", "FINAL_RETURN_TO_REFERENCE"}:
                if _return_to_reference(relative):
                    hold_count += 1
                    if hold_count >= HOLD_FRAMES:
                        if state == "RETURN_TO_REFERENCE":
                            state = "MOVE_TO_RIGHT_TARGET"
                        else:
                            state = "PASSED"
                        hold_count = 0
                        recent_yaws.clear()
                else:
                    # For a return, moving farther away from the previous target
                    # is contradictory; otherwise keep waiting for a genuine return.
                    if state == "RETURN_TO_REFERENCE":
                        previous_sign = 1 if step_index == 0 else -1
                        if relative["yaw"] * previous_sign > TARGET_YAW:
                            contradiction_count += 1
                    if state == "FINAL_RETURN_TO_REFERENCE" and abs(relative["yaw"]) > TARGET_YAW + 5:
                        contradiction_count += 1
                    if contradiction_count >= 2:
                        return {"challenge_status": "FAILED", "failure_reason": "CONTRADICTORY_MOVEMENT", "steps": step_results, "evidence": {"state": state}}

        # Do not pass a step merely because its burst ended. The state must be
        # satisfied by the continuous trajectory and may legitimately continue
        # into the next capture burst (e.g. left target -> return -> right).
        if step_index == 0 and state not in {"RETURN_TO_REFERENCE", "MOVE_TO_RIGHT_TARGET", "HOLD_RIGHT_TARGET", "FINAL_RETURN_TO_REFERENCE", "PASSED"}:
            return {"challenge_status": "FAILED", "failure_reason": "TARGET_POSE_NOT_HELD", "steps": step_results, "evidence": {"state": state, "step": action}}
        if step_index == 1 and state != "FINAL_RETURN_TO_REFERENCE":
            return {"challenge_status": "FAILED", "failure_reason": "SECOND_TARGET_NOT_COMPLETED", "steps": step_results, "evidence": {"state": state, "step": action}}
        step_results.append(_step_result(
            action,
            state,
            reference,
            step_pose_lists[action],
            {
                "state_at_step_start": step_start_state,
                "state_at_step_end": state,
                "target_relative_yaw": TARGET_YAW if action == "TURN_LEFT" else -TARGET_YAW if action == "TURN_RIGHT" else 0.0,
                "return_yaw_tolerance": RETURN_YAW_TOLERANCE,
                "hold_frames": HOLD_FRAMES,
                "trajectory_window": TRAJECTORY_WINDOW,
                "movement_detected": movement_detected,
                "valid_pose_frames": len(step_pose_lists[action]),
                "frame_states": [x for x in frame_states if x.get("step") == action],
            },
            None,
        ))

    if state != "PASSED":
        return {
            "challenge_status": "FAILED",
            "failure_reason": "FINAL_RETURN_NOT_CONFIRMED" if state == "FINAL_RETURN_TO_REFERENCE" else "CHALLENGE_TIMEOUT",
            "steps": step_results,
            "evidence": {"state": state, "frame_states": frame_states, "missing_face_frames": missing_run, "longest_missing_face_run": longest_missing, "reference": {"yaw": round(reference.yaw, 2), "pitch": round(reference.pitch, 2), "roll": round(reference.roll, 2)}, "relative_coordinate_system": "current_pose - immutable_PASS_3C_reference"},
        }

    # Mark the final step as the completed return-to-reference stage.
    if len(step_results) == len(CHALLENGE_SEQUENCE):
        step_results[-1]["challenge_status"] = "PASSED"
        step_results[-1]["failure_reason"] = None
    return {
        "challenge_status": "PASSED",
        "failure_reason": None,
        "steps": step_results,
        "initial_pose": {"yaw": round(reference.yaw, 2), "pitch": round(reference.pitch, 2), "roll": round(reference.roll, 2)},
        "observed_pose": _median_pose(all_poses[-5:]),
        "movement_detected": movement_detected,
        "confidence": _pose_confidence(all_poses),
        "evidence": {
            "reference": {"yaw": round(reference.yaw, 2), "pitch": round(reference.pitch, 2), "roll": round(reference.roll, 2), "samples_used": reference.samples_used, "yaw_mad": round(reference.yaw_mad, 3), "pitch_mad": round(reference.pitch_mad, 3), "roll_mad": round(reference.roll_mad, 3)},
            "relative_coordinate_system": "current_pose - immutable_PASS_3C_reference",
            "target_relative_yaw": {"TURN_LEFT": TARGET_YAW, "TURN_RIGHT": -TARGET_YAW},
            "return_tolerances": {"yaw": RETURN_YAW_TOLERANCE, "pitch": RETURN_PITCH_TOLERANCE, "roll": RETURN_ROLL_TOLERANCE},
            "hold_frames": HOLD_FRAMES,
            "trajectory_window": TRAJECTORY_WINDOW,
            "frames_received": total_frames,
            "valid_pose_frames": len(all_poses),
            "frame_states": frame_states,
            "missing_face_frames": missing_run,
            "longest_missing_face_run": longest_missing,
            "pose_method": "YuNet-5-landmark + solvePnP(SQPNP)",
            "yaw_convention": "positive=subject-left for unmirrored camera frames",
            "yaw_scale": "uncalibrated model-relative degrees, not true head angle",
        },
    }


def verify_active_challenge(challenge: str, frames: Sequence[np.ndarray], detector: YuNetDetector) -> dict[str, Any]:
    """Compatibility wrapper for one target; PASS 3D production uses the session API."""
    action = challenge.upper().strip()
    if action not in CHALLENGES:
        return _failure(action, "UNKNOWN_CHALLENGE")
    if not frames:
        return _failure(action, "NO_FRAMES_PROVIDED", {"frames_received": 0})
    return _failure(action, "PASS3D_REQUIRES_CHALLENGE_SESSION", {"required_sequence": CHALLENGE_SEQUENCE})
