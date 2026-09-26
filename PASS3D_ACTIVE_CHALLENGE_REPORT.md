# CYBERSHIELD 3.1.8 — PASS 3D Active Challenge Implementation Report

## Scope

PASS 3D only.

PASS 3C remains an independent reusable `TemporalReferenceEstimator` and was not redesigned. PASS 4 was not started.

## Implementation

The active challenge now runs as one coherent session:

```text
REFERENCE CAPTURE
    ↓
PASS 3C temporal reference acquisition
    ↓
immutable reference
    ↓
READY_AT_REFERENCE
    ↓
MOVE_TO_LEFT_TARGET
    ↓
HOLD_LEFT_TARGET
    ↓
RETURN_TO_REFERENCE
    ↓
MOVE_TO_RIGHT_TARGET
    ↓
HOLD_RIGHT_TARGET
    ↓
FINAL_RETURN_TO_REFERENCE
    ↓
PASSED
```

`LOOK_STRAIGHT` remains the frontend-visible final step, but its server meaning is final return to the established reference rather than absolute yaw zero.

## Coordinate-system rule

After reference establishment all challenge decisions use:

```text
relative_yaw   = current_yaw   - reference_yaw
relative_pitch = current_pitch - reference_pitch
relative_roll  = current_roll  - reference_roll
```

No target decision uses absolute raw yaw after reference establishment.

Targets:

- `TURN_LEFT`: relative yaw >= +20°
- `TURN_RIGHT`: relative yaw <= -20°

Movement onset remains 8° relative yaw.

Return-to-reference uses:

- yaw: ±6°
- pitch: ±8°
- roll: ±8°

These are tolerances around the immutable reference, not camera-zero tolerances.

## Target evidence

A target is not accepted from a single frame. The implementation uses a five-valid-pose trajectory window, requires directional consistency, sufficient displacement, and then three additional target-hold observations.

A contradictory direction, insufficient movement, or single-frame excursion cannot satisfy the target evidence.

## Face handling

- Exactly one face is required for progression.
- Multiple faces immediately invalidate the challenge.
- Short no-face gaps up to three consecutive frames are tolerated.
- Persistent face loss invalidates the active state.
- Missing frames never become synthetic pose evidence.

## Quality handling

The existing pose geometry is retained:

```text
YuNet 5 landmarks
→ solvePnP(SQPNP)
→ Rodrigues
→ Euler yaw/pitch/roll
```

Existing reprojection ceiling remains 18 px. PASS 3C detector confidence and face-size quality floors are preserved. Face dimensions remain minimum quality floors and are not used as a distance target.

The raw neutral calibration envelope remains ±12° for yaw, pitch, and roll.

No yaw offset was introduced.

## Frontend integration

The frontend now captures:

1. a dedicated neutral-reference burst;
2. TURN_LEFT burst;
3. TURN_RIGHT burst;
4. LOOK_STRAIGHT/final-return burst;

and submits all four portions in one `/api/active-challenge` session request. This prevents each movement burst from establishing a new baseline.

## Files modified

- `biometric_service/active_challenge.py`
- `biometric_service/main.py`
- `src/routes/_app/verify.tsx`
- `biometric_service/test_active_challenge.py`
- `biometric_service/test_service_contracts.py`
- `PASS3D_ACTIVE_CHALLENGE_REPORT.md`

PASS 3C files remain unchanged:

- `biometric_service/temporal_reference.py`
- `biometric_service/test_temporal_reference.py`

The following core biometric modules were also left unchanged:

- `face_detection.py`
- `face_matching.py`
- `liveness.py`
- `document_portrait.py`
- `frame_selection.py`

## Validation

Python test suite:

```text
Ran 109 tests in 0.875s
OK
```

Python compilation:

```text
python -m compileall -q biometric_service
COMPILE_OK
```

No physical webcam validation was performed after PASS 3D implementation, so no webcam-pass claim is made.

Frontend TypeScript validation was not run because the extracted project environment did not contain `node_modules`; this does not alter the Python test result.

## PASS 4

Not started.
