from __future__ import annotations

import unittest

from temporal_reference import (
    MAX_REPROJECTION_ERROR,
    MIN_FACE_CONFIDENCE,
    TemporalReferenceEstimator,
    ReferencePoseSample,
)


def sample(
    yaw: float,
    pitch: float = 0.0,
    roll: float = 0.0,
    reprojection: float = 8.0,
    confidence: float = 0.93,
    width: float = 160.0,
    height: float = 200.0,
    face_count: int = 1,
    valid: bool = True,
) -> ReferencePoseSample:
    return ReferencePoseSample(
        yaw=yaw,
        pitch=pitch,
        roll=roll,
        reprojection_error=reprojection,
        face_confidence=confidence,
        face_width=width,
        face_height=height,
        face_count=face_count,
        pose_valid=valid,
    )


class TemporalReferenceTests(unittest.TestCase):
    def feed(self, estimator, values):
        results = []
        for value in values:
            results.append(estimator.observe(sample(value)))
        return results

    def test_requires_multiple_temporally_stable_observations(self):
        estimator = TemporalReferenceEstimator()
        results = self.feed(estimator, [0.0] * 11)
        self.assertFalse(estimator.established)
        self.assertTrue(all(result == "WAITING_FOR_STABILITY" for result in results))
        self.assertEqual(estimator.valid_candidate_count, 11)

        result = estimator.observe(sample(0.4))
        self.assertEqual(result, "REFERENCE_ESTABLISHED")
        self.assertTrue(estimator.established)
        self.assertEqual(estimator.reference.samples_used, 12)


    def test_supplied_physical_cluster_is_eligible_for_candidate_evidence(self):
        estimator = TemporalReferenceEstimator()
        values = [-13.32, -17.66, -19.18, -18.44, -13.03, -18.41, -16.09, -17.56, -13.49]
        results = self.feed(estimator, values)
        self.assertFalse(estimator.established)
        self.assertEqual(estimator.valid_candidate_count, 9)
        self.assertTrue(all(result in {"WAITING_FOR_STABILITY"} for result in results))

    def test_reference_uses_median_not_mean(self):
        estimator = TemporalReferenceEstimator()
        values = [0.0, 0.2, 0.4, 0.1, 0.3, 0.2, 0.1, 0.4, 0.2, 2.0]
        self.feed(estimator, values + [0.2, 0.2])
        self.assertTrue(estimator.established)
        self.assertAlmostEqual(estimator.reference.yaw, 0.2, places=6)

    def test_stable_moderately_nonzero_yaw_can_establish_reference(self):
        estimator = TemporalReferenceEstimator()
        results = self.feed(estimator, [-16.0] * 12)
        self.assertTrue(estimator.established)
        self.assertEqual(results[-1], "REFERENCE_ESTABLISHED")
        self.assertAlmostEqual(estimator.reference.yaw, -16.0, places=6)

    def test_stable_positive_moderately_nonzero_yaw_can_establish_reference(self):
        estimator = TemporalReferenceEstimator()
        results = self.feed(estimator, [16.0] * 12)
        self.assertTrue(estimator.established)
        self.assertEqual(results[-1], "REFERENCE_ESTABLISHED")
        self.assertAlmostEqual(estimator.reference.yaw, 16.0, places=6)

    def test_clearly_already_turned_reference_is_rejected_by_median_envelope(self):
        estimator = TemporalReferenceEstimator()
        results = self.feed(estimator, [20.0] * 12)
        self.assertFalse(estimator.established)
        self.assertEqual(results[-1], "REFERENCE_YAW_OFFSET_TOO_LARGE")

    def test_stable_reference_with_small_natural_pitch_roll_offsets(self):
        estimator = TemporalReferenceEstimator()
        values = [
            (-16.0, -3.0, 1.0), (-16.1, -2.8, 0.8), (-15.9, -3.2, 1.1),
            (-16.2, -3.1, 0.9), (-15.8, -2.9, 1.0), (-16.0, -3.0, 1.0),
            (-16.1, -3.1, 0.9), (-15.9, -2.9, 1.1), (-16.0, -3.0, 1.0),
            (-16.2, -3.2, 0.8), (-15.8, -2.8, 1.2), (-16.0, -3.0, 1.0),
        ]
        for yaw, pitch, roll in values:
            result = estimator.observe(sample(yaw, pitch=pitch, roll=roll))
        self.assertTrue(estimator.established)
        self.assertEqual(result, "REFERENCE_ESTABLISHED")

    def test_unstable_yaw_cluster_spanning_more_than_six_degrees_does_not_establish(self):
        estimator = TemporalReferenceEstimator()
        self.feed(estimator, [-16.0, -16.0, -16.0, -16.0, -16.0, -16.0,
                              -16.0, -16.0, -16.0, -16.0, -9.0, -9.0])
        self.assertFalse(estimator.established)

    def test_high_yaw_mad_does_not_establish(self):
        estimator = TemporalReferenceEstimator()
        self.feed(estimator, [-19.0, -19.0, -19.0, -19.0, -19.0, -19.0,
                              -13.0, -13.0, -13.0, -13.0, -13.0, -13.0])
        self.assertFalse(estimator.established)

    def test_quality_security_envelope_still_rejects_bad_candidates(self):
        estimator = TemporalReferenceEstimator()
        self.assertEqual(estimator.observe(sample(-16.0, pitch=13.0)), "NOT_RAW_NEUTRAL_PITCH")
        estimator.reset()
        self.assertEqual(estimator.observe(sample(-16.0, roll=13.0)), "NOT_RAW_NEUTRAL_ROLL")
        estimator.reset()
        self.assertEqual(estimator.observe(sample(-16.0, confidence=0.84)), "FACE_CONFIDENCE_TOO_LOW")
        estimator.reset()
        self.assertEqual(estimator.observe(sample(-16.0, reprojection=18.1)), "REPROJECTION_ERROR_TOO_HIGH")
        estimator.reset()
        self.assertEqual(estimator.observe(sample(-16.0, face_count=2)), "MULTIPLE_FACES")

    def test_pitch_and_roll_also_gate_reference(self):
        estimator = TemporalReferenceEstimator()
        self.assertEqual(estimator.observe(sample(0.0, pitch=13.0)), "NOT_RAW_NEUTRAL_PITCH")
        estimator.reset()
        self.assertEqual(estimator.observe(sample(0.0, roll=13.0)), "NOT_RAW_NEUTRAL_ROLL")

    def test_quality_invalid_observation_does_not_enter_reference_window(self):
        estimator = TemporalReferenceEstimator()
        self.assertEqual(
            estimator.observe(sample(0.0, reprojection=MAX_REPROJECTION_ERROR + 0.1)),
            "REPROJECTION_ERROR_TOO_HIGH",
        )
        self.assertEqual(estimator.valid_candidate_count, 0)
        self.assertEqual(
            estimator.observe(sample(0.0, confidence=MIN_FACE_CONFIDENCE - 0.01)),
            "FACE_CONFIDENCE_TOO_LOW",
        )
        self.assertEqual(estimator.valid_candidate_count, 0)
        self.assertEqual(
            estimator.observe(sample(0.0, face_count=2)),
            "MULTIPLE_FACES",
        )
        self.assertEqual(estimator.valid_candidate_count, 0)

    def test_face_size_is_a_minimum_quality_gate_not_a_fixed_distance(self):
        estimator = TemporalReferenceEstimator()
        # Large distance/size variation is allowed as long as every frame
        # remains above the minimum quality floor.
        sizes = [(90, 100), (160, 200), (300, 350), (120, 180)] * 3
        for width, height in sizes:
            result = estimator.observe(sample(0.2, width=width, height=height))
        self.assertTrue(estimator.established)
        self.assertIn(result, {"REFERENCE_ESTABLISHED", "REFERENCE_ALREADY_ESTABLISHED"})

    def test_short_face_loss_does_not_immediately_destroy_acquisition(self):
        estimator = TemporalReferenceEstimator()
        self.feed(estimator, [0.0] * 6)
        for _ in range(2):
            estimator.observe(sample(0.0, face_count=0))
        self.feed(estimator, [0.1] * 6)
        self.assertTrue(estimator.established)

    def test_persistent_face_loss_clears_candidate_window(self):
        estimator = TemporalReferenceEstimator()
        self.feed(estimator, [0.0] * 6)
        for _ in range(4):
            estimator.observe(sample(0.0, face_count=0))
        self.assertEqual(estimator.valid_candidate_count, 0)
        self.assertFalse(estimator.established)

    def test_unstable_pose_does_not_establish_reference(self):
        estimator = TemporalReferenceEstimator()
        self.feed(estimator, [0.0, 6.0, 0.0, 6.0, 0.0, 6.0, 0.0, 6.0, 0.0, 6.0, 0.0, 6.0])
        self.assertFalse(estimator.established)

    def test_single_frame_outlier_does_not_shift_established_reference(self):
        estimator = TemporalReferenceEstimator()
        self.feed(estimator, [1.0] * 12)
        self.assertTrue(estimator.established)
        relative = estimator.relative(sample(21.0))
        self.assertAlmostEqual(relative.yaw, 20.0, places=6)

    def test_relative_pose_uses_one_consistent_coordinate_system(self):
        estimator = TemporalReferenceEstimator()
        self.feed(estimator, [3.0, 3.2, 2.8, 3.1, 3.0, 3.2, 2.9, 3.1, 3.0, 3.1, 3.0, 3.1])
        self.assertTrue(estimator.established)
        relative = estimator.relative(sample(23.0, pitch=4.0, roll=-2.0))
        self.assertAlmostEqual(relative.yaw, 20.0, delta=0.2)
        self.assertAlmostEqual(relative.pitch, 4.0, delta=0.2)
        self.assertAlmostEqual(relative.roll, -2.0, delta=0.2)

    def test_reference_cannot_be_changed_after_establishment(self):
        estimator = TemporalReferenceEstimator()
        self.feed(estimator, [1.0] * 12)
        original = estimator.reference
        result = estimator.observe(sample(-8.0))
        self.assertEqual(result, "REFERENCE_ALREADY_ESTABLISHED")
        self.assertEqual(estimator.reference, original)

    def test_invalid_values_are_rejected(self):
        estimator = TemporalReferenceEstimator()
        self.assertEqual(estimator.observe(sample(float("nan"))), "INVALID_POSE_VALUES")
        self.assertEqual(estimator.observe(sample(0.0, valid=False)), "POSE_INVALID")
        self.assertFalse(estimator.established)


if __name__ == "__main__":
    unittest.main()
