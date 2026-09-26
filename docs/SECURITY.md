# Security — CYBERSHIELD 3.1.8 Phase 3

## Implemented

- Server-authoritative biometric/document/risk computation.
- No client-supplied decision, risk score, biometric result or watchlist hit is accepted by the authoritative path.
- Strict Base64 and image MIME validation.
- Encoded image and decoded pixel limits.
- Frame-count and request-body limits.
- Explicit CORS origins and non-credentialed biometric CORS.
- Trusted PAD model directory and optional SHA-256 allowlist.
- YuNet/SFace SHA-256 verification.
- Exact decoded-frame duplicate detection across PASS3D sessions.
- Security-sensitive case records excluded from localStorage persistence.

## Deployment limitations

Authentication, authorization, server-side persistent case storage, replay tokens and production key management are not implemented. These are required before a production deployment.

Python pickle/joblib model artifacts are executable deserialization inputs and must only be supplied from trusted deployment-controlled artifacts.
