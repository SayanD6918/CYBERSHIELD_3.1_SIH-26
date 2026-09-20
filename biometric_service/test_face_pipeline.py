from __future__ import annotations

import unittest
from pathlib import Path
import sys

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from face_detection import FaceDetection, FaceModelError, YuNetDetector
from face_extraction import select_single_face
from document_portrait import extract_document_portrait, classify_document_layout
from face_matching import FaceRecognizer, prepare_face_pair
from frame_selection import select_probe_frame
from test_head_pose_geometry import render_landmarks


class FakeDocumentDetector:
    """Deterministic detector used to test extraction policy without model files."""

    def __init__(self, detections_by_orientation):
        self.detections_by_orientation = detections_by_orientation

    def detect(self, image):
        # The extractor tries four orientations. Test fixtures identify the
        # orientation by image dimensions.
        key = (image.shape[1], image.shape[0])
        return list(self.detections_by_orientation.get(key, []))


def landmarks_for(box, yaw_offset=0.0):
    """Plausible five landmarks inside a box, optionally skewed off-axis."""
    x, y, w, h = box
    return np.array(
        [
            [x + 0.30 * w + yaw_offset, y + 0.38 * h],
            [x + 0.70 * w + yaw_offset, y + 0.38 * h],
            [x + 0.50 * w + yaw_offset, y + 0.55 * h],
            [x + 0.35 * w + yaw_offset, y + 0.75 * h],
            [x + 0.65 * w + yaw_offset, y + 0.75 * h],
        ],
        dtype=np.float32,
    )


def fake_face(box, confidence=0.98, yaw_offset=0.0):
    return FaceDetection(box, landmarks_for(box, yaw_offset), confidence)


