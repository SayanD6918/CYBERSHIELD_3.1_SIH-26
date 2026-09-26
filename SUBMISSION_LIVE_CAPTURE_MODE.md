# CYBERSHIELD 3.1.8 — Integrated Live Verification Mode

The production verification path now invokes the existing biometric services instead of leaving passive PAD and PASS3D disconnected from the decision flow.

## Flow

Document → portrait extraction → SFace document embedding

Camera session → 12-frame reference → TURN_LEFT → TURN_RIGHT → LOOK_STRAIGHT

The same session supplies:

- SFace document-to-live face matching
- passive PAD over a bounded 24-frame burst
- server-side PASS3D active challenge verification

The existing PASS3D pose/reference implementation and its thresholds are not changed by this integration.

## Decision fusion

The risk engine now consumes:

- face-match status
- passive PAD status
- active challenge status
- document/MRZ/expiry/tamper evidence
- identity-provider state
- watchlist state

PAD `SPOOF` is distinct from PAD `UNCERTAIN`. Challenge evidence is also preserved with machine-readable failure reasons.

## Important limitation

The identity provider remains non-authoritative until a real issuer/government integration is introduced in a later phase. No government/API Setu/DigiLocker/Aadhaar-authentication API has been added in this phase. Therefore a fully positive biometric session does not by itself produce `VERIFIED`.

PAD calibration and face-match threshold calibration also remain explicitly uncalibrated unless supported by an application-specific evaluation dataset.
