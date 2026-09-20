"""CyberShield biometric service.

Three independent signals, deliberately kept apart:

  /api/liveness         passive presentation-attack detection over a burst
  /api/active-challenge a machine-verified head movement
  /api/face-match       document portrait vs live face, by embedding

None of them is sufficient on its own. The frontend's risk engine fuses them
with the document, MRZ, identity-provider and watchlist evidence.
"""

from __future__ import annotations

import base64
import binascii
import os
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from active_challenge import CHALLENGES, verify_active_challenge
from document_portrait import extract_document_portrait
from face_detection import DEFAULT_MODEL_PATH, FaceModelError, YuNetDetector
from face_matching import (
    DEFAULT_MATCH_THRESHOLD,
    DEFAULT_RECOGNITION_MODEL,
    DEFAULT_UNCERTAIN_BAND,
    FaceRecognitionError,
    FaceRecognizer,
    prepare_face_pair,
)
from frame_selection import select_probe_frame
from liveness import FEATURE_VERSION, analyze_sequence, load_pad_model

ROOT = Path(__file__).resolve().parent
MODEL_PATH = Path(os.getenv("LIVENESS_MODEL_PATH", ROOT / "models" / "pad_model.pkl"))
YUNET_MODEL_PATH = Path(os.getenv("YUNET_MODEL_PATH", DEFAULT_MODEL_PATH))
SFACE_MODEL_PATH = Path(os.getenv("SFACE_MODEL_PATH", DEFAULT_RECOGNITION_MODEL))
FACE_MATCH_THRESHOLD = float(os.getenv("FACE_MATCH_THRESHOLD", DEFAULT_MATCH_THRESHOLD))
FACE_UNCERTAIN_BAND = float(os.getenv("FACE_UNCERTAIN_BAND", DEFAULT_UNCERTAIN_BAND))

MAX_LIVENESS_FRAMES = 32
MAX_CHALLENGE_FRAMES = 48
MAX_PROBE_FRAMES = 24
MAX_IMAGE_BYTES = 8 * 1024 * 1024

app = FastAPI(title="CyberShield Biometric Service", version="3.1.8")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv(
        "CORS_ORIGINS", "http://localhost:8080,http://127.0.0.1:8080"
    ).split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

classifier, pad_model_info = load_pad_model(MODEL_PATH)
model_error = "; ".join(pad_model_info.issues) if pad_model_info.issues else None

face_detector = YuNetDetector(YUNET_MODEL_PATH)
face_recognizer = FaceRecognizer(SFACE_MODEL_PATH, FACE_MATCH_THRESHOLD, FACE_UNCERTAIN_BAND)


class ImageRequest(BaseModel):
    image_data_url: str | None = None
    frames_data_urls: list[str] | None = None

    def get_frames(self) -> list[str]:
        frames = list(self.frames_data_urls or [])
        if not frames and self.image_data_url:
            frames = [self.image_data_url]
        return frames


class FaceMatchRequest(BaseModel):
    document_image_data_url: str
    # Preferred: the capture burst, so the service can pick the most frontal
    # frame itself. `live_image_data_url` remains accepted for callers that
    # only have a single still.
    live_frames_data_urls: list[str] | None = None
    live_image_data_url: str | None = None

    def get_live_frames(self) -> list[str]:
        frames = list(self.live_frames_data_urls or [])
        if not frames and self.live_image_data_url:
            frames = [self.live_image_data_url]
        return frames


class ActiveChallengeRequest(BaseModel):
    challenge: str
    frames_data_urls: list[str]


class ImageDecodeError(ValueError):
    """A supplied data URL could not be turned into an image."""