class FacePipelineTests(unittest.TestCase):
    def test_missing_models_are_explicit(self):
        detector = YuNetDetector("/definitely/missing/yunet.onnx")
        recognizer = FaceRecognizer("/definitely/missing/sface.onnx")
        self.assertFalse(detector.loaded)
        self.assertFalse(recognizer.loaded)
        self.assertIn("model not found", detector.load_error.lower())
        self.assertIn("model not found", recognizer.load_error.lower())

    def test_no_face_is_not_silently_selected(self):
        image = np.zeros((240, 320, 3), dtype=np.uint8)
        self.assertIsNone(select_single_face(image, []))

    def test_multiple_faces_are_ambiguous(self):
        image = np.zeros((240, 320, 3), dtype=np.uint8)
        detections = [
            FaceDetection((10, 10, 80, 80), np.zeros((5, 2), dtype=np.float32), 0.95),
            FaceDetection((120, 10, 80, 80), np.zeros((5, 2), dtype=np.float32), 0.95),
        ]
        self.assertIsNone(select_single_face(image, detections))

    def test_document_portrait_no_face_is_explicitly_uncertain(self):
        image = np.random.default_rng(7).integers(0, 255, (600, 900, 3), dtype=np.uint8)
        result = extract_document_portrait(image, FakeDocumentDetector({}))
        self.assertEqual(result.status, "uncertain")
        self.assertEqual(result.face_count, 0)
        self.assertIn("NO_FACE", result.issues)

    def test_document_portrait_prefers_expected_region_not_largest_face(self):
        image = np.random.default_rng(7).integers(0, 255, (600, 900, 3), dtype=np.uint8)
        # Larger face on the left; smaller face in the expected right portrait region.
        detections = [
            fake_face((70, 470, 260, 100)),
            fake_face((610, 160, 120, 150)),
        ]
        result = extract_document_portrait(image, FakeDocumentDetector({(900, 600): detections}))
        self.assertEqual(result.status, "selected")
        self.assertAlmostEqual(result.selected.box[0], 610, delta=1)
        self.assertIn("right_portrait", result.candidates[1].region)

    def test_document_portrait_multiple_plausible_faces_is_uncertain(self):
        image = np.random.default_rng(7).integers(0, 255, (600, 900, 3), dtype=np.uint8)
        detections = [fake_face((560, 150, 130, 160)), fake_face((690, 160, 110, 150))]
        result = extract_document_portrait(image, FakeDocumentDetector({(900, 600): detections}))
        self.assertEqual(result.status, "uncertain")
        self.assertIn("MULTIPLE_PLAUSIBLE_FACES", result.issues)

    def test_document_portrait_small_face_is_uncertain(self):
        image = np.random.default_rng(7).integers(0, 255, (600, 900, 3), dtype=np.uint8)
        result = extract_document_portrait(image, FakeDocumentDetector({(900, 600): [fake_face((650, 200, 45, 45))]}))
        self.assertEqual(result.status, "uncertain")
        self.assertIn("FACE_TOO_SMALL", result.issues)

    def test_document_portrait_poor_crop_is_uncertain(self):
        image = np.random.default_rng(7).integers(0, 255, (600, 900, 3), dtype=np.uint8)
        result = extract_document_portrait(image, FakeDocumentDetector({(900, 600): [fake_face((870, 160, 40, 120))]}))
        self.assertEqual(result.status, "uncertain")
        self.assertIn("POOR_CROP_MARGIN", result.issues)

    def test_document_portrait_rotated_image_is_normalized(self):
        # Original image is portrait because the document was rotated 90 degrees.
        image = np.random.default_rng(8).integers(0, 255, (900, 600, 3), dtype=np.uint8)
        # After clockwise rotation it becomes 900x600; the face is on the right.
        rotated_face = fake_face((620, 160, 120, 150))
        result = extract_document_portrait(image, FakeDocumentDetector({(900, 600): [rotated_face]}))
        self.assertEqual(result.status, "selected")
        self.assertEqual(result.layout.orientation, 90)
        self.assertEqual(result.selected.box[2], 150)
        self.assertEqual(result.selected.box[3], 120)

    def test_unknown_layout_never_uses_arbitrary_face(self):
        image = np.random.default_rng(9).integers(0, 255, (700, 700, 3), dtype=np.uint8)
        result = extract_document_portrait(image, FakeDocumentDetector({(700, 700): [fake_face((280, 200, 150, 180))]}))
        self.assertEqual(result.status, "uncertain")
        self.assertIn("UNUSUAL_DOCUMENT_LAYOUT", result.issues)
        self.assertIn("FACE_OUTSIDE_EXPECTED_PORTRAIT_REGION", result.issues)

    def test_passport_style_layout_is_detected_when_mrz_bands_are_present(self):
        image = np.full((600, 900, 3), 220, dtype=np.uint8)
        image[455:470, 80:820] = 40
        image[480:495, 80:820] = 40
        layout = classify_document_layout(image)
        self.assertEqual(layout.kind, "passport_style")

    def test_document_portrait_flows_into_embedding_pipeline(self):
        document = np.random.default_rng(10).integers(0, 255, (600, 900, 3), dtype=np.uint8)
        live = np.random.default_rng(11).integers(0, 255, (480, 640, 3), dtype=np.uint8)
        detector = FakeDocumentDetector({
            (900, 600): [fake_face((80, 470, 260, 100)), fake_face((620, 160, 120, 150))],
            (640, 480): [fake_face((250, 100, 140, 180))],
        })

        class FakeRecognizer:
            def embedding(self, image, detection):
                return np.array([detection.box[0], detection.box[2], 1.0], dtype=np.float32)

        doc_face, live_face, doc_embedding, live_embedding = prepare_face_pair(
            detector, FakeRecognizer(), document, live
        )
        self.assertAlmostEqual(doc_face.detection.box[0], 620, delta=1)
        self.assertAlmostEqual(live_face.detection.box[0], 250, delta=1)
        self.assertAlmostEqual(float(doc_embedding[0]), 620, delta=1)
        self.assertAlmostEqual(float(live_embedding[0]), 250, delta=1)

    def test_embeddings_are_compared_as_cosine_similarity(self):
        recognizer = FaceRecognizer("/definitely/missing/sface.onnx")
        a = np.array([3.0, 4.0], dtype=np.float32)
        b = np.array([3.0, 4.0], dtype=np.float32)
        self.assertAlmostEqual(recognizer.compare(a, b), 1.0, places=6)

    def test_match_states_are_explicit(self):
        recognizer = FaceRecognizer("/definitely/missing/sface.onnx", match_threshold=0.8, uncertain_band=0.05)
        self.assertEqual(recognizer.classify(0.90, []), "MATCH")
        self.assertEqual(recognizer.classify(0.78, []), "UNCERTAIN")
        self.assertEqual(recognizer.classify(0.70, []), "NO_MATCH")
        self.assertEqual(recognizer.classify(0.95, ["BLURRY_FACE"]), "UNCERTAIN")


