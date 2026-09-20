"""Passive PAD unit tests.

Converted from pytest to unittest so the whole Python suite runs with the
stdlib runner and no extra dependency.
"""

from __future__ import annotations

import unittest
from pathlib import Path

import cv2
import numpy as np

from liveness import (
    EXPECTED_FEATURES,
    FEATURE_VERSION,
    MIN_CROP_EDGE,
    MIN_FRAMES,
    PadModelInfo,
    aggregate_spoof_probability,
    analyze_sequence,
    crop_face,
    extract_features,
    image_quality,
    load_pad_model,
    temporal_evidence,
)

FACE_BOX = (100.0, 65.0, 120.0, 120.0)


def synthetic_frames(count: int = 6, drift: int = 1) -> list[np.ndarray]:
    frames = []
    for i in range(count):
        frame = np.full((240, 320, 3), 120, np.uint8)
        offset = i * drift
        cv2.rectangle(frame, (100 + offset, 65), (220 + offset, 185), (160, 150, 140), -1)
        frames.append(frame)
    return frames


def boxes_for(frames: list[np.ndarray], drift: int = 1):
    return [(100.0 + i * drift, 65.0, 120.0, 120.0) for i in range(len(frames))]


def unavailable_model_info() -> PadModelInfo:
    return PadModelInfo(False, False, "CyberShield-PAD", "unavailable", FEATURE_VERSION, {}, False, ("MODEL_FILE_NOT_FOUND",))


class FeatureContractTests(unittest.TestCase):
    def test_feature_vector_has_the_declared_dimension(self):
        crop = crop_face(synthetic_frames(1)[0], FACE_BOX)
        self.assertIsNotNone(crop)
        self.assertEqual(extract_features(crop).shape, (EXPECTED_FEATURES,))

    def test_feature_version_records_the_face_crop_contract(self):
        # Whole-frame artifacts measure a different thing and must not be
        # silently reused once PAD moved to face crops.
        self.assertIn("face-crop", FEATURE_VERSION)

    def test_empty_crop_is_rejected(self):
        with self.assertRaises(ValueError):
            extract_features(np.zeros((0, 0, 3), np.uint8))


class CropTests(unittest.TestCase):
    def test_crop_includes_margin_around_the_box(self):
        frame = synthetic_frames(1)[0]
        crop = crop_face(frame, FACE_BOX, margin=0.25)
        self.assertIsNotNone(crop)
        # 120px box + 25% either side, clipped to the frame.
        self.assertGreater(crop.shape[0], 120)
        self.assertGreater(crop.shape[1], 120)

    def test_crop_is_clipped_to_the_frame(self):
        frame = synthetic_frames(1)[0]
        crop = crop_face(frame, (300.0, 200.0, 120.0, 120.0))
        if crop is not None:
            self.assertLessEqual(crop.shape[0], frame.shape[0])
            self.assertLessEqual(crop.shape[1], frame.shape[1])

    def test_missing_box_yields_no_crop(self):
        self.assertIsNone(crop_face(synthetic_frames(1)[0], None))

    def test_tiny_box_yields_no_crop(self):
        tiny = (10.0, 10.0, MIN_CROP_EDGE / 4, MIN_CROP_EDGE / 4)
        self.assertIsNone(crop_face(synthetic_frames(1)[0], tiny))


class QualityAndTemporalTests(unittest.TestCase):
    def test_quality_is_measured_on_the_crop(self):
        crop = crop_face(synthetic_frames(1)[0], FACE_BOX)
        quality = image_quality(crop)
        self.assertGreaterEqual(quality.brightness, 0)
        self.assertGreaterEqual(quality.sharpness, 0)

    def test_small_crop_is_flagged_too_small(self):
        small = np.full((40, 40, 3), 120, np.uint8)
        self.assertIn("FACE_TOO_SMALL", image_quality(small).issues)

    def test_temporal_evidence_tracks_a_consistent_face(self):
        frames = synthetic_frames()
        evidence = temporal_evidence(frames, boxes_for(frames))
        self.assertEqual(evidence.frame_count, 6)
        self.assertTrue(evidence.face_count_consistent)
        self.assertTrue(0.0 <= evidence.mean_iou <= 1.0)

    def test_a_dropped_box_marks_tracking_inconsistent(self):
        frames = synthetic_frames()
        boxes = boxes_for(frames)
        boxes[2] = None
        self.assertIn("FACE_TRACKING_INCONSISTENT", temporal_evidence(frames, boxes).issues)

    def test_aggregation_uses_the_median(self):
        median, spread = aggregate_spoof_probability([0.1, 0.2, 0.3])
        self.assertAlmostEqual(median, 0.2)
        self.assertGreater(spread, 0.0)