def decode_data_url(value: str) -> np.ndarray:
    payload = value.split(",", 1)[1] if "," in value else value
    try:
        raw = base64.b64decode(payload, validate=False)
    except (binascii.Error, ValueError) as exc:
        raise ImageDecodeError(f"Malformed base64 payload: {exc}") from exc

    if not raw:
        raise ImageDecodeError("Empty image payload")
    if len(raw) > MAX_IMAGE_BYTES:
        raise ImageDecodeError(f"Image exceeds {MAX_IMAGE_BYTES} bytes")

    try:
        image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    except cv2.error as exc:
        raise ImageDecodeError(f"Image could not be decoded: {exc}") from exc
    if image is None:
        raise ImageDecodeError("Payload is not a decodable image")
    return image


def decode_frames(values: list[str], limit: int) -> list[np.ndarray]:
    return [decode_data_url(value) for value in values[:limit]]


def detect_boxes(frames: list[np.ndarray]) -> tuple[list[Any], list[str]]:
    """One box slot per frame, always.

    Returning a shorter list than the frame list used to disarm the guard
    that forces UNCERTAIN when a frame has no single face, so the slots and
    the frames are now kept strictly parallel.
    """
    boxes: list[Any] = []
    issues: list[str] = []

    if not face_detector.loaded:
        detail = face_detector.load_error or "face detector unavailable"
        return [None] * len(frames), ["FACE_DETECTOR_MODEL_UNAVAILABLE", detail]

    for frame in frames:
        try:
            detections = face_detector.detect(frame)
        except FaceModelError as exc:
            boxes.append(None)
            issues.append(f"FACE_DETECTOR_ERROR:{exc}")
            continue

        if len(detections) == 1:
            boxes.append(detections[0].box)
        else:
            boxes.append(None)
            issues.append("NO_FACE_IN_FRAME" if not detections else "MULTIPLE_FACES_IN_FRAME")

    return boxes, issues


def liveness_unavailable(issues: list[str]) -> dict[str, Any]:
    return {
        "liveness_status": "UNCERTAIN",
        "confidence": 0.0,
        "model": pad_model_info.model_name,
        "model_version": pad_model_info.model_version,
        "feature_version": FEATURE_VERSION,
        "model_loaded": pad_model_info.loaded,
        "model_valid": pad_model_info.valid,
        "calibrated": pad_model_info.calibrated,
        "evidence": {},
        "quality": {},
        "issues": list(dict.fromkeys(issues)),
        "face_count_per_frame": [],
        "active_challenge": {"status": "NOT_RUN"},
    }


def challenge_failure(challenge: str, reason: str, evidence: dict[str, Any] | None = None):
    return {
        "requested_action": challenge,
        "initial_pose": None,
        "observed_pose": None,
        "movement_detected": False,
        "challenge_status": "FAILED",
        "confidence": 0.0,
        "evidence": evidence or {},
        "failure_reason": reason,
    }


def face_match_base() -> dict[str, Any]:
    return {
        "threshold": FACE_MATCH_THRESHOLD,
        "uncertain_band": FACE_UNCERTAIN_BAND,
        "metric": "cosine_similarity",
        "model": "SFace",
        "model_version": "2021dec",
        "calibrated": False,
    }


def face_match_unavailable(issues: list[str], **extra: Any) -> dict[str, Any]:
    return {
        **face_match_base(),
        "face_match_status": "UNCERTAIN",
        "similarity_score": None,
        "distance": None,
        "issues": [issue for issue in dict.fromkeys(issues) if issue],
        "matcher": "sface-embedding",
        **extra,
    }


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "cybershield-biometric",
        "liveness_model_loaded": classifier is not None,
        "liveness_model_artifact_present": MODEL_PATH.exists(),
        "liveness_model_valid": pad_model_info.valid,
        "liveness_model_error": model_error,
        "liveness_model": pad_model_info.model_name,
        "liveness_model_version": pad_model_info.model_version,
        "liveness_feature_version": pad_model_info.feature_version,
        "liveness_expected_feature_version": FEATURE_VERSION,
        "liveness_class_mapping": pad_model_info.class_mapping,
        "liveness_calibrated": pad_model_info.calibrated,
        "face_detector_loaded": face_detector.loaded,
        "face_detector_error": face_detector.load_error,
        "face_detector_model": "YuNet/face_detection_yunet_2023mar",
        "face_recognizer_loaded": face_recognizer.loaded,
        "face_recognizer_error": face_recognizer.load_error,
        "face_recognizer_model": "SFace/face_recognition_sface_2021dec",
        "face_match_threshold": FACE_MATCH_THRESHOLD,
        "face_uncertain_band": FACE_UNCERTAIN_BAND,
        "face_match_calibrated": False,
    }


