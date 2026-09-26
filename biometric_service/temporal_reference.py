from __future__ import annotations

"""PASS 3C temporal neutral/reference estimation.

This module is deliberately independent of the active challenge state machine.
It provides two reusable operations for PASS 3D and later integration:

1. accumulate quality-filtered pose observations and establish a robust session
   reference only after temporal stability and raw neutral eligibility are met;
2. express subsequent pose observations relative to that confirmed reference.

It does not alter YuNet, solvePnP, Rodrigues/Euler conversion, SFace, PAD, or
challenge-state transitions.
"""

from dataclasses import dataclass, field
from math import isfinite
from statistics import median
from typing import Optional


# Existing pose-quality ceiling is intentionally preserved.
MAX_REPROJECTION_ERROR = 18.0
MIN_FACE_WIDTH = 80.0
MIN_FACE_HEIGHT = 80.0

# A modest detector-confidence floor prevents very weak detections from
# becoming calibration evidence. It is a quality gate, not a challenge
# threshold. The user's observed webcam confidence (~0.90-0.94) is comfortably
# above this value.
MIN_FACE_CONFIDENCE = 0.85

# Pitch/roll retain the existing raw-neutral sanity envelope. Yaw is handled
# differently: PASS 3D establishes a user-specific yaw reference, so absolute
# yaw is not a per-frame neutral criterion. Instead, after temporal stability
# is demonstrated, the *median reference yaw* must remain inside a bounded
# moderate-offset envelope. This distinguishes a stable non-zero neutral pose
# from a clearly already-turned pose without accepting arbitrary yaw as neutral.
NEUTRAL_YAW_LIMIT = 12.0  # legacy/diagnostic compatibility name
NEUTRAL_PITCH_LIMIT = 12.0
NEUTRAL_ROLL_LIMIT = 12.0
MAX_REFERENCE_YAW_OFFSET = 18.0

# Temporal requirements. Values are frame counts, not milliseconds, because
# the browser capture cadence can vary. A later integration can add a wall-time
# bound without changing the estimator itself.
REFERENCE_WINDOW_VALID_SAMPLES = 12
REFERENCE_MIN_VALID_SAMPLES = 12
REFERENCE_MAX_YAW_RANGE = 6.0
REFERENCE_MAX_PITCH_RANGE = 6.0
REFERENCE_MAX_ROLL_RANGE = 6.0
REFERENCE_MAX_YAW_MAD = 2.5
REFERENCE_MAX_PITCH_MAD = 2.5
REFERENCE_MAX_ROLL_MAD = 2.5

# Short acquisition gaps are tolerated. Persistent loss must be handled by the
# future challenge state machine, not silently hidden by this reference module.
MAX_ACQUISITION_GAP = 3


@dataclass(frozen=True)
class ReferencePoseSample:
    """One pose observation plus the quality metadata needed for calibration."""

    yaw: float
    pitch: float
    roll: float
    reprojection_error: float
    face_confidence: float
    face_width: float
    face_height: float
    face_count: int = 1
    pose_valid: bool = True


@dataclass(frozen=True)
class RelativePose:
    yaw: float
    pitch: float
    roll: float


@dataclass(frozen=True)
class ReferenceEstimate:
    yaw: float
    pitch: float
    roll: float
    samples_used: int
    yaw_mad: float
    pitch_mad: float
    roll_mad: float


