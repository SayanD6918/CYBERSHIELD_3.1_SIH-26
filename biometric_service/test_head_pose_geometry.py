"""Geometry regression tests for the head-pose estimator.

These render synthetic landmarks from a known head rotation and check what
estimate_head_pose() recovers. The existing challenge tests patch the pose
estimator out entirely, so before this file the 3-D model convention had no
coverage at all - and it was wrong: a frontal face measured yaw = 180, which
made every TURN challenge fail its neutral gate and put LOOK_STRAIGHT's
target permanently out of reach.
"""

from __future__ import annotations

import unittest

import numpy as np

from active_challenge import (
    INITIAL_NEUTRAL_YAW,
    STRAIGHT_YAW,
    TARGET_YAW,
    estimate_head_pose,
)
from face_detection import FaceDetection

FRAME_WIDTH, FRAME_HEIGHT = 640, 480

# A plausible face in camera coordinates: +x right in the image, +y down,
# +z away from the camera. Rows follow YuNet's landmark order, so row 0 is
# the eye that appears on the left of an unmirrored image.
FACE_POINTS_MM = np.array(
    [
        [-65.0, -50.0, 100.0],
        [65.0, -50.0, 100.0],
        [0.0, 0.0, 0.0],
        [-45.0, 60.0, 80.0],
        [45.0, 60.0, 80.0],
    ]
)


def camera_matrix() -> np.ndarray:
    focal = 0.9 * max(FRAME_WIDTH, FRAME_HEIGHT)
    return np.array(
        [[focal, 0.0, FRAME_WIDTH / 2], [0.0, focal, FRAME_HEIGHT / 2], [0.0, 0.0, 1.0]]
    )


def render_landmarks(turn_degrees: float) -> np.ndarray:
    """Project the face after turning the head.

    Positive `turn_degrees` turns the subject toward their own left, which
    swings their nose toward the right-hand side of an unmirrored image.
    """
    angle = np.radians(-turn_degrees)
    rotation = np.array(
        [
            [np.cos(angle), 0.0, np.sin(angle)],
            [0.0, 1.0, 0.0],
            [-np.sin(angle), 0.0, np.cos(angle)],
        ]
    )
    points = (rotation @ FACE_POINTS_MM.T).T + np.array([0.0, 0.0, 700.0])
    projected = (camera_matrix() @ points.T).T
    return (projected[:, :2] / projected[:, 2:3]).astype(np.float32)


def pose_for(turn_degrees: float):
    landmarks = render_landmarks(turn_degrees)
    detection = FaceDetection((0.0, 0.0, 200.0, 200.0), landmarks, 0.99)
    return pose_for_landmarks(detection), landmarks


def pose_for_landmarks(detection: FaceDetection):
    return estimate_head_pose(detection, (FRAME_HEIGHT, FRAME_WIDTH))


class HeadPoseGeometryTests(unittest.TestCase):
    def test_frontal_face_is_near_zero_not_one_eighty(self):
        pose, _ = pose_for(0.0)
        self.assertAlmostEqual(pose.yaw, 0.0, delta=2.0)
        self.assertAlmostEqual(pose.roll, 0.0, delta=2.0)

    def test_frontal_face_passes_the_neutral_gate(self):
        pose, _ = pose_for(0.0)
        self.assertLessEqual(abs(pose.yaw), INITIAL_NEUTRAL_YAW)

    def test_frontal_face_satisfies_the_look_straight_target(self):
        pose, _ = pose_for(0.0)
        self.assertLessEqual(abs(pose.yaw), STRAIGHT_YAW)

    def test_subject_left_turn_is_positive_yaw(self):
        pose, landmarks = pose_for(25.0)
        nose_offset = float(landmarks[2, 0] - landmarks[:2, 0].mean())
        # Sanity-check the fixture itself: a subject-left turn puts the nose
        # on the right-hand side of the image.
        self.assertGreater(nose_offset, 0.0)
        self.assertGreater(pose.yaw, 0.0)

    def test_subject_right_turn_is_negative_yaw(self):
        pose, landmarks = pose_for(-25.0)
        self.assertLess(float(landmarks[2, 0] - landmarks[:2, 0].mean()), 0.0)
        self.assertLess(pose.yaw, 0.0)

    def test_a_realistic_turn_clears_the_challenge_target(self):
        # The estimator works in uncalibrated model-relative degrees, so this
        # pins that a turn a person would actually make reaches TARGET_YAW.
        self.assertGreaterEqual(pose_for(20.0)[0].yaw, TARGET_YAW)
        self.assertLessEqual(pose_for(-20.0)[0].yaw, -TARGET_YAW)

    def test_yaw_increases_monotonically_with_the_turn(self):
        yaws = [pose_for(angle)[0].yaw for angle in (-30, -15, 0, 15, 30)]
        self.assertEqual(yaws, sorted(yaws))

    def test_reprojection_error_stays_small_for_clean_landmarks(self):
        for angle in (-30, 0, 30):
            self.assertLess(pose_for(angle)[0].reprojection_error, 10.0)


if __name__ == "__main__":
    unittest.main()
