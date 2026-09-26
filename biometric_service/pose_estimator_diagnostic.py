"""Offline diagnostic for the exact production PASS3D pose estimator.

Usage:
  python pose_estimator_diagnostic.py path/to/burst.mp4
  python pose_estimator_diagnostic.py path/to/frame_dir

The diagnostic does not alter production behavior. It runs the same YuNet
landmarks and estimate_head_pose() used by PASS3D and writes one JSON object
per frame to stdout (or --output FILE).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from active_challenge import estimate_head_pose
from face_detection import YuNetDetector


def _frame_sources(path: Path):
    if path.is_dir():
        files = sorted(
            p for p in path.iterdir()
            if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
        )
        for index, item in enumerate(files):
            image = cv2.imread(str(item), cv2.IMREAD_COLOR)
            yield index, image, str(item)
        return

    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video: {path}")
    index = 0
    try:
        while True:
            ok, image = cap.read()
            if not ok:
                break
            yield index, image, str(path)
            index += 1
    finally:
        cap.release()


def diagnose(source: Path, detector: YuNetDetector) -> list[dict]:
    rows: list[dict] = []
    for frame_index, image, source_name in _frame_sources(source):
        row = {
            "frame_index": frame_index,
            "source": source_name,
            "image_width": int(image.shape[1]) if image is not None else None,
            "image_height": int(image.shape[0]) if image is not None else None,
            "face_count": 0,
            "face": None,
            "error": None,
        }
        if image is None or image.size == 0:
            row["error"] = "IMAGE_DECODE_FAILED"
            rows.append(row)
            continue

        try:
            detections = detector.detect(image)
            row["face_count"] = len(detections)
            if len(detections) != 1:
                row["error"] = "EXPECTED_EXACTLY_ONE_FACE"
                rows.append(row)
                continue

            detection = detections[0]
            pose = estimate_head_pose(detection, image.shape)
            row["face"] = {
                "bounding_box_xywh": [float(v) for v in detection.box],
                "confidence": float(detection.confidence),
                "landmarks": [
                    {"name": name, "x": float(point[0]), "y": float(point[1])}
                    for name, point in zip(
                        ("right_eye", "left_eye", "nose_tip", "right_mouth", "left_mouth"),
                        np.asarray(detection.landmarks, dtype=np.float32),
                    )
                ],
                "reprojection_error": pose.reprojection_error,
                "rotation_vector": None,
                "rotation_matrix": None,
                "yaw": pose.yaw,
                "pitch": pose.pitch,
                "roll": pose.roll,
            }

            # Recompute rvec/tvec only for diagnostics using the exact production
            # inputs and flags; estimate_head_pose() itself remains untouched.
            from active_challenge import MODEL_POINTS, _camera_matrix
            camera_matrix = _camera_matrix(image.shape[1], image.shape[0])
            ok, rvec, _ = cv2.solvePnP(
                MODEL_POINTS,
                np.asarray(detection.landmarks, dtype=np.float32),
                camera_matrix,
                np.zeros((4, 1), dtype=np.float64),
                flags=cv2.SOLVEPNP_SQPNP,
            )
            if ok:
                rotation, _ = cv2.Rodrigues(rvec)
                row["face"]["rotation_vector"] = [float(v) for v in rvec.reshape(-1)]
                row["face"]["rotation_matrix"] = [[float(v) for v in r] for r in rotation]
        except Exception as exc:
            row["error"] = f"{type(exc).__name__}: {exc}"
        rows.append(row)
    return rows


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path, help="Saved webcam video or directory of image frames")
    parser.add_argument("--yunet", type=Path, default=None, help="Path to production YuNet ONNX model")
    parser.add_argument("--output", type=Path, default=None, help="Optional JSONL output path")
    args = parser.parse_args()

    detector = YuNetDetector(args.yunet) if args.yunet else YuNetDetector()
    if not detector.loaded:
        raise SystemExit(f"YuNet unavailable: {detector.load_error}")

    rows = diagnose(args.source, detector)
    stream = open(args.output, "w", encoding="utf-8") if args.output else None
    try:
        for row in rows:
            print(json.dumps(row, separators=(",", ":"), allow_nan=False), file=stream or __import__("sys").stdout)
    finally:
        if stream:
            stream.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
