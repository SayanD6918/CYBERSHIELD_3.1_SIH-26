# CYBERSHIELD 3.1.8 — PASS 3C/PASS 3D Reference Acquisition Fix Report

## Scope

This change addresses only the PASS 3C temporal-reference acquisition gate used by PASS 3D.

PASS 3D movement/state-machine architecture, pose geometry, YuNet, SFace, passive PAD, and PASS 4 were not changed.

## Audit finding

The uploaded implementation in `biometric_service/temporal_reference.py` rejected every reference candidate observation whose absolute raw yaw exceeded `NEUTRAL_YAW_LIMIT = 12.0`.

That happened before the 12-observation stability test:

- `abs(sample.yaw) > 12.0` returned `NOT_RAW_NEUTRAL_YAW`.
- Therefore a stable neutral posture around -16° could never enter the candidate window.
- PASS 3D could not establish its user-specific reference, even though subsequent movement is defined relative to that reference.

The physical diagnostic cluster supplied by the user contains only 9 observations, so it still cannot satisfy the existing 12-valid-observation requirement. Its yaw range is also about 6.15°, slightly above the existing 6° range limit. It is therefore treated as candidate evidence but does not establish a reference by itself.

## Implemented change

The yaw gate was redesigned rather than simply changing the per-frame +/-12° limit to +/-20°.

### Before

Each candidate frame had to satisfy:

- `abs(raw_yaw) <= 12°`
- `abs(raw_pitch) <= 12°`
- `abs(raw_roll) <= 12°`

Only then could it enter the temporal reference window.

### After

Per-frame quality gates remain unchanged for:

- finite values
- valid pose
- exactly one face
- confidence >= 0.85
- face size >= 80x80
- reprojection <= 18 px
- pitch <= +/-12°
- roll <= +/-12°

Raw yaw is no longer rejected on each observation solely because it is moderately non-zero.

Instead:

1. valid yaw observations enter the same 12-observation candidate window;
2. the existing yaw/pitch/roll range and MAD stability checks run unchanged;
3. the component-wise median reference is computed;
4. the median reference yaw must satisfy a bounded moderate-offset gate:
   `abs(reference_yaw) <= 18°`;
5. only then is the reference established and made immutable.

This means the implementation can accept a stable reference around +/-16°, while a stable reference centered at +20° remains outside the reference envelope.

The 18° value is therefore a bounded reference-center criterion, not a blanket widening of the per-frame neutral test to +/-20°.

## Preserved security/quality requirements

Unchanged:

- exactly one face
- finite pose values
- valid pose
- detector confidence >= 0.85
- face width >= 80 px
- face height >= 80 px
- reprojection error <= 18 px
- candidate window = most recent 12 valid observations
- minimum valid observations = 12
- yaw range <= 6°
- pitch range <= 6°
- roll range <= 6°
- yaw MAD <= 2.5°
- pitch MAD <= 2.5°
- roll MAD <= 2.5°
- acquisition gaps <= 3
- >3 acquisition gaps clear the candidate window
- component-wise median reference
- immutable reference after establishment
- no reference updating during challenge movement

PASS 3D continues to use:

`relative_pose = current_pose - immutable_reference`

The existing movement, target, trajectory, hold, return, face-loss, and multiple-face rules were not changed.

## Regression coverage added

Added tests for:

- stable 0° reference
- stable -16° reference
- stable +16° reference
- stable non-zero reference with small pitch/roll offsets
- unstable yaw range > 6°
- high yaw MAD
- pitch/roll quality-envelope rejection
- detector confidence/reprojection/multiple-face rejection
- supplied 9-frame physical cluster remains insufficient for establishment
- clearly +20° stable reference rejected by the reference-center envelope
- non-zero reference followed by +20° relative movement
- non-zero reference followed by -20° relative movement

## Validation

Full Python unittest suite:

`Ran 117 tests in 0.833s`

Result:

`OK`

Python compilation:

`python -m compileall -q biometric_service`

Result:

`exit code 0`

The Python runtime emitted an unrelated local artifact-tool spreadsheet warmup diagnostic during startup, but it did not affect the test or compilation result.

## Physical webcam validation

No new physical webcam run was executed by this implementation step.

The supplied physical runs remain user-performed evidence. The new code has not been represented as physically validated.

## Files changed

1. `biometric_service/temporal_reference.py`
   - changed only reference-acquisition yaw eligibility logic.

2. `biometric_service/test_temporal_reference.py`
   - added/updated reference-acquisition regression tests.

3. `biometric_service/test_active_challenge.py`
   - added non-zero-reference relative-movement regression tests.

No PASS 4/passive PAD files were changed.
