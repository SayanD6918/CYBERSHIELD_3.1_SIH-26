from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

MODEL_NAME = "YuNet face_detection_yunet_2023mar.onnx"
DEFAULT_MODEL_PATH = Path(__file__).resolve().parent / "models" / "face_detection_yunet_2023mar.onnx"


class FaceModelError(RuntimeError):
    """Raised when the configured face detector cannot be loaded or used."""


@dataclass(frozen=True)
class FaceDetection:
    box: tuple[float, float, float, float]
    landmarks: np.ndarray
    confidence: float

    @property
    def width(self) -> float:
        return self.box[2]

    @property
    def height(self) -> float:
        return self.box[3]

    @property
    def area(self) -> float:
        return max(0.0, self.width) * max(0.0, self.height)

    def as_detection_row(self) -> np.ndarray:
        """The 15-value row OpenCV's face APIs expect.

        SFace's alignCrop() reads the five alignment landmarks from columns
        4..13 of a detector row, so handing it a bare bounding box makes it
        read past the end of the array and build the warp from whatever
        happens to be in memory. Rebuilding the full row here keeps the
        landmark alignment the pipeline is documented to perform.
        """
        landmarks = np.asarray(self.landmarks, dtype=np.float32).reshape(-1)
        if landmarks.size != 10:
            raise FaceModelError(
                f"Expected five (x, y) landmarks, got {landmarks.size} values."
            )
        return np.concatenate(
            [
                np.asarray(self.box, dtype=np.float32),
                landmarks,
                np.asarray([self.confidence], dtype=np.float32),
            ]
        ).reshape(1, 15)


class YuNetDetector:
    def __init__(
        self,
        model_path: str | Path = DEFAULT_MODEL_PATH,
        confidence_threshold: float = 0.9,
        nms_threshold: float = 0.3,
        top_k: int = 5000,
    ) -> None:
        self.model_path = Path(model_path)
        self.confidence_threshold = confidence_threshold
        self.nms_threshold = nms_threshold
        self.top_k = top_k
        self._detector = None
        self._load_error: str | None = None
        self._load()

    @property
    def loaded(self) -> bool:
        return self._detector is not None

    @property
    def load_error(self) -> str | None:
        return self._load_error

    def _load(self) -> None:
        if not self.model_path.exists():
            self._load_error = (
                f"YuNet model not found at {self.model_path}. "
                "Download face_detection_yunet_2023mar.onnx and set YUNET_MODEL_PATH "
                "or place it under biometric_service/models/."
            )
            return
        if not hasattr(cv2, "FaceDetectorYN_create"):
            self._load_error = "Installed OpenCV does not provide FaceDetectorYN_create."
            return
        try:
            self._detector = cv2.FaceDetectorYN_create(
                str(self.model_path),
                "",
                (320, 320),
                self.confidence_threshold,
                self.nms_threshold,
                self.top_k,
            )
        except Exception as exc:
            self._load_error = f"{type(exc).__name__}: {exc}"

    def detect(self, image: np.ndarray) -> list[FaceDetection]:
        if self._detector is None:
            raise FaceModelError(self._load_error or "YuNet detector is unavailable.")
        if image is None or image.size == 0:
            return []

        self._detector.setInputSize((image.shape[1], image.shape[0]))
        _, faces = self._detector.detect(image)
        if faces is None:
            return []

        results: list[FaceDetection] = []
        for row in np.asarray(faces, dtype=np.float32):
            x, y, w, h = map(float, row[:4])
            landmarks = np.asarray(row[4:14], dtype=np.float32).reshape(5, 2)
            confidence = float(row[14])
            results.append(FaceDetection((x, y, w, h), landmarks, confidence))
        return results
