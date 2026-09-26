# Required biometric model files

The submission requires the exact OpenCV Zoo model artifacts below. The service refuses to load a file whose SHA-256 does not match.

| File | SHA-256 | Source |
|---|---|---|
| `face_detection_yunet_2023mar.onnx` | `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4` | OpenCV Zoo YuNet |
| `face_recognition_sface_2021dec.onnx` | `0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79` | OpenCV Zoo SFace |

Place both files directly in this directory. The Windows and Unix launchers run `download_face_models.py` before starting the API, which downloads and verifies them if they are absent.

The current source archive used for this fix did not contain the binary weights, so an offline machine must supply them before startup.
