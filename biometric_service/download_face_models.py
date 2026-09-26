from __future__ import annotations

import hashlib
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
MODELS = {
    "face_detection_yunet_2023mar.onnx": {
        "url": "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
        "sha256": "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    },
    "face_recognition_sface_2021dec.onnx": {
        "url": "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
        "sha256": "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
    },
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify(name: str) -> bool:
    target = ROOT / "models" / name
    expected = MODELS[name]["sha256"]
    if not target.is_file():
        return False
    actual = sha256(target)
    if actual != expected:
        raise RuntimeError(f"{name}: SHA-256 mismatch: expected {expected}, got {actual}")
    return True


def download(name: str) -> None:
    spec = MODELS[name]
    target = ROOT / "models" / name
    target.parent.mkdir(parents=True, exist_ok=True)
    if verify(name):
        print(f"verified: {target}")
        return
    temp = target.with_suffix(target.suffix + ".download")
    print(f"downloading: {name}")
    request = Request(spec["url"], headers={"User-Agent": "CyberShield/3.1.8"})
    try:
        with urlopen(request, timeout=120) as response, temp.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
    except Exception:
        temp.unlink(missing_ok=True)
        raise
    actual = sha256(temp)
    if actual != spec["sha256"]:
        temp.unlink(missing_ok=True)
        raise RuntimeError(f"{name}: downloaded SHA-256 mismatch: expected {spec['sha256']}, got {actual}")
    temp.replace(target)
    print(f"saved and verified: {target}")


if __name__ == "__main__":
    for model_name in MODELS:
        download(model_name)
