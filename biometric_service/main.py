from __future__ import annotations

import base64
import os
from pathlib import Path
from typing import Any

import cv2
import joblib
import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent
MODEL_PATH = Path(os.getenv("LIVENESS_MODEL_PATH", ROOT / "liveness_model.pkl"))
CASCADE_PATH = ROOT / "haarcascade_frontalface_default.xml"

app = FastAPI(title="CyberShield Biometric Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:8080,http://127.0.0.1:8080").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

cascade = cv2.CascadeClassifier(str(CASCADE_PATH))
classifier: Any | None = None
model_error: str | None = None

try:
    classifier = joblib.load(MODEL_PATH)
except Exception as exc:
    model_error = f"{type(exc).__name__}: {exc}"


class ImageRequest(BaseModel):
    image_data_url: str


class FaceMatchRequest(BaseModel):
    document_image_data_url: str
    live_image_data_url: str


def decode_data_url(value: str) -> np.ndarray:
    payload = value.split(",", 1)[1] if "," in value else value
    raw = base64.b64decode(payload)
    arr = np.frombuffer(raw, dtype=np.uint8)
    image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Invalid image data")
    return image


def detect_faces(image: np.ndarray):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(80, 80))


def calc_hist(img: np.ndarray) -> np.ndarray:
    parts = []
    for j in range(3):
        hist = cv2.calcHist([img], [j], None, [256], [0, 256])
        max_val = float(hist.max()) or 1e-5
        parts.append(hist * (255.0 / max_val))
    return np.asarray(parts)


def liveness_probability(face: np.ndarray) -> float | None:
    if classifier is None:
        return None
    ycrcb = cv2.cvtColor(face, cv2.COLOR_BGR2YCR_CB)
    luv = cv2.cvtColor(face, cv2.COLOR_BGR2LUV)
    features = np.append(calc_hist(ycrcb).ravel(), calc_hist(luv).ravel()).reshape(1, -1)
    prediction = classifier.predict_proba(features)
    return float(prediction[0][1])


def crop_largest_face(image: np.ndarray) -> np.ndarray | None:
    faces = detect_faces(image)
    if len(faces) == 0:
        return None
    x, y, w, h = max(faces, key=lambda item: item[2] * item[3])
    return image[y:y+h, x:x+w]


def quality(face: np.ndarray) -> dict[str, float]:
    gray = cv2.cvtColor(face, cv2.COLOR_BGR2GRAY)
    return {
        "sharpness": float(cv2.Laplacian(gray, cv2.CV_64F).var()),
        "brightness": float(gray.mean()),
    }


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "cybershield-biometric",
        "liveness_model_loaded": classifier is not None,
        "model_error": model_error,
    }


@app.post("/api/liveness")
def liveness(request: ImageRequest):
    image = decode_data_url(request.image_data_url)
    faces = detect_faces(image)
    if len(faces) == 0:
        return {
            "liveness_status": "UNCERTAIN",
            "confidence": 0.0,
            "challenge_passed": False,
            "face_count": 0,
            "issues": ["No face detected"],
        }
    if len(faces) > 1:
        return {
            "liveness_status": "UNCERTAIN",
            "confidence": 0.0,
            "challenge_passed": False,
            "face_count": len(faces),
            "issues": ["Multiple faces detected"],
        }

    x, y, w, h = faces[0]
    face = image[y:y+h, x:x+w]
    prob = liveness_probability(face)
    if prob is None:
        return {
            "liveness_status": "UNCERTAIN",
            "confidence": 0.0,
            "challenge_passed": False,
            "face_count": 1,
            "issues": ["Bundled liveness model could not be loaded; see health.model_error"],
        }

    # The original classifier's class 1 is spoof probability.
    live_confidence = max(0.0, min(1.0, 1.0 - prob))
    if prob >= 0.70:
        status = "SPOOF"
    elif prob >= 0.50:
        status = "UNCERTAIN"
    else:
        status = "LIVE"

    q = quality(face)
    issues = []
    if q["sharpness"] < 35:
        issues.append("Face image is blurry")
    if q["brightness"] < 45 or q["brightness"] > 215:
        issues.append("Face lighting is poor")

    return {
        "liveness_status": status,
        "confidence": round(live_confidence, 4),
        "challenge_passed": status == "LIVE",
        "face_count": 1,
        "issues": issues,
        "spoof_probability": round(prob, 4),
    }


def normalize_face(face: np.ndarray) -> np.ndarray:
    face = cv2.resize(face, (160, 160))
    return cv2.cvtColor(face, cv2.COLOR_BGR2GRAY)


def face_similarity(a: np.ndarray, b: np.ndarray) -> float:
    # Replaceable prototype matcher. Uses normalized pixel correlation plus
    # edge correlation, and intentionally returns UNCERTAIN when quality is weak.
    a = normalize_face(a)
    b = normalize_face(b)
    a = cv2.equalizeHist(a)
    b = cv2.equalizeHist(b)
    corr = float(cv2.compareHist(
        cv2.calcHist([a], [0], None, [64], [0, 256]),
        cv2.calcHist([b], [0], None, [64], [0, 256]),
        cv2.HISTCMP_CORREL,
    ))
    ea = cv2.Canny(a, 60, 120)
    eb = cv2.Canny(b, 60, 120)
    edge_corr = float(cv2.matchTemplate(ea, eb, cv2.TM_CCOEFF_NORMED)[0, 0])
    score = np.clip((corr * 0.55 + edge_corr * 0.45 + 1.0) / 2.0, 0.0, 1.0)
    return float(score)


@app.post("/api/face-match")
def face_match(request: FaceMatchRequest):
    document = decode_data_url(request.document_image_data_url)
    live = decode_data_url(request.live_image_data_url)
    doc_face = crop_largest_face(document)
    live_face = crop_largest_face(live)

    if doc_face is None or live_face is None:
        return {
            "face_match_status": "UNCERTAIN",
            "similarity_score": None,
            "threshold": 0.80,
            "issues": ["Could not detect a face in both images"],
            "matcher": "prototype-correlation",
        }

    score = face_similarity(doc_face, live_face)
    if score >= 0.80:
        status = "MATCH"
    elif score >= 0.60:
        status = "UNCERTAIN"
    else:
        status = "NO_MATCH"

    return {
        "face_match_status": status,
        "similarity_score": round(score, 4),
        "threshold": 0.80,
        "issues": [],
        "matcher": "prototype-correlation",
        "note": "Prototype matcher; replace with a validated face-embedding model before production use.",
    }
