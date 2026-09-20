from __future__ import annotations

from pathlib import Path
from typing import Any

import cv2
import numpy as np

from face_detection import FaceDetection, FaceModelError, YuNetDetector, DEFAULT_MODEL_PATH
from face_extraction import ExtractedFace, FaceQuality, select_single_face
from document_portrait import DocumentPortraitResult, extract_document_portrait

MODEL_NAME = "SFace face_recognition_sface_2021dec.onnx"
MODEL_VERSION = "2021dec"
DEFAULT_RECOGNITION_MODEL = Path(__file__).resolve().parent / "models" / "face_recognition_sface_2021dec.onnx"
DEFAULT_MATCH_THRESHOLD = 0.363
DEFAULT_UNCERTAIN_BAND = 0.05


class FaceRecognitionError(RuntimeError):
    """Raised when the face recognition model cannot be loaded or used."""


class FaceRecognizer:
    def __init__(
        self,
        model_path: str | Path = DEFAULT_RECOGNITION_MODEL,
        match_threshold: float = DEFAULT_MATCH_THRESHOLD,
        uncertain_band: float = DEFAULT_UNCERTAIN_BAND,
    ) -> None:
        self.model_path = Path(model_path)
        self.match_threshold = match_threshold
        self.uncertain_band = max(0.0, uncertain_band)
        self._model: Any | None = None
        self._load_error: str | None = None
        self._load()

    @property
    def loaded(self) -> bool:
        return self._model is not None

    @property
    def load_error(self) -> str | None:
        return self._load_error

    def _load(self) -> None:
        if not self.model_path.exists():
            self._load_error = (
                f"SFace model not found at {self.model_path}. "
                "Download face_recognition_sface_2021dec.onnx and set "
                "SFACE_MODEL_PATH or place it under biometric_service/models/."
            )
            return
        if not hasattr(cv2, "FaceRecognizerSF_create"):
            self._load_error = "Installed OpenCV does not provide FaceRecognizerSF_create."
            return
        try:
            self._model = cv2.FaceRecognizerSF_create(str(self.model_path), "")
        except Exception as exc:
            self._load_error = f"{type(exc).__name__}: {exc}"

    def embedding(self, image: np.ndarray, detection: FaceDetection) -> np.ndarray:
        if self._model is None:
            raise FaceRecognitionError(self._load_error or "SFace is unavailable.")
        aligned = self._model.alignCrop(image, detection.as_detection_row())
        feature = np.asarray(self._model.feature(aligned), dtype=np.float32).reshape(-1)
        norm = float(np.linalg.norm(feature))
        if norm <= 1e-12:
            raise FaceRecognitionError("SFace returned a zero-length embedding.")
        # Explicit L2 normalization keeps the comparison contract independent
        # of the model/runtime implementation details.
        return feature / norm

    def compare(self, document_embedding: np.ndarray, live_embedding: np.ndarray) -> float:
        # asarray() returns the caller's own buffer for a float32 input, so
        # normalising in place would quietly rewrite embeddings the caller
        # still needs (1:N matching and the evaluation harness both reuse one).
        a = np.array(document_embedding, dtype=np.float32).reshape(-1)
        b = np.array(live_embedding, dtype=np.float32).reshape(-1)
        if a.shape != b.shape or a.size == 0:
            raise FaceRecognitionError("Embedding dimensions do not match.")
        a /= max(float(np.linalg.norm(a)), 1e-12)
        b /= max(float(np.linalg.norm(b)), 1e-12)
        return float(np.clip(np.dot(a, b), -1.0, 1.0))

    def classify(self, similarity: float, issues: list[str]) -> str:
        if issues:
            return "UNCERTAIN"
        if similarity >= self.match_threshold:
            return "MATCH"
        if similarity >= self.match_threshold - self.uncertain_band:
            return "UNCERTAIN"
        return "NO_MATCH"


def prepare_face_pair(
    detector: YuNetDetector,
    recognizer: FaceRecognizer,
    document: np.ndarray,
    live: np.ndarray,
    portrait: DocumentPortraitResult | None = None,
) -> tuple[ExtractedFace, ExtractedFace, np.ndarray, np.ndarray]:
    portrait = portrait or extract_document_portrait(document, detector)
    if portrait.status != "selected" or portrait.selected is None:
        issue_text = ", ".join(portrait.issues) or "DOCUMENT_PORTRAIT_UNCERTAIN"
        raise FaceRecognitionError(f"Document portrait extraction is uncertain: {issue_text}")

    live_detections = detector.detect(live)
    live_face = select_single_face(live, live_detections)
    if live_face is None:
        raise FaceRecognitionError("A single unambiguous live face is required.")

    # The document embedding comes from the selected portrait bounding box.
    # Liveness is deliberately untouched by this document-portrait pass.
    selected_candidate = portrait.selected_candidate
    doc_face = ExtractedFace(
        image=document,
        detection=portrait.selected,
        quality=FaceQuality(
            face_count=portrait.face_count,
            box_width=portrait.selected.width,
            box_height=portrait.selected.height,
            relative_size=portrait.selected.area / float(max(1, document.shape[0] * document.shape[1])),
            detection_confidence=portrait.selected.confidence,
            sharpness=float(selected_candidate.quality.get("sharpness") or 0.0) if selected_candidate else None,
            brightness=float(selected_candidate.quality.get("brightness") or 0.0) if selected_candidate else None,
            pose=None,
            alignment_quality="supported",
            issues=portrait.issues,
        ),
    )
    doc_embedding = recognizer.embedding(document, portrait.selected)
    live_embedding = recognizer.embedding(live, live_face.detection)
    return doc_face, live_face, doc_embedding, live_embedding
