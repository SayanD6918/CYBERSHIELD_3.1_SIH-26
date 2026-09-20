"""Endpoint-level contract tests for main.py.

FastAPI only routes to these handlers, so they can be called directly with
the framework stubbed out. That keeps the suite runnable on a bare Python
install and makes these tests cheap enough to run on every change.
"""

from __future__ import annotations

import base64
import unittest

import cv2
import numpy as np

from _stubs.fastapi_stub import install

install()

import main  # noqa: E402  (must follow the stub installation)


def data_url(image: np.ndarray) -> str:
    ok, buffer = cv2.imencode(".jpg", image)
    assert ok
    return "data:image/jpeg;base64," + base64.b64encode(buffer.tobytes()).decode()


def frame(value: int = 120) -> np.ndarray:
    return np.full((240, 320, 3), value, np.uint8)


class DecodeTests(unittest.TestCase):
    def test_valid_data_url_decodes(self):
        image = main.decode_data_url(data_url(frame()))
        self.assertEqual(image.shape[:2], (240, 320))

    def test_malformed_base64_raises_a_typed_error(self):
        with self.assertRaises(main.ImageDecodeError):
            main.decode_data_url("data:image/jpeg;base64,not-base64!!!")

    def test_non_image_payload_raises_a_typed_error(self):
        payload = base64.b64encode(b"this is not an image").decode()
        with self.assertRaises(main.ImageDecodeError):
            main.decode_data_url(f"data:image/jpeg;base64,{payload}")

    def test_oversized_payload_is_rejected(self):
        oversized = base64.b64encode(b"\x00" * (main.MAX_IMAGE_BYTES + 1)).decode()
        with self.assertRaises(main.ImageDecodeError):
            main.decode_data_url(f"data:image/jpeg;base64,{oversized}")


class LivenessEndpointTests(unittest.TestCase):
    def test_no_frames_is_uncertain_not_an_error(self):
        result = main.liveness(main.ImageRequest())
        self.assertEqual(result["liveness_status"], "UNCERTAIN")
        self.assertIn("NO_FRAMES_PROVIDED", result["issues"])

    def test_bad_image_data_returns_evidence_not_a_500(self):
        request = main.ImageRequest(frames_data_urls=["data:image/jpeg;base64,!!!"])
        result = main.liveness(request)
        self.assertEqual(result["liveness_status"], "UNCERTAIN")
        self.assertIn("INVALID_IMAGE_DATA", result["issues"])

    def test_face_count_per_frame_covers_every_frame(self):
        """The slot list used to be empty when the detector was unavailable,
        which silently disarmed the guard that forces UNCERTAIN."""
        frames = [data_url(frame(100 + i)) for i in range(8)]
        result = main.liveness(main.ImageRequest(frames_data_urls=frames))
        self.assertEqual(len(result["face_count_per_frame"]), len(frames))
        self.assertEqual(result["liveness_status"], "UNCERTAIN")

    def test_detector_unavailable_is_reported_explicitly(self):
        frames = [data_url(frame(100 + i)) for i in range(8)]
        result = main.liveness(main.ImageRequest(frames_data_urls=frames))
        if not main.face_detector.loaded:
            self.assertIn("FACE_DETECTOR_MODEL_UNAVAILABLE", result["issues"])


class DetectBoxesTests(unittest.TestCase):
    def test_one_slot_per_frame_when_the_detector_is_missing(self):
        frames = [frame() for _ in range(5)]
        boxes, issues = main.detect_boxes(frames)
        self.assertEqual(len(boxes), len(frames))
        if not main.face_detector.loaded:
            self.assertTrue(all(box is None for box in boxes))
            self.assertIn("FACE_DETECTOR_MODEL_UNAVAILABLE", issues)


class ActiveChallengeEndpointTests(unittest.TestCase):
    def test_unknown_challenge_fails_cleanly(self):
        result = main.active_challenge(
            main.ActiveChallengeRequest(challenge="BACKFLIP", frames_data_urls=["x"])
        )
        self.assertEqual(result["failure_reason"], "UNKNOWN_CHALLENGE")

    def test_no_frames_fails_cleanly(self):
        result = main.active_challenge(
            main.ActiveChallengeRequest(challenge="TURN_LEFT", frames_data_urls=[])
        )
        self.assertEqual(result["failure_reason"], "NO_FRAMES_PROVIDED")

    def test_a_challenge_never_reports_passed_without_a_detector(self):
        result = main.active_challenge(
            main.ActiveChallengeRequest(challenge="TURN_LEFT", frames_data_urls=[data_url(frame())])
        )
        self.assertNotEqual(result["challenge_status"], "PASSED")


class FaceMatchEndpointTests(unittest.TestCase):
    def test_burst_and_single_still_are_both_accepted(self):
        request = main.FaceMatchRequest(
            document_image_data_url=data_url(frame()),
            live_frames_data_urls=[data_url(frame(130)), data_url(frame(140))],
        )
        self.assertEqual(len(request.get_live_frames()), 2)

        legacy = main.FaceMatchRequest(
            document_image_data_url=data_url(frame()),
            live_image_data_url=data_url(frame(130)),
        )
        self.assertEqual(len(legacy.get_live_frames()), 1)

    def test_missing_live_frames_is_uncertain(self):
        result = main.face_match(
            main.FaceMatchRequest(document_image_data_url=data_url(frame()))
        )
        self.assertEqual(result["face_match_status"], "UNCERTAIN")
        self.assertIn("NO_LIVE_FRAMES_PROVIDED", result["issues"])

    def test_bad_image_data_is_uncertain_not_a_500(self):
        result = main.face_match(
            main.FaceMatchRequest(
                document_image_data_url="data:image/jpeg;base64,!!!",
                live_frames_data_urls=[data_url(frame())],
            )
        )
        self.assertEqual(result["face_match_status"], "UNCERTAIN")
        self.assertIn("INVALID_IMAGE_DATA", result["issues"])

    def test_similarity_is_never_presented_as_a_probability(self):
        result = main.face_match(
            main.FaceMatchRequest(
                document_image_data_url=data_url(frame()),
                live_frames_data_urls=[data_url(frame(130))],
            )
        )
        self.assertEqual(result["metric"], "cosine_similarity")
        self.assertFalse(result["calibrated"])

    def test_issue_lists_never_contain_nulls(self):
        result = main.face_match(
            main.FaceMatchRequest(
                document_image_data_url=data_url(frame()),
                live_frames_data_urls=[data_url(frame(130))],
            )
        )
        self.assertTrue(all(issue is not None for issue in result["issues"]))


class HealthTests(unittest.TestCase):
    def test_health_reports_pad_state_honestly(self):
        health = main.health()
        self.assertFalse(health["face_match_calibrated"])
        self.assertIn("liveness_expected_feature_version", health)
        if not health["liveness_model_artifact_present"]:
            self.assertFalse(health["liveness_model_loaded"])
            self.assertFalse(health["liveness_model_valid"])


if __name__ == "__main__":
    unittest.main()
