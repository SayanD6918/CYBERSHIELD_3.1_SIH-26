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
    def test_unknown_challenge_sequence_fails_cleanly(self):
        result = main.active_challenge(
            main.ActiveChallengeRequest(
                reference_frames_data_urls=["x"],
                steps=[main.ActiveChallengeStep(action="BACKFLIP", frames_data_urls=["x"])],
            )
        )
        self.assertEqual(result["failure_reason"], "INVALID_CHALLENGE_SEQUENCE")

    def test_no_reference_frames_fails_cleanly(self):
        result = main.active_challenge(
            main.ActiveChallengeRequest(reference_frames_data_urls=[], steps=[])
        )
        self.assertEqual(result["failure_reason"], "NO_REFERENCE_FRAMES_PROVIDED")

    def test_a_challenge_never_reports_passed_without_a_detector(self):
        result = main.active_challenge(
            main.ActiveChallengeRequest(
                reference_frames_data_urls=[data_url(frame())],
                steps=[
                    main.ActiveChallengeStep(action="TURN_LEFT", frames_data_urls=[data_url(frame())]),
                    main.ActiveChallengeStep(action="TURN_RIGHT", frames_data_urls=[data_url(frame())]),
                    main.ActiveChallengeStep(action="LOOK_STRAIGHT", frames_data_urls=[data_url(frame())]),
                ],
            )
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

    def test_face_match_exposes_stage_diagnostics_without_a_model(self):
        result = main.face_match(
            main.FaceMatchRequest(
                document_image_data_url=data_url(frame()),
                live_frames_data_urls=[data_url(frame(130))],
            )
        )
        self.assertEqual(result["metric"], "cosine_similarity")
        self.assertIn("document_portrait", result)
        self.assertIn("document", result)
        self.assertIn("live", result)




class ReplayContractTests(unittest.TestCase):
    def test_duplicate_decoded_frames_are_detected(self):
        frames = [frame(120), frame(120), frame(130)]
        duplicates = main.duplicate_frame_indices(frames)
        self.assertEqual(duplicates, [1])

    def test_single_duplicate_frame_does_not_trigger_replay_failure(self):
        frames = [frame(120), frame(120), frame(130), frame(140), frame(150)]
        self.assertFalse(main.sustained_duplicate_replay(frames))

    def test_sustained_duplicate_frames_trigger_replay_failure(self):
        frames = [frame(120), frame(120), frame(120), frame(120), frame(130)]
        self.assertTrue(main.sustained_duplicate_replay(frames))

    def test_image_mime_type_is_restricted(self):
        raw = base64.b64encode(b"not-an-image").decode()
        with self.assertRaisesRegex(main.ImageDecodeError, "Unsupported image MIME type"):
            main.decode_data_url(f"data:text/plain;base64,{raw}")

if __name__ == "__main__":
    unittest.main()

class TestPhase2SecurityContracts(unittest.TestCase):
    def test_base64_is_strict(self):
        with self.assertRaises(main.ImageDecodeError):
            main.decode_data_url("data:image/jpeg;base64,not-base64!!!")

    def test_oversized_pixel_image_is_rejected(self):
        image = np.zeros((5001, 5001, 3), dtype=np.uint8)
        ok, encoded = cv2.imencode(".jpg", image)
        assert ok
        payload = "data:image/jpeg;base64," + base64.b64encode(encoded.tobytes()).decode()
        with self.assertRaisesRegex(main.ImageDecodeError, "pixels"):
            main.decode_data_url(payload)

class TestFrameLimits(unittest.TestCase):
    def test_liveness_rejects_frame_bursts_above_limit(self):
        frames = [data_url(np.zeros((32, 32, 3), dtype=np.uint8))] * (main.MAX_LIVENESS_FRAMES + 1)
        result = main.liveness(main.ImageRequest(frames_data_urls=frames))
        self.assertIn("TOO_MANY_FRAMES", result["issues"])

    def test_face_match_rejects_probe_bursts_above_limit(self):
        frames = [data_url(np.zeros((32, 32, 3), dtype=np.uint8))] * (main.MAX_PROBE_FRAMES + 1)
        result = main.face_match(main.FaceMatchRequest(
            document_image_data_url=frames[0],
            live_frames_data_urls=frames,
        ))
        self.assertIn("TOO_MANY_FRAMES", result["issues"])