@app.post("/api/liveness")
def liveness(request: ImageRequest):
    encoded = request.get_frames()
    if not encoded:
        return liveness_unavailable(["NO_FRAMES_PROVIDED"])

    try:
        frames = decode_frames(encoded, MAX_LIVENESS_FRAMES)
    except ImageDecodeError as exc:
        return liveness_unavailable(["INVALID_IMAGE_DATA", str(exc)])

    boxes, detector_issues = detect_boxes(frames)
    result = analyze_sequence(frames, boxes, classifier, pad_model_info)
    result["issues"] = list(dict.fromkeys([*result.get("issues", []), *detector_issues]))
    result["face_count_per_frame"] = [1 if box is not None else 0 for box in boxes]

    # A burst in which any frame lacked a single unambiguous face cannot
    # support a confident liveness verdict, whatever the classifier said.
    if any(box is None for box in boxes):
        result["liveness_status"] = "UNCERTAIN"
        result["confidence"] = min(float(result.get("confidence", 0.0)), 0.5)

    return result


@app.post("/api/active-challenge")
def active_challenge(request: ActiveChallengeRequest):
    challenge = request.challenge.upper().strip()

    if challenge not in CHALLENGES:
        return challenge_failure(challenge, "UNKNOWN_CHALLENGE")
    if not request.frames_data_urls:
        return challenge_failure(challenge, "NO_FRAMES_PROVIDED", {"frames_received": 0})
    if not face_detector.loaded:
        return challenge_failure(
            challenge,
            "FACE_DETECTOR_MODEL_UNAVAILABLE",
            {"pose_method": "YuNet-5-landmark + solvePnP(SQPNP)"},
        )

    try:
        frames = decode_frames(request.frames_data_urls, MAX_CHALLENGE_FRAMES)
    except ImageDecodeError as exc:
        return challenge_failure(challenge, f"INVALID_IMAGE_DATA:{exc}")

    return verify_active_challenge(challenge, frames, face_detector)


