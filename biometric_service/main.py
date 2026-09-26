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
import hashlib
from pathlib import Path
from typing import Any
import re

import cv2
import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from active_challenge import CHALLENGES, CHALLENGE_SEQUENCE, verify_active_challenge_sequence
from document_portrait import extract_document_portrait
from face_detection import DEFAULT_MODEL_PATH, FaceModelError, YuNetDetector
from face_matching import (
    DEFAULT_MATCH_THRESHOLD,
    DEFAULT_RECOGNITION_MODEL,
    DEFAULT_UNCERTAIN_BAND,
    FaceRecognitionError,
    FaceRecognizer,
    build_document_face,
    build_live_face,
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
MAX_CHALLENGE_FRAMES = 96
MAX_REFERENCE_FRAMES = 24
MAX_CHALLENGE_STEP_FRAMES = 24
MAX_PROBE_FRAMES = 24
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_IMAGE_PIXELS = 25_000_000
MAX_REQUEST_BODY_BYTES = 64 * 1024 * 1024
ALLOWED_IMAGE_MIME = {"image/jpeg", "image/jpg", "image/png", "image/webp"}


def model_file_info(path: Path) -> dict[str, Any]:
    info: dict[str, Any] = {
        "path": str(path),
        "exists": path.is_file(),
        "sha256": None,
        "size_bytes": None,
    }
    if path.is_file():
        info["size_bytes"] = path.stat().st_size
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        info["sha256"] = digest.hexdigest()
    return info


def empty_live_diagnostics(frames_received: int = 0) -> dict[str, Any]:
    return {
        "frames_received": frames_received,
        "frames_with_face": 0,
        "frames_rejected": {"no_face": 0, "multiple_faces": 0, "detector_error": 0, "poor_quality": 0},
        "best_frame_index": None,
        "best_frame_quality": None,
        "live_face_detected": False,
    }

app = FastAPI(title="CyberShield Biometric Service", version="3.1.8")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv(
        "CORS_ORIGINS", "http://localhost:8080,http://127.0.0.1:8080"
    ).split(",") if origin.strip()],
    allow_credentials=False,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["Content-Type"],
)

if hasattr(app, "middleware"):
    @app.middleware("http")
    async def request_size_guard(request, call_next):
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                if int(content_length) > MAX_REQUEST_BODY_BYTES:
                    from fastapi.responses import JSONResponse
                    return JSONResponse({"detail": "REQUEST_BODY_TOO_LARGE"}, status_code=413)
            except ValueError:
                from fastapi.responses import JSONResponse
                return JSONResponse({"detail": "INVALID_CONTENT_LENGTH"}, status_code=400)
        return await call_next(request)

_cors_origins = [o.strip() for o in os.getenv(
    "CORS_ORIGINS", "http://localhost:8080,http://127.0.0.1:8080"
).split(",") if o.strip()]
if "*" in _cors_origins and os.getenv("ALLOW_WILDCARD_CORS", "0") != "1":
    raise RuntimeError("Unsafe CORS_ORIGINS='*'. Set explicit origins; wildcard CORS is disabled.")
if os.getenv("ENVIRONMENT", "development").lower() == "production" and not _cors_origins:
    raise RuntimeError("Production requires at least one explicit CORS origin.")

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
    document_type: str | None = None
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


class ActiveChallengeStep(BaseModel):
    action: str
    frames_data_urls: list[str]


class ActiveChallengeRequest(BaseModel):
    # PASS 3D uses one coherent session. Reference acquisition is captured
    # before the scripted target sequence and is never recalibrated during it.
    reference_frames_data_urls: list[str]
    steps: list[ActiveChallengeStep]


class ImageDecodeError(ValueError):
    """A supplied data URL could not be turned into an image."""