class FailClosedTests(unittest.TestCase):
    def test_missing_pad_artifact_fails_closed(self):
        model, info = load_pad_model(Path(__file__).with_name("__missing_pad_model__.pkl"))
        self.assertIsNone(model)
        self.assertFalse(info.valid)
        self.assertFalse(info.loaded)
        self.assertIn("MODEL_FILE_NOT_FOUND", info.issues)

    def test_no_model_never_reports_live(self):
        frames = synthetic_frames(8)
        result = analyze_sequence(frames, boxes_for(frames), None, unavailable_model_info())
        self.assertEqual(result["liveness_status"], "UNCERTAIN")
        self.assertEqual(result["evidence"]["pad"]["status"], "UNAVAILABLE")

    def test_box_list_must_line_up_with_frames(self):
        frames = synthetic_frames(8)
        result = analyze_sequence(frames, [], None, unavailable_model_info())
        self.assertEqual(result["liveness_status"], "UNCERTAIN")
        self.assertIn("FACE_EVIDENCE_INCOMPLETE", result["issues"])

    def test_too_few_frames_is_uncertain(self):
        frames = synthetic_frames(MIN_FRAMES - 1)
        result = analyze_sequence(frames, boxes_for(frames), None, unavailable_model_info())
        self.assertEqual(result["liveness_status"], "UNCERTAIN")
        self.assertTrue(any(i.startswith("INSUFFICIENT_FRAMES") for i in result["issues"]))

    def test_too_few_face_crops_is_uncertain(self):
        frames = synthetic_frames(8)
        boxes = [None] * len(frames)
        result = analyze_sequence(frames, boxes, None, unavailable_model_info())
        self.assertTrue(any(i.startswith("INSUFFICIENT_FACE_CROPS") for i in result["issues"]))


class DecisionTests(unittest.TestCase):
    """The PAD verdict runs on face crops and reports its own caveats."""

    class StubModel:
        classes_ = [0, 1]

        def __init__(self, spoof_probability: float) -> None:
            self.spoof_probability = spoof_probability

        def predict_proba(self, features):
            return np.array([[1.0 - self.spoof_probability, self.spoof_probability]])

    def info(self, calibrated: bool = False) -> PadModelInfo:
        return PadModelInfo(
            True, True, "Stub-PAD", "test", FEATURE_VERSION, {0: "live", 1: "spoof"}, calibrated, ()
        )

    def test_uncalibrated_live_verdict_carries_a_caveat(self):
        frames = synthetic_frames(8)
        result = analyze_sequence(frames, boxes_for(frames), self.StubModel(0.02), self.info())
        self.assertIn(result["liveness_status"], {"LIVE", "UNCERTAIN"})
        if result["liveness_status"] == "LIVE":
            self.assertIn("PAD_MODEL_NOT_CALIBRATED", result["issues"])

    def test_pad_scores_the_face_crop_rather_than_the_whole_frame(self):
        """The regression that matters: features must come from the crop.

        Scoring whole frames let the room, not the face, dominate a
        1536-bin colour histogram.
        """
        recorded: list[np.ndarray] = []

        class RecordingModel(DecisionTests.StubModel):
            def predict_proba(self, features):
                recorded.append(np.asarray(features).reshape(-1))
                return super().predict_proba(features)

        frames = synthetic_frames(8)
        boxes = boxes_for(frames)
        analyze_sequence(frames, boxes, RecordingModel(0.5), self.info())

        self.assertEqual(len(recorded), len(frames))
        expected_crop = extract_features(crop_face(frames[0], boxes[0]))
        whole_frame = extract_features(frames[0])
        np.testing.assert_allclose(recorded[0], expected_crop, rtol=1e-6)
        self.assertFalse(np.allclose(recorded[0], whole_frame))


if __name__ == "__main__":
    unittest.main()