class AlignmentRowTests(unittest.TestCase):
    """SFace alignment is the pipeline's documented behaviour, so the row
    handed to alignCrop must actually carry the five landmarks. Passing a
    bare four-value box made OpenCV read past the array and build the warp
    from whatever followed it in memory."""

    def test_detection_row_has_fifteen_values(self):
        detection = fake_face((10.0, 20.0, 100.0, 120.0))
        row = detection.as_detection_row()
        self.assertEqual(row.shape, (1, 15))

    def test_detection_row_layout_matches_opencv(self):
        detection = fake_face((10.0, 20.0, 100.0, 120.0), confidence=0.91)
        row = detection.as_detection_row()[0]
        np.testing.assert_allclose(row[:4], np.asarray(detection.box), rtol=1e-6)
        np.testing.assert_allclose(row[4:14], detection.landmarks.reshape(-1), rtol=1e-6)
        self.assertAlmostEqual(float(row[14]), 0.91, places=5)

    def test_malformed_landmarks_are_rejected_loudly(self):
        broken = FaceDetection((0.0, 0.0, 10.0, 10.0), np.zeros((3, 2), np.float32), 0.9)
        with self.assertRaises(FaceModelError):
            broken.as_detection_row()

    def test_recognizer_passes_the_full_row_to_align_crop(self):
        seen = {}

        class CapturingSFace:
            def alignCrop(self, image, face_row):
                seen["row"] = np.asarray(face_row)
                return np.zeros((112, 112, 3), np.uint8)

            def feature(self, aligned):
                return np.ones((1, 128), np.float32)

        recognizer = FaceRecognizer("/definitely/missing/sface.onnx")
        recognizer._model = CapturingSFace()
        detection = fake_face((10.0, 20.0, 100.0, 120.0))
        recognizer.embedding(np.zeros((480, 640, 3), np.uint8), detection)
        self.assertEqual(seen["row"].reshape(1, -1).shape[1], 15)


class CompareIsSideEffectFreeTests(unittest.TestCase):
    def test_compare_does_not_normalise_the_callers_arrays(self):
        recognizer = FaceRecognizer("/definitely/missing/sface.onnx")
        a = np.array([3.0, 4.0], dtype=np.float32)
        b = np.array([0.0, 5.0], dtype=np.float32)
        before_a, before_b = a.copy(), b.copy()
        recognizer.compare(a, b)
        np.testing.assert_array_equal(a, before_a)
        np.testing.assert_array_equal(b, before_b)

    def test_repeated_comparison_is_stable(self):
        recognizer = FaceRecognizer("/definitely/missing/sface.onnx")
        a = np.array([3.0, 4.0], dtype=np.float32)
        b = np.array([0.0, 5.0], dtype=np.float32)
        first = recognizer.compare(a, b)
        self.assertAlmostEqual(first, recognizer.compare(a, b), places=9)