def decode_data_url(value: str) -> np.ndarray:
    match = re.fullmatch(r"data:([^;,]+);base64,(.+)", value, flags=re.DOTALL)
    if not match:
        raise ImageDecodeError("Image must be a data URL with explicit base64 MIME type")
    mime = match.group(1).lower().strip()
    if mime not in ALLOWED_IMAGE_MIME:
        raise ImageDecodeError(f"Unsupported image MIME type: {mime}")
    payload = match.group(2)
    try:
        raw = base64.b64decode(payload, validate=True)
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
    height, width = image.shape[:2]
    if width * height > MAX_IMAGE_PIXELS:
        raise ImageDecodeError(f"Image exceeds {MAX_IMAGE_PIXELS} pixels")
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
        "ok": face_detector.loaded and face_recognizer.loaded,
        "status": "ok" if face_detector.loaded and face_recognizer.loaded else "degraded",
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
        "yunet_model_path": str(YUNET_MODEL_PATH),
        "yunet_model": model_file_info(YUNET_MODEL_PATH),
        "face_recognizer_loaded": face_recognizer.loaded,
        "face_recognizer_error": face_recognizer.load_error,
        "face_recognizer_model": "SFace/face_recognition_sface_2021dec",
        "sface_model_path": str(SFACE_MODEL_PATH),
        "sface_model": model_file_info(SFACE_MODEL_PATH),
        "face_match_threshold": FACE_MATCH_THRESHOLD,
        "face_uncertain_band": FACE_UNCERTAIN_BAND,
        "face_match_calibrated": False,
    }


@app.post("/api/liveness")
def liveness(request: ImageRequest):
    encoded = request.get_frames()
    if not encoded:
        return liveness_unavailable(["NO_FRAMES_PROVIDED"])
    if len(encoded) > MAX_LIVENESS_FRAMES:
        return liveness_unavailable(["TOO_MANY_FRAMES", f"MAX_LIVENESS_FRAMES={MAX_LIVENESS_FRAMES}"])

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



def duplicate_frame_indices(frames: list[np.ndarray]) -> list[int]:
    """Return later frame indices whose decoded pixels exactly repeat an earlier frame."""
    seen: dict[bytes, int] = {}
    duplicates: list[int] = []
    for index, frame in enumerate(frames):
        digest = hashlib.sha256(np.ascontiguousarray(frame).tobytes()).digest()
        if digest in seen:
            duplicates.append(index)
        else:
            seen[digest] = index
    return duplicates


def sustained_duplicate_replay(frames: list[np.ndarray]) -> bool:
    """Return True only for a strong repeated-frame pattern.

    A single exact duplicate can occur when browser/camera capture is sampled
    faster than the decoded video advances. Active-challenge replay rejection
    therefore requires either a sustained run of identical frames or a high
    overall duplicate ratio. This keeps the replay guard while avoiding false
    failures caused by capture timing at phase boundaries.
    """
    if len(frames) < 4:
        return False

    digests = [
        hashlib.sha256(np.ascontiguousarray(frame).tobytes()).digest()
        for frame in frames
    ]

    duplicate_count = len(digests) - len(set(digests))
    duplicate_ratio = duplicate_count / max(1, len(digests) - 1)

    max_consecutive_duplicates = 0
    consecutive_duplicates = 0
    for previous, current in zip(digests, digests[1:]):
        if current == previous:
            consecutive_duplicates += 1
            max_consecutive_duplicates = max(max_consecutive_duplicates, consecutive_duplicates)
        else:
            consecutive_duplicates = 0

    return max_consecutive_duplicates >= 3 or (duplicate_count >= 4 and duplicate_ratio >= 0.50)

@app.post("/api/active-challenge")
def active_challenge(request: ActiveChallengeRequest):
    if not request.reference_frames_data_urls:
        return {"challenge_status": "FAILED", "failure_reason": "NO_REFERENCE_FRAMES_PROVIDED", "steps": []}
    if not request.steps:
        return {"challenge_status": "FAILED", "failure_reason": "NO_CHALLENGE_STEPS_PROVIDED", "steps": []}

    requested_actions = tuple(step.action.upper().strip() for step in request.steps)
    if requested_actions != CHALLENGE_SEQUENCE:
        return {"challenge_status": "FAILED", "failure_reason": "INVALID_CHALLENGE_SEQUENCE", "steps": []}
    if not face_detector.loaded:
        return {
            "challenge_status": "FAILED",
            "failure_reason": "FACE_DETECTOR_MODEL_UNAVAILABLE",
            "steps": [],
            "evidence": {"pose_method": "YuNet-5-landmark + solvePnP(SQPNP)"},
        }
    if len(request.reference_frames_data_urls) > MAX_REFERENCE_FRAMES:
        return {"challenge_status": "FAILED", "failure_reason": "REFERENCE_TIMEOUT", "steps": []}
    if any(len(step.frames_data_urls) > MAX_CHALLENGE_STEP_FRAMES for step in request.steps):
        return {"challenge_status": "FAILED", "failure_reason": "CHALLENGE_TIMEOUT", "steps": []}

    try:
        reference_frames = decode_frames(request.reference_frames_data_urls, MAX_REFERENCE_FRAMES)
        challenge_steps = [
            (step.action, decode_frames(step.frames_data_urls, MAX_CHALLENGE_STEP_FRAMES))
            for step in request.steps
        ]
        all_session_frames = reference_frames + [frame for _, frames in challenge_steps for frame in frames]
        duplicate_indices = duplicate_frame_indices(all_session_frames)
        if sustained_duplicate_replay(all_session_frames):
            return {
                "challenge_status": "FAILED",
                "failure_reason": "DUPLICATE_FRAME_REPLAY",
                "steps": [],
                "evidence": {
                    "duplicate_frame_indices": duplicate_indices[:16],
                    "duplicate_detection": "sustained_exact_frame_repetition",
                },
            }
    except ImageDecodeError as exc:
        return {"challenge_status": "FAILED", "failure_reason": f"INVALID_IMAGE_DATA:{exc}", "steps": []}

    return verify_active_challenge_sequence(reference_frames, challenge_steps, face_detector)