@app.post("/api/face-match")
def face_match(request: FaceMatchRequest):
    encoded_live = request.get_live_frames()
    if not encoded_live:
        return face_match_unavailable(["NO_LIVE_FRAMES_PROVIDED"])

    try:
        document = decode_data_url(request.document_image_data_url)
        live_frames = decode_frames(encoded_live, MAX_PROBE_FRAMES)
    except ImageDecodeError as exc:
        return face_match_unavailable(["INVALID_IMAGE_DATA", str(exc)])

    if not face_detector.loaded:
        return face_match_unavailable(
            ["FACE_DETECTOR_MODEL_UNAVAILABLE", face_detector.load_error],
            document_portrait={
                "status": "uncertain",
                "face_count": 0,
                "selected_face": None,
                "layout": "unavailable",
                "orientation": None,
                "extraction_method": "document-layout + multi-orientation face-detection",
                "confidence": None,
                "issues": ["FACE_DETECTOR_MODEL_UNAVAILABLE", face_detector.load_error],
                "candidates": [],
            },
        )

    try:
        portrait = extract_document_portrait(document, face_detector)
    except FaceModelError as exc:
        return face_match_unavailable(
            ["DOCUMENT_PORTRAIT_DETECTOR_UNAVAILABLE", str(exc)],
            document_portrait={
                "status": "uncertain",
                "face_count": 0,
                "confidence": None,
                "issues": [str(exc)],
            },
        )

    portrait_evidence = {
        "status": portrait.status,
        "face_count": portrait.face_count,
        "selected_face": (
            {
                "bounding_box": [round(v, 2) for v in portrait.selected.box],
                "detection_confidence": round(portrait.selected.confidence, 6),
                "score": round(portrait.selected_score or 0.0, 6),
            }
            if portrait.selected is not None
            else None
        ),
        "layout": portrait.layout.kind,
        "orientation": portrait.layout.orientation,
        "extraction_method": portrait.extraction_method,
        "confidence": None if portrait.confidence is None else round(portrait.confidence, 6),
        "issues": list(portrait.issues),
        "candidates": [
            {
                "bounding_box": [round(v, 2) for v in candidate.detection.box],
                "score": round(candidate.score, 6),
                "region": candidate.region,
                "in_expected_region": candidate.in_expected_region,
                "quality": candidate.quality,
                "issues": list(candidate.issues),
            }
            for candidate in portrait.candidates
        ],
    }

    if portrait.status != "selected" or portrait.selected is None:
        return face_match_unavailable(
            ["DOCUMENT_PORTRAIT_UNCERTAIN", *portrait.issues],
            document_portrait=portrait_evidence,
        )

    if not face_recognizer.loaded:
        return face_match_unavailable(
            ["FACE_RECOGNITION_MODEL_UNAVAILABLE", face_recognizer.load_error],
            document_portrait=portrait_evidence,
        )

    # Recognise from the most frontal frame in the burst, not from whichever
    # frame happened to arrive last.
    selection = select_probe_frame(live_frames, face_detector)
    if selection.probe is None:
        return face_match_unavailable(
            ["NO_USABLE_LIVE_FACE", *selection.issues],
            document_portrait=portrait_evidence,
            probe_frame=selection.as_evidence(),
        )

    try:
        doc_face, live_face, doc_embedding, live_embedding = prepare_face_pair(
            face_detector,
            face_recognizer,
            document,
            selection.probe.image,
            portrait=portrait,
        )
    except (FaceModelError, FaceRecognitionError) as exc:
        return face_match_unavailable(
            [str(exc)],
            document_portrait=portrait_evidence,
            probe_frame=selection.as_evidence(),
        )

    issues = list(dict.fromkeys([*doc_face.quality.issues, *live_face.quality.issues]))
    similarity = face_recognizer.compare(doc_embedding, live_embedding)
    status = face_recognizer.classify(similarity, issues)

    return {
        **face_match_base(),
        "face_match_status": status,
        "similarity_score": round(similarity, 6),
        "distance": round(1.0 - similarity, 6),
        "issues": issues,
        "matcher": "sface-embedding",
        "document_portrait": portrait_evidence,
        "probe_frame": selection.as_evidence(),
        "document_face": {
            "face_count": doc_face.quality.face_count,
            "bounding_box": [round(v, 2) for v in doc_face.detection.box],
            "relative_size": round(doc_face.quality.relative_size or 0.0, 6),
            "detection_confidence": round(doc_face.quality.detection_confidence or 0.0, 6),
            "sharpness": round(doc_face.quality.sharpness or 0.0, 3),
            "brightness": round(doc_face.quality.brightness or 0.0, 3),
            "alignment_quality": doc_face.quality.alignment_quality,
        },
        "live_face": {
            "face_count": live_face.quality.face_count,
            "bounding_box": [round(v, 2) for v in live_face.detection.box],
            "relative_size": round(live_face.quality.relative_size or 0.0, 6),
            "detection_confidence": round(live_face.quality.detection_confidence or 0.0, 6),
            "sharpness": round(live_face.quality.sharpness or 0.0, 3),
            "brightness": round(live_face.quality.brightness or 0.0, 3),
            "alignment_quality": live_face.quality.alignment_quality,
        },
    }
