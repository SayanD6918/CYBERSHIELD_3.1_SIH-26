# CYBERSHIELD 3.1.8 LIVE_CAPTURE_SUBMISSION — biometric pipeline fix

## Fixed

- Preserved the real YuNet -> SFace -> cosine comparison pipeline.
- Added SHA-256 pinning for the required OpenCV Zoo YuNet and SFace models.
- Added verified model bootstrap/download logic to the Windows and Unix launchers.
- `/health` now reports exact model paths, artifact existence, SHA-256 and loaded/error state; health is `degraded` when face models are unavailable.
- Hardened SFace embedding validation against empty, NaN, infinite and zero-norm outputs.
- Fixed a critical live-face coordinate bug: live face detection coordinates are full-frame coordinates, so SFace now receives the full live frame with the matching detection/landmarks rather than a cropped image with full-frame coordinates.
- Expanded live-capture diagnostics: frames received, frames with one face, rejection counts, best frame, quality and live-face state.
- Frontend verifies backend model readiness before spending a 24-frame capture burst.
- Frontend validates every captured frame as a JPEG data URL and displays capture progress.
- Biometric similarity remains separate from risk score and displays `NOT AVAILABLE` when no genuine cosine score exists.

## Verification performed in this environment

- Python compileall: PASS.
- Existing relevant backend tests: 69 passed.
- Fail-closed `/api/face-match` test with unavailable models: `similarity_score = null`, `face_match_status = UNCERTAIN`: PASS.
- `/health` correctly reports `status=degraded` and exact missing model paths: PASS.
- Live detection/SFace coordinate contract test: PASS.
- Uvicorn startup + `/health` request: PASS.

## Remaining environment limitation

The uploaded submission archive did not contain the two ONNX model binaries, and this execution environment has no outbound DNS/network access. Therefore the model binaries could not be fetched into the archive here and a real YuNet/SFace inference run, full frontend build, and camera end-to-end test could not be truthfully claimed.

The launchers now fetch and SHA-256 verify the exact required models when network access is available. The required hashes are:

- YuNet: `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4`
- SFace: `0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79`

The frontend dependency install/build was also blocked because npm registry artifacts were not available in the local cache.


## Active challenge replay false-positive fix (2026-09-26)

- Browser capture now synchronizes with decoded camera frames using `requestVideoFrameCallback`, with a timed fallback for older browsers.
- A 300 ms transition is inserted between challenge phases.
- The server no longer treats one exact duplicate frame as definitive replay evidence; it requires sustained repetition or a high duplicate ratio.
- The UI displays the current active-challenge instruction (neutral, left, right, straight/hold).
- Added regression tests for single-frame duplicates versus sustained duplicate replay.
