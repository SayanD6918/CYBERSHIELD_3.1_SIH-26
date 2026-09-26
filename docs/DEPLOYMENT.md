# Deployment — Phase 3

Required environment configuration for the application server:

- `BIOMETRIC_SERVICE_URL` — trusted internal biometric-service URL.
- `CYBERSHIELD_SERVER_WATCHLIST_NAMES` — optional server-controlled comma-separated watchlist names.
- `CYBERSHIELD_AUTO_HOLD_WATCHLIST` — server-controlled watchlist routing policy; defaults to enabled.

For the biometric service:

- set explicit `CORS_ORIGINS` when cross-origin browser access is needed;
- do not use wildcard CORS in production;
- keep YuNet/SFace/PAD model artifacts deployment-controlled;
- configure `PAD_MODEL_SHA256` when a trusted PAD artifact is deployed;
- do not expose model files or internal diagnostics publicly.

A production deployment still requires authentication, authorization, persistent server-side case storage, monitoring and a security review.
