# CYBERSHIELD 3.1 integration

The repository now treats the React/TanStack application as the single operator UI and the Python PAD detector as a replaceable biometric service.

```text
Document image
   ↓
CyberShield document analysis
   ↓
Case ID
   ↓
Mock authoritative identity verification
   ↓
Browser camera
   ↓
Python liveness service (/api/liveness)
   ↓
Python face verification service (/api/face-match)
   ↓
IdentityConsistencyEngine + Risk Engine
   ↓
GREEN / YELLOW / RED
```

## Run

1. Install the Node dependencies and start CyberShield:
   `npm install`
   `npm run dev`
2. In a second terminal start `biometric_service/run_windows.ps1` on Windows or `biometric_service/run_unix.sh` on Linux/macOS.
3. Optional: set `VITE_BIOMETRIC_URL` if the biometric service is not at `http://127.0.0.1:8765`.

The bundled ExtraTrees PAD model is loaded without changing its model file. The service exposes its load status at `/health`.

## Important prototype limitation

The original liveness classifier is preserved and now returns structured JSON. The face-match adapter is deliberately replaceable and currently uses a lightweight OpenCV correlation prototype; it is **not** a production biometric embedding system. Replace `face_similarity()` with a validated face-embedding model before real-world use.

The mock identity database in `src/lib/identity-consistency.ts` is for hackathon demonstration only. No government/authoritative database is contacted.

## Integration points

- `src/routes/_app/verify.tsx` — unified document → camera → final assessment workflow.
- `src/lib/types.ts` — case, database and biometric contracts.
- `src/lib/risk-engine.ts` — centralized deterministic risk rules and critical-failure overrides.
- `src/lib/identity-consistency.ts` — mock authoritative record comparison.
- `src/lib/finalize-verification.ts` — combines document, database, liveness and face evidence.
- `biometric_service/main.py` — reusable Python service; no OpenCV UI is launched.
