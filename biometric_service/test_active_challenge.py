from __future__ import annotations

import unittest
from unittest.mock import patch

import numpy as np

from active_challenge import PoseMeasurement, verify_active_challenge


class FakeDetection:
    def __init__(self, confidence=0.99):
        self.confidence = confidence
        self.landmarks = np.zeros((5, 2), dtype=np.float32)
        self.box = (100.0, 80.0, 300.0, 300.0)


class FakeDetector:
    def __init__(self, count=1):
        self.count = count
    def detect(self, frame):
        return [FakeDetection() for _ in range(self.count)]


def poses(yaws):
    return [
        PoseMeasurement(float(y), 0.0, 0.0, 2.0, 0.99)
        for y in yaws
    ]


class ActiveChallengeTests(unittest.TestCase):
    def run_case(self, challenge, yaws, detector=None):
        frames = [np.zeros((480, 640, 3), dtype=np.uint8) for _ in yaws]
        detector = detector or FakeDetector()
        with patch("active_challenge.estimate_head_pose", side_effect=iter(poses(yaws))):
            return verify_active_challenge(challenge, frames, detector)

    def test_successful_left_turn(self):
        result = self.run_case("TURN_LEFT", [0, 1, 0, 1, 0, 5, 12, 21, 23, 24])
        self.assertEqual(result["challenge_status"], "PASSED")
        self.assertTrue(result["movement_detected"])
        self.assertIsNone(result["failure_reason"])

    def test_failed_left_turn(self):
        result = self.run_case("TURN_LEFT", [0, 1, 0, 1, 0, 3, 5, 7, 8, 9])
        self.assertEqual(result["challenge_status"], "FAILED")
        self.assertTrue(result["movement_detected"])
        self.assertEqual(result["failure_reason"], "TARGET_POSE_NOT_HELD")

    def test_successful_right_turn(self):
        result = self.run_case("TURN_RIGHT", [0, 0, 1, 0, -1, -5, -12, -21, -23, -24])
        self.assertEqual(result["challenge_status"], "PASSED")
        self.assertTrue(result["movement_detected"])

    def test_failed_right_turn(self):
        result = self.run_case("TURN_RIGHT", [0, 1, 0, 1, 0, 3, 5, 7, 8, 9])
        self.assertEqual(result["challenge_status"], "FAILED")
        self.assertEqual(result["failure_reason"], "REQUESTED_MOVEMENT_NOT_DETECTED")

    def test_successful_straight(self):
        result = self.run_case("LOOK_STRAIGHT", [25, 24, 26, 24, 25, 18, 14, 8, 6, 4, 5])
        self.assertEqual(result["challenge_status"], "PASSED")
        self.assertTrue(result["movement_detected"])

    def test_failed_straight(self):
        result = self.run_case("LOOK_STRAIGHT", [25, 24, 26, 24, 25, 20, 18, 16, 15, 14])
        self.assertEqual(result["challenge_status"], "FAILED")
        self.assertEqual(result["failure_reason"], "TARGET_POSE_NOT_HELD")

    def test_no_face(self):
        result = self.run_case("TURN_LEFT", [0] * 10, FakeDetector(count=0))
        self.assertEqual(result["challenge_status"], "FAILED")
        self.assertEqual(result["failure_reason"], "FACE_LOST_DURING_CHALLENGE")

    def test_multiple_faces(self):
        result = self.run_case("TURN_LEFT", [0] * 10, FakeDetector(count=2))
        self.assertEqual(result["challenge_status"], "FAILED")
        self.assertEqual(result["failure_reason"], "MULTIPLE_FACES_DETECTED")

    def test_initial_pose_must_be_neutral_for_turn(self):
        result = self.run_case("TURN_LEFT", [20, 21, 20, 19, 21, 25, 28, 30, 31, 32])
        self.assertEqual(result["challenge_status"], "FAILED")
        self.assertEqual(result["failure_reason"], "INITIAL_POSE_NOT_NEUTRAL")

    def test_straight_does_not_pass_without_movement(self):
        result = self.run_case("LOOK_STRAIGHT", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
        self.assertEqual(result["challenge_status"], "FAILED")
        self.assertEqual(result["failure_reason"], "INITIAL_POSE_ALREADY_STRAIGHT")


if __name__ == "__main__":
    unittest.main()
