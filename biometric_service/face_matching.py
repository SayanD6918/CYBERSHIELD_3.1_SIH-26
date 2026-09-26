from __future__ import annotations

from pathlib import Path
import hashlib
from typing import Any

import cv2
import numpy as np

from face_detection import FaceDetection, FaceModelError, YuNetDetector, DEFAULT_MODEL_PATH
from face_extraction import ExtractedFace, FaceQuality, select_single_face
from document_portrait import DocumentPortraitResult, extract_document_portrait

MODEL_NAME = "SFace face_recognition_sface_2021dec.onnx"
MODEL_VERSION = "2021dec"
DEFAULT_RECOGNITION_MODEL = Path(__file__).resolve().parent / "models" / "face_recognition_sface_2021dec.onnx"
SFACE_MODEL_SHA256 = "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79"
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
        try:
            digest = hashlib.sha256(self.model_path.read_bytes()).hexdigest()
        except OSError as exc:
            self._load_error = f"Could not read SFace model at {self.model_path}: {exc}"
            return
        if digest != SFACE_MODEL_SHA256:
            self._load_error = (
                f"SFace model SHA-256 mismatch at {self.model_path}: "
                f"expected {SFACE_MODEL_SHA256}, got {digest}"
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
        if feature.size == 0:
            raise FaceRecognitionError("SFace returned an empty embedding.")
        if not np.all(np.isfinite(feature)):
            raise FaceRecognitionError("SFace returned NaN or infinite embedding values.")
        norm = float(np.linalg.norm(feature))
        if not np.isfinite(norm) or norm <= 1e-12:
            raise FaceRecognitionError("SFace returned a zero or invalid embedding norm.")
        # Explicit L2 normalization keeps the comparison contract independent
        # of the model/runtime implementation details.
        embedding = feature / norm
        if not np.all(np.isfinite(embedding)):
            raise FaceRecognitionError("Normalized SFace embedding contains NaN or infinity.")
        return embedding

    def compare(self, document_embedding: np.ndarray, live_embedding: np.ndarray) -> float:
        # asarray() returns the caller's own buffer for a float32 input, so
        # normalising in place would quietly rewrite embeddings the caller
        # still needs (1:N matching and the evaluation harness both reuse one).
        a = np.array(document_embedding, dtype=np.float32).reshape(-1)
        b = np.array(live_embedding, dtype=np.float32).reshape(-1)
        if a.shape != b.shape or a.size == 0:
            raise FaceRecognitionError("Embedding dimensions do not match.")
        if not np.all(np.isfinite(a)) or not np.all(np.isfinite(b)):
            raise FaceRecognitionError("Cannot compare embeddings containing NaN or infinity.")
        a_norm = float(np.linalg.norm(a))
        b_norm = float(np.linalg.norm(b))
        if not np.isfinite(a_norm) or not np.isfinite(b_norm) or a_norm <= 1e-12 or b_norm <= 1e-12:
            raise FaceRecognitionError("Cannot compare zero or invalid embeddings.")
        a /= a_norm
        b /= b_norm
        similarity = float(np.dot(a, b))
        if not np.isfinite(similarity):
            raise FaceRecognitionError("Cosine similarity is not finite.")
        return float(np.clip(similarity, -1.0, 1.0))

    def classify(self, similarity: float, issues: list[str]) -> str:
        """Classify around the configured operating point without hiding uncertainty.

        The uncertainty band is symmetric around the threshold: scores at or
        above threshold + band are MATCH, scores at or below threshold - band
        are NO_MATCH, and the interval in between is UNCERTAIN.
        """
        if issues:
            return "UNCERTAIN"
        upper = self.match_threshold + self.uncertain_band
        lower = self.match_threshold - self.uncertain_band
        epsilon = 1e-9
        if similarity >= upper - epsilon:
            return "MATCH"
        if similarity <= lower + epsilon:
            return "NO_MATCH"
        return "UNCERTAIN"


def build_document_face(
    document: np.ndarray,
    portrait: DocumentPortraitResult,
) -> ExtractedFace:
    """Materialise the selected document portrait as the SFace input face."""
    if portrait.status != "selected" or portrait.selected is None:
        issue_text = ", ".join(portrait.issues) or "DOCUMENT_PORTRAIT_UNCERTAIN"
        raise FaceRecognitionError(f"Document portrait extraction is uncertain: {issue_text}")
    selected_candidate = portrait.selected_candidate
    quality = FaceQuality(
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
    )
    if quality.issues:
        raise FaceRecognitionError("DOCUMENT_FACE_QUALITY_INSUFFICIENT:" + ",".join(quality.issues))
    return ExtractedFace(document, portrait.selected, quality)


def build_live_face(image: np.ndarray, detector: YuNetDetector) -> ExtractedFace:
    """Detect exactly one usable live face; never silently substitute a frame."""
    detections = detector.detect(image)
    face = select_single_face(image, detections)
    if face is None:
        reason = "MULTIPLE_FACES" if len(detections) > 1 else "NO_FACE"
        raise FaceRecognitionError(f"LIVE_FACE_NOT_USABLE:{reason}")
    if face.quality.issues:
        raise FaceRecognitionError("LIVE_FACE_QUALITY_INSUFFICIENT:" + ",".join(face.quality.issues))
    return face


def prepare_face_pair(
    detector: YuNetDetector,
    recognizer: FaceRecognizer,
    document: np.ndarray,
    live: np.ndarray,
    portrait: DocumentPortraitResult | None = None,
    document_type: str = "unknown",
) -> tuple[ExtractedFace, ExtractedFace, np.ndarray, np.ndarray]:
    portrait = portrait or extract_document_portrait(document, detector, document_type=document_type)
    doc_face = build_document_face(document, portrait)
    live_face = build_live_face(live, detector)
    doc_embedding = recognizer.embedding(doc_face.image, doc_face.detection)
    live_embedding = recognizer.embedding(live_face.image, live_face.detection)
    return doc_face, live_face, doc_embedding, live_embedding