@dataclass
class TemporalReferenceEstimator:
    """Collect and validate observations for one session reference.

    The estimator is intentionally conservative:
    - bad observations never enter the calibration set;
    - pitch/roll retain their existing raw-neutral sanity checks;
    - yaw candidates are allowed to be moderately non-zero, but the final
      stable median reference must remain within a bounded offset envelope;
    - the most recent valid observations must remain temporally stable;
    - the accepted reference is the component-wise median, not the mean.
    """

    window_size: int = REFERENCE_WINDOW_VALID_SAMPLES
    min_valid_samples: int = REFERENCE_MIN_VALID_SAMPLES
    max_acquisition_gap: int = MAX_ACQUISITION_GAP
    _window: list[ReferencePoseSample] = field(default_factory=list)
    _gap: int = 0
    _reference: Optional[ReferenceEstimate] = None

    @property
    def established(self) -> bool:
        return self._reference is not None

    @property
    def reference(self) -> Optional[ReferenceEstimate]:
        return self._reference

    @property
    def valid_candidate_count(self) -> int:
        return len(self._window)

    @property
    def acquisition_gap(self) -> int:
        return self._gap

    def reset(self) -> None:
        self._window.clear()
        self._gap = 0
        self._reference = None

    def observe(self, sample: ReferencePoseSample) -> str:
        """Consume one observation and return a diagnostic reason/state.

        Possible returns include ACCEPTED_CANDIDATE, WAITING_FOR_STABILITY,
        REFERENCE_ESTABLISHED, and explicit rejection reasons.
        """
        if self._reference is not None:
            return "REFERENCE_ALREADY_ESTABLISHED"

        reason = self._quality_rejection_reason(sample)
        if reason is not None:
            self._gap += 1
            if self._gap > self.max_acquisition_gap:
                # Do not retain an old neutral window across a persistent loss.
                self._window.clear()
            return reason

        self._gap = 0
        self._window.append(sample)
        if len(self._window) > self.window_size:
            self._window.pop(0)

        if len(self._window) < self.min_valid_samples:
            return "WAITING_FOR_STABILITY"

        if not self._stable(self._window):
            return "WAITING_FOR_STABILITY"

        candidate_reference = self._make_reference(self._window)
        if abs(candidate_reference.yaw) > MAX_REFERENCE_YAW_OFFSET:
            return "REFERENCE_YAW_OFFSET_TOO_LARGE"

        self._reference = candidate_reference
        return "REFERENCE_ESTABLISHED"

    def relative(self, sample: ReferencePoseSample) -> Optional[RelativePose]:
        """Return pose relative to the confirmed reference, or None before it."""
        if self._reference is None:
            return None
        return RelativePose(
            yaw=sample.yaw - self._reference.yaw,
            pitch=sample.pitch - self._reference.pitch,
            roll=sample.roll - self._reference.roll,
        )

    @staticmethod
    def _quality_rejection_reason(sample: ReferencePoseSample) -> Optional[str]:
        values = (
            sample.yaw,
            sample.pitch,
            sample.roll,
            sample.reprojection_error,
            sample.face_confidence,
            sample.face_width,
            sample.face_height,
        )
        if not all(isfinite(float(value)) for value in values):
            return "INVALID_POSE_VALUES"
        if not sample.pose_valid:
            return "POSE_INVALID"
        if sample.face_count != 1:
            return "MULTIPLE_FACES" if sample.face_count > 1 else "NO_FACE"
        if sample.face_confidence < MIN_FACE_CONFIDENCE:
            return "FACE_CONFIDENCE_TOO_LOW"
        if sample.face_width < MIN_FACE_WIDTH or sample.face_height < MIN_FACE_HEIGHT:
            return "FACE_TOO_SMALL"
        if sample.reprojection_error > MAX_REPROJECTION_ERROR:
            return "REPROJECTION_ERROR_TOO_HIGH"

        # Yaw is intentionally not rejected per observation here. A user's
        # legitimate neutral posture can have a stable, moderately non-zero
        # model-relative yaw. The final candidate median is bounded after the
        # full stability window is evaluated, so noisy/turned clusters cannot
        # establish merely because individual samples are finite and valid.
        if abs(sample.pitch) > NEUTRAL_PITCH_LIMIT:
            return "NOT_RAW_NEUTRAL_PITCH"
        if abs(sample.roll) > NEUTRAL_ROLL_LIMIT:
            return "NOT_RAW_NEUTRAL_ROLL"
        return None

    @staticmethod
    def _mad(values: list[float]) -> float:
        center = median(values)
        return float(median([abs(value - center) for value in values]))

    @classmethod
    def _stable(cls, samples: list[ReferencePoseSample]) -> bool:
        yaws = [sample.yaw for sample in samples]
        pitches = [sample.pitch for sample in samples]
        rolls = [sample.roll for sample in samples]
        return (
            max(yaws) - min(yaws) <= REFERENCE_MAX_YAW_RANGE
            and max(pitches) - min(pitches) <= REFERENCE_MAX_PITCH_RANGE
            and max(rolls) - min(rolls) <= REFERENCE_MAX_ROLL_RANGE
            and cls._mad(yaws) <= REFERENCE_MAX_YAW_MAD
            and cls._mad(pitches) <= REFERENCE_MAX_PITCH_MAD
            and cls._mad(rolls) <= REFERENCE_MAX_ROLL_MAD
        )

    @classmethod
    def _make_reference(cls, samples: list[ReferencePoseSample]) -> ReferenceEstimate:
        yaws = [sample.yaw for sample in samples]
        pitches = [sample.pitch for sample in samples]
        rolls = [sample.roll for sample in samples]
        return ReferenceEstimate(
            yaw=float(median(yaws)),
            pitch=float(median(pitches)),
            roll=float(median(rolls)),
            samples_used=len(samples),
            yaw_mad=cls._mad(yaws),
            pitch_mad=cls._mad(pitches),
            roll_mad=cls._mad(rolls),
        )
