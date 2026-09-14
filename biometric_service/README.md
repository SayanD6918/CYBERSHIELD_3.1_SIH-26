# CyberShield biometric service

This service adapts the original Liveness/Spoofing Detector into an HTTP module. It keeps the original Haar-cascade face detection, YCrCb/LUV histogram features and ExtraTrees `predict_proba` PAD classifier, but removes the OpenCV desktop window.

Endpoints:
- `GET /health`
- `POST /api/liveness` — `{ "image_data_url": "..." }`
- `POST /api/face-match` — document and live image data URLs

The bundled model is `liveness_model.pkl`, copied from the CyberShield-trained classifier in the supplied liveness prototype.

The face matcher is a replaceable prototype adapter. It intentionally reports its matcher name and limitation; it should be replaced with a validated face-embedding model for production.