@app.post("/api/face-match")
def face_match(request: FaceMatchRequest):
    encoded_live = request.get_live_frames()
    if not encoded_live:
        return face_match_unavailable(["NO_LIVE_FRAMES_PROVIDED"])
    if len(encoded_live) > MAX_PROBE_FRAMES:
        return face_match_unavailable(["TOO_MANY_FRAMES", f"MAX_PROBE_FRAMES={MAX_PROBE_FRAMES}"])

    try:
        document = decode_data_url(request.document_image_data_url)
        live_frames = decode_frames(encoded_live, MAX_PROBE_FRAMES)
    except ImageDecodeError as exc:
        return face_match_unavailable(["INVALID_IMAGE_DATA", str(exc)])

    if not face_detector.loaded:
        detector_issue = ["FACE_DETECTOR_MODEL_UNAVAILABLE", face_detector.load_error]
        return face_match_unavailable(
            detector_issue,
            document_portrait={
                "status": "uncertain",
                "face_count": 0,
                "selected_face": None,
                "document_type": request.document_type or "unknown",
                "layout": "unavailable",
                "orientation": None,
                "extraction_method": "document-layout + multi-orientation face-detection",
                "confidence": None,
                "portrait_candidate_count": 0,
                "document_face_detected": False,
                "embedding_ready": False,
                "issues": detector_issue,
                "candidates": [],
            },
            document={
                "type": request.document_type or "unknown",
                "portrait_detected": False,
                "portrait_candidate_count": 0,
                "document_face_detected": False,
                "embedding_ready": False,
            },
            live={
                "face_detected": False,
                "face_count": 0,
                "embedding_ready": False,
                **empty_live_diagnostics(len(live_frames)),
            },
        )

    try:
        portrait = extract_document_portrait(document, face_detector, document_type=request.document_type or "unknown")
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
        "document_type": portrait.layout.document_type,
        "face_count": portrait.face_count,
        "portrait_candidate_count": len(portrait.candidates),
        "document_face_detected": portrait.face_count > 0,
        "embedding_ready": False,
        "document_face_quality": (
            portrait.selected_candidate.quality
            if portrait.selected_candidate is not None
            else None
        ),
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
            ["DOCUMENT_PORTRAIT_NOT_FOUND", *portrait.issues],
            document_portrait=portrait_evidence,
            live={"embedding_ready": False, **empty_live_diagnostics(len(live_frames))},
        )

    if not face_recognizer.loaded:
        return face_match_unavailable(
            ["DOCUMENT_EMBEDDING_FAILED", face_recognizer.load_error],
            document_portrait=portrait_evidence,
            live={"embedding_ready": False, **empty_live_diagnostics(len(live_frames))},
        )

    # Stage 1: document face -> SFace. Keep this independent so a later live
    # failure does not incorrectly report that the document embedding failed.
    try:
        doc_face = build_document_face(document, portrait)
    except FaceRecognitionError as exc:
        return face_match_unavailable(
            [str(exc)],
            document_portrait=portrait_evidence,
            live={"embedding_ready": False},
        )
    try:
        doc_embedding = face_recognizer.embedding(doc_face.image, doc_face.detection)
    except (FaceModelError, FaceRecognitionError, ValueError) as exc:
        return face_match_unavailable(
            ["DOCUMENT_EMBEDDING_FAILED", str(exc)],
            document_portrait={**portrait_evidence, "embedding_ready": False},
            document_face={"embedding_ready": False},
            live={"embedding_ready": False, **empty_live_diagnostics(len(live_frames))},
        )
    portrait_evidence["embedding_ready"] = True

    # Stage 2: choose the best usable recognition probe from the burst.
    selection = select_probe_frame(live_frames, face_detector)
    probe_evidence = selection.as_evidence()
    if selection.probe is None:
        frames_with_face = selection.considered - selection.rejected["no_face"] - selection.rejected["multiple_faces"] - selection.rejected["detector_error"]
        face_seen = frames_with_face > 0
        failure_issue = "LIVE_FACE_NOT_USABLE" if face_seen else "LIVE_FACE_NOT_FOUND"
        return face_match_unavailable(
            [failure_issue, *selection.issues],
            document_portrait=portrait_evidence,
            document_face={"embedding_ready": True},
            live={
                "embedding_ready": False,
                "face_detected": face_seen,
                "face_count": 1 if face_seen else 0,
                "frames_received": selection.considered,
                "frames_with_face": frames_with_face,
                "frames_rejected": selection.rejected,
                "best_frame_index": None,
                "best_frame_quality": None,
                "live_face_detected": face_seen,
            },
            probe_frame=probe_evidence,
        )

    try:
        live_face = build_live_face(selection.probe.image, face_detector)
    except FaceRecognitionError as exc:
        reason = str(exc)
        issue = reason.split(":", 1)[0]
        return face_match_unavailable(
            [issue, reason],
            document_portrait=portrait_evidence,
            document_face={
                "embedding_ready": True,
                "face_detected": True,
            },
            live={
                "embedding_ready": False,
                "face_detected": "NO_FACE" not in reason,
                "face_count": 1 if "MULTIPLE_FACES" not in reason else 2,
            },
            probe_frame=probe_evidence,
        )

    live_evidence = {
        "face_detected": True,
        "face_count": live_face.quality.face_count,
        "face_quality": {
            "width": round(live_face.quality.box_width or 0.0, 2),
            "height": round(live_face.quality.box_height or 0.0, 2),
            "relative_size": round(live_face.quality.relative_size or 0.0, 6),
            "detection_confidence": round(live_face.quality.detection_confidence or 0.0, 6),
            "sharpness": round(live_face.quality.sharpness or 0.0, 3),
            "brightness": round(live_face.quality.brightness or 0.0, 3),
            "pose": {"yaw": selection.probe.yaw, "pitch": selection.probe.pitch},
            "issues": list(live_face.quality.issues),
        },
        "embedding_ready": False,
        "frames_received": selection.considered,
        "frames_with_face": selection.considered - selection.rejected["no_face"] - selection.rejected["multiple_faces"] - selection.rejected["detector_error"],
        "frames_rejected": selection.rejected,
        "best_frame_index": selection.probe.index,
        "best_frame_quality": round(selection.probe.score, 6),
        "live_face_detected": True,
    }

    try:
        live_embedding = face_recognizer.embedding(live_face.image, live_face.detection)
    except (FaceModelError, FaceRecognitionError, ValueError) as exc:
        return face_match_unavailable(
            ["LIVE_EMBEDDING_FAILED", str(exc)],
            document_portrait=portrait_evidence,
            document_face={"embedding_ready": True, "face_detected": True},
            live={**live_evidence, "embedding_ready": False},
            probe_frame=probe_evidence,
        )
    live_evidence["embedding_ready"] = True

    try:
        similarity = face_recognizer.compare(doc_embedding, live_embedding)
    except (FaceRecognitionError, ValueError) as exc:
        return face_match_unavailable(
            ["COSINE_SIMILARITY_FAILED", str(exc)],
            document_portrait=portrait_evidence,
            document_face={"embedding_ready": True, "face_detected": True},
            live=live_evidence,
            probe_frame=probe_evidence,
        )

    issues = list(dict.fromkeys([*doc_face.quality.issues, *live_face.quality.issues]))
    status = face_recognizer.classify(similarity, issues)

    return {
        **face_match_base(),
        "face_match_status": status,
        "similarity_score": round(similarity, 6),
        "distance": round(1.0 - similarity, 6),
        "issues": issues,
        "matcher": "sface-embedding",
        "document_portrait": portrait_evidence,
        "probe_frame": probe_evidence,
        "document": {
            "type": request.document_type or "unknown",
            "portrait_detected": True,
            "portrait_candidate_count": len(portrait.candidates),
            "document_face_detected": True,
            "document_face_quality": portrait_evidence.get("document_face_quality"),
            "embedding_ready": True,
        },
        "live": live_evidence,
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
