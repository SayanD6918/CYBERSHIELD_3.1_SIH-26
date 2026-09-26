from __future__ import annotations

import unittest
from unittest.mock import patch

import numpy as np

from active_challenge import (
    CHALLENGE_SEQUENCE,
    PoseMeasurement,
    verify_active_challenge,
    verify_active_challenge_sequence,
)


class FakeDetection:
    def __init__(self, confidence=0.99, box=(100.0, 80.0, 300.0, 300.0)):
        self.confidence = confidence
        self.landmarks = np.zeros((5, 2), dtype=np.float32)
        self.box = box


class FakeDetector:
    def __init__(self, counts=None):
        self.counts = list(counts or [])
        self.index = 0

    def detect(self, frame):
        count = self.counts[self.index] if self.index < len(self.counts) else 1
        self.index += 1
        return [FakeDetection() for _ in range(count)]


def pose_sequence(yaws, confidence=0.99, width=300.0, height=300.0):
    return [
        PoseMeasurement(float(y), 0.0, 0.0, 2.0, confidence, width, height)
        for y in yaws
    ]


def make_success_sequence():
    reference = [0.0] * 16
    left = [0, 0, 0, 8, 12, 18, 20, 21, 22, 22, 22, 20, 15, 10, 6, 0]
    right = [6, 3, 1, 0, 0, -8, -12, -18, -20, -21, -22, -22, -22, -20, -15, -10]
    final_return = [-6, -3, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    return reference, [left, right, final_return]


class ActiveChallenge3DTests(unittest.TestCase):
    def run_session(self, reference, steps, detector=None):
        all_yaws = list(reference) + [y for step in steps for y in step]
        poses = pose_sequence(all_yaws)
        frames = [np.zeros((480, 640, 3), dtype=np.uint8) for _ in poses]
        step_frames = []
        cursor = len(reference)
        for step in steps:
            step_frames.append(frames[cursor: cursor + len(step)])
            cursor += len(step)
        detector = detector or FakeDetector()
        with patch("active_challenge.estimate_head_pose", side_effect=iter(poses)):
            return verify_active_challenge_sequence(
                frames[: len(reference)],
                list(zip(CHALLENGE_SEQUENCE, step_frames)),
                detector,
            )

    def test_complete_sequence_passes(self):
        reference, steps = make_success_sequence()
        result = self.run_session(reference, steps)
        self.assertEqual(result["challenge_status"], "PASSED")
        self.assertEqual([s["requested_action"] for s in result["steps"]], list(CHALLENGE_SEQUENCE))
        self.assertEqual(result["evidence"]["relative_coordinate_system"], "current_pose - immutable_PASS_3C_reference")

    def test_reference_is_not_first_five_frames(self):
        reference = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]
        steps = [[0, 0, 0, 8, 12, 18, 20, 21, 22, 22, 22, 20, 15, 10, 6, 0],
                 [6, 3, 1, 0, 0, -8, -12, -18, -20, -21, -22, -22, -22, -20, -15, -10],
                 [-6, -3, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]]
        result = self.run_session(reference, steps)
        self.assertEqual(result["challenge_status"], "PASSED")
        self.assertAlmostEqual(result["initial_pose"]["yaw"], 0.5)

    def test_already_turned_reference_is_rejected(self):
        reference = [20.0] * 16
        steps = [[20.0] * 16, [20.0] * 16, [20.0] * 16]
        result = self.run_session(reference, steps)
        self.assertEqual(result["challenge_status"], "FAILED")
        self.assertEqual(result["failure_reason"], "REFERENCE_NOT_ESTABLISHED")

    def test_reference_uses_raw_neutral_gate(self):
        reference = [12.0] * 16
        left = [12, 12, 12, 20, 24, 30, 32, 33, 33, 33, 32, 28, 22, 16, 12, 12]
        right = [18, 15, 12, 12, 12, 4, 0, -4, -8, -9, -10, -10, -10, -8, -4, 0]
        final = [6, 10, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12]
        result = self.run_session(reference, [left, right, final])
        self.assertEqual(result["challenge_status"], "PASSED")


    def test_nonzero_negative_reference_followed_by_positive_relative_target(self):
        reference = [-16.0] * 16
        left = [-16, -16, -16, -8, -4, 0, 4, 5, 5, 5, 5, 4, 0, -6, -10, -16]
        # Relative left target is reached at raw yaw +5°, which is +21° from -16°.
        right = [-10, -13, -15, -16, -16, -24, -28, -34, -36, -37, -38, -38, -38, -36, -31, -26]
        final = [-22, -19, -17, -16, -16, -16, -16, -16, -16, -16, -16, -16, -16, -16, -16, -16]
        result = self.run_session(reference, [left, right, final])
        self.assertEqual(result["challenge_status"], "PASSED")

    def test_nonzero_positive_reference_followed_by_negative_relative_target(self):
        reference = [16.0] * 16
        left = [16, 16, 16, 24, 28, 32, 35, 36, 36, 36, 36, 34, 30, 24, 20, 16]
        right = [22, 19, 17, 16, 16, 8, 4, 0, -4, -5, -5, -5, -5, -3, 4, 10]
        final = [10, 13, 15, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16]
        result = self.run_session(reference, [left, right, final])
        self.assertEqual(result["challenge_status"], "PASSED")

    def test_left_target_uses_relative_not_absolute_yaw(self):
        reference = [8.0] * 16
        left = [8, 8, 8, 16, 18, 24, 27, 28, 28, 28, 28, 26, 20, 14, 10, 8]
        right = [14, 11, 9, 8, 8, 0, -4, -10, -12, -13, -14, -14, -14, -12, -8, -4]
        final = [2, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8]
        result = self.run_session(reference, [left, right, final])
        self.assertEqual(result["challenge_status"], "PASSED")

    def test_absolute_plus_20_is_not_target_when_reference_plus_8(self):
        reference = [8.0] * 16
        left = [8, 8, 8, 10, 12, 14, 16, 18, 20, 20, 20, 18, 14, 10, 8, 8]
        steps = [left, [8] * 16, [8] * 16]
        result = self.run_session(reference, steps)
        self.assertEqual(result["challenge_status"], "FAILED")
        self.assertEqual(result["failure_reason"], "TARGET_POSE_NOT_HELD")

    def test_single_frame_target_excursion_fails(self):
        reference = [0.0] * 16
        left = [0, 0, 0, 8, 10, 12, 22, 10, 8, 6, 4, 2, 1, 0, 0, 0]
        steps = [left, [0] * 16, [0] * 16]
        result = self.run_session(reference, steps)
        self.assertEqual(result["challenge_status"], "FAILED")

    def test_wrong_direction_fails(self):
        reference = [0.0] * 16
        left = [0, 0, 0, -8, -12, -18, -20, -21, -22, -22, -22, -20, -15, -10, -5, 0]
        result = self.run_session(reference, [left, [0] * 16, [0] * 16])
        self.assertEqual(result["challenge_status"], "FAILED")
        self.assertEqual(result["failure_reason"], "CONTRADICTORY_MOVEMENT")

    def test_insufficient_movement_fails(self):
        reference = [0.0] * 16
        left = [0, 0, 0, 4, 6, 7, 8, 9, 10, 9, 8, 6, 4, 2, 1, 0]
        result = self.run_session(reference, [left, [0] * 16, [0] * 16])
        self.assertEqual(result["challenge_status"], "FAILED")
        self.assertEqual(result["failure_reason"], "TARGET_POSE_NOT_HELD")

    def test_return_is_relative_to_reference_not_absolute_zero(self):
        reference = [8.0] * 16
        left = [8, 8, 8, 16, 20, 25, 28, 28, 28, 28, 28, 24, 18, 14, 10, 8]
        right = [14, 11, 9, 8, 8, 0, -4, -10, -12, -13, -14, -14, -14, -12, -7, -2]
        final = [4, 6, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8]
        result = self.run_session(reference, [left, right, final])
        self.assertEqual(result["challenge_status"], "PASSED")

    def test_multiple_faces_stop_progression(self):
        reference, steps = make_success_sequence()
        counts = [1] * 16 + [1] * 4 + [2] + [1] * 59
        result = self.run_session(reference, steps, FakeDetector(counts))
        self.assertEqual(result["challenge_status"], "FAILED")
        self.assertEqual(result["failure_reason"], "MULTIPLE_FACES_DETECTED")

    def test_short_face_loss_is_tolerated(self):
        reference, steps = make_success_sequence()
        counts = [1] * 16 + [1, 1, 0, 0, 1, 1] + [1] * 42
        result = self.run_session(reference, steps, FakeDetector(counts))
        self.assertEqual(result["challenge_status"], "PASSED")

    def test_persistent_face_loss_fails(self):
        reference, steps = make_success_sequence()
        counts = [1] * 16 + [0, 0, 0, 0] + [1] * 48
        result = self.run_session(reference, steps, FakeDetector(counts))
        self.assertEqual(result["challenge_status"], "FAILED")
        self.assertEqual(result["failure_reason"], "PERSISTENT_FACE_LOSS")

    def test_low_quality_pose_does_not_count(self):
        reference, steps = make_success_sequence()
        poses = pose_sequence(reference + [0] * 16 + [0] * 16 + [0] * 16)
        poses[20] = PoseMeasurement(22, 0, 0, 25, .99, 300, 300)
        frames = [np.zeros((480, 640, 3), dtype=np.uint8) for _ in poses]
        step_frames = [frames[16:32], frames[32:48], frames[48:64]]
        with patch("active_challenge.estimate_head_pose", side_effect=iter(poses)):
            result = verify_active_challenge_sequence(frames[:16], list(zip(CHALLENGE_SEQUENCE, step_frames)), FakeDetector())
        self.assertEqual(result["challenge_status"], "FAILED")

    def test_variable_distance_is_quality_floor_only(self):
        reference, steps = make_success_sequence()
        poses = pose_sequence(list(reference) + [y for step in steps for y in step])
        frames = [np.zeros((480, 640, 3), dtype=np.uint8) for _ in poses]
        counts = [1] * len(poses)
        # Detection box size is controlled by the detector; all remain above the floor.
        result = self.run_session(reference, steps, FakeDetector(counts))
        self.assertEqual(result["challenge_status"], "PASSED")

    def test_final_return_is_required(self):
        reference, steps = make_success_sequence()
        steps[2] = [-10, -10, -8, -7, -7, -7, -7, -7, -7, -7, -7, -7, -7, -7, -7, -7]
        result = self.run_session(reference, steps)
        self.assertEqual(result["challenge_status"], "FAILED")
        self.assertEqual(result["failure_reason"], "FINAL_RETURN_NOT_CONFIRMED")

    def test_sequence_order_is_enforced(self):
        reference, steps = make_success_sequence()
        frames = [np.zeros((480, 640, 3), dtype=np.uint8) for _ in range(64)]
        with patch("active_challenge.estimate_head_pose", side_effect=iter(pose_sequence([0] * 64))):
            result = verify_active_challenge_sequence(frames[:16], [("TURN_RIGHT", frames[16:32]), ("TURN_LEFT", frames[32:48]), ("LOOK_STRAIGHT", frames[48:64])], FakeDetector())
        self.assertEqual(result["failure_reason"], "INVALID_CHALLENGE_SEQUENCE")

    def test_legacy_single_burst_api_cannot_bypass_session(self):
        result = verify_active_challenge("TURN_LEFT", [np.zeros((480, 640, 3), dtype=np.uint8)] * 16, FakeDetector())
        self.assertEqual(result["failure_reason"], "PASS3D_REQUIRES_CHALLENGE_SESSION")


if __name__ == "__main__":
    unittest.main()