class SelectedCandidateTests(unittest.TestCase):
    def test_portrait_result_names_its_own_selected_candidate(self):
        image = np.random.default_rng(7).integers(0, 255, (600, 900, 3), dtype=np.uint8)
        detections = [fake_face((70, 470, 260, 100)), fake_face((610, 160, 120, 150))]
        result = extract_document_portrait(image, FakeDocumentDetector({(900, 600): detections}))
        self.assertEqual(result.status, "selected")
        self.assertIsNotNone(result.selected_candidate)
        self.assertEqual(result.selected_candidate.region, "right_portrait")

    def test_rotated_document_reports_the_right_candidate_quality(self):
        """Candidates live in the winning orientation's coordinates while
        `selected` is mapped back, so recovering the candidate by comparing
        boxes picked the wrong one for any rotated document."""
        image = np.random.default_rng(8).integers(0, 255, (900, 600, 3), dtype=np.uint8)
        rotated_face = fake_face((620, 160, 120, 150))
        result = extract_document_portrait(
            image, FakeDocumentDetector({(900, 600): [rotated_face]})
        )
        self.assertEqual(result.status, "selected")
        self.assertEqual(result.layout.orientation, 90)
        self.assertIs(result.selected_candidate, result.candidates[0])


class ProbeFrameSelectionTests(unittest.TestCase):
    """The recognition probe must be chosen by pose and quality, not by
    arriving last - the final frame of a TURN challenge is the moment the
    head is held turned away."""

    @staticmethod
    def turned_face(turn_degrees):
        """A detection whose landmarks really encode the given head turn."""
        landmarks = render_landmarks(turn_degrees)
        x0, y0 = landmarks.min(axis=0)
        x1, y1 = landmarks.max(axis=0)
        margin = 0.4 * (x1 - x0)
        box = (
            float(x0 - margin),
            float(y0 - margin),
            float((x1 - x0) + 2 * margin),
            float((y1 - y0) + 2 * margin),
        )
        return FaceDetection(box, landmarks, 0.98)

    class BurstDetector:
        def __init__(self, detections_by_index):
            self.detections_by_index = detections_by_index
            self.calls = 0

        def detect(self, image):
            index = self.calls
            self.calls += 1
            return list(self.detections_by_index.get(index, []))

    def burst(self, count=6):
        return [np.full((480, 640, 3), 120, np.uint8) for _ in range(count)]

    def test_frontal_frame_wins_over_the_last_frame(self):
        frames = self.burst(4)
        detector = self.BurstDetector({
            0: [self.turned_face(0.0)],
            1: [self.turned_face(5.0)],
            2: [self.turned_face(28.0)],
            3: [self.turned_face(34.0)],  # the held turn, i.e. the last frame
        })
        selection = select_probe_frame(frames, detector)
        self.assertIsNotNone(selection.probe)
        self.assertLess(selection.probe.index, 2)
        self.assertLess(abs(selection.probe.yaw), 15.0)

    def test_frames_without_a_single_face_are_skipped_and_counted(self):
        frames = self.burst(4)
        detector = self.BurstDetector({
            0: [],
            1: [fake_face((250, 150, 160, 190)), fake_face((50, 150, 160, 190))],
            2: [fake_face((250, 150, 160, 190))],
            3: [],
        })
        selection = select_probe_frame(frames, detector)
        self.assertEqual(selection.probe.index, 2)
        self.assertEqual(selection.rejected["no_face"], 2)
        self.assertEqual(selection.rejected["multiple_faces"], 1)
        self.assertIn("MULTIPLE_FACES_IN_SOME_FRAMES", selection.issues)

    def test_a_burst_with_no_usable_frame_reports_it(self):
        frames = self.burst(3)
        selection = select_probe_frame(frames, self.BurstDetector({}))
        self.assertIsNone(selection.probe)
        self.assertIn("NO_USABLE_PROBE_FRAME", selection.issues)

    def test_selection_evidence_is_serialisable(self):
        frames = self.burst(2)
        detector = self.BurstDetector({0: [fake_face((250, 150, 160, 190))]})
        evidence = select_probe_frame(frames, detector).as_evidence()
        self.assertEqual(evidence["frames_considered"], 2)
        self.assertIn("selected_frame_index", evidence)


if __name__ == "__main__":
    unittest.main()
