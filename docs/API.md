# API / Boundary Notes — CYBERSHIELD 3.1.8 Phase 3

## Application server

`authoritativeVerification` is a TanStack Start server function. Its input is raw document/camera evidence only. The function recomputes document analysis, invokes the biometric service, fuses evidence and returns the authoritative case record.

It does not accept authoritative `decision`, `riskScore`, `biometric`, or `watchlistHit` fields from the browser.

## Biometric service

Existing endpoints remain:

- `GET /health`
- `POST /api/active-challenge`
- `POST /api/liveness`
- `POST /api/face-match`

The biometric service is intended to be reached by the trusted application server in the Phase-3 architecture rather than directly by an untrusted browser.
