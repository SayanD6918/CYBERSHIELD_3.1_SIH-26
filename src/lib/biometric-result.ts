import type { BiometricResult, FaceEvidence } from "./types.ts";

export function biometricResultFromService(
  liveness: any,
  challenge: any,
  match: any,
): BiometricResult {
  const faceSimilarity = typeof match.similarity_score === "number" ? match.similarity_score : null;
  const faceThreshold = typeof match.threshold === "number" ? match.threshold : null;
  const livenessStatus = liveness.liveness_status === "LIVE"
    ? "LIVE"
    : liveness.liveness_status === "SPOOF"
      ? "SPOOF"
      : "UNCERTAIN";
  const challengePassed = challenge.challenge_status === "PASSED";
  const challengeStepEvidence = Array.isArray(challenge.steps) ? challenge.steps : [];
  const faceEvidence: FaceEvidence = {
    status:
      match.face_match_status === "MATCH"
        ? "passed"
        : match.face_match_status === "NO_MATCH"
          ? "fail"
          : "review",
    confidence: null,
    method: match.matcher ?? "sface-embedding",
    issues: Array.isArray(match.issues) ? match.issues : [],
    similarity: faceSimilarity,
    distance: typeof match.distance === "number" ? match.distance : null,
    threshold: faceThreshold,
    uncertainBand: typeof match.uncertain_band === "number" ? match.uncertain_band : null,
    metric: match.metric ?? "cosine_similarity",
    model: match.model ?? null,
    modelVersion: match.model_version ?? null,
    calibrated: match.calibrated === true,
    source: "comparison",
    measurements: {
      documentPortrait: match.document_portrait ? JSON.stringify(match.document_portrait) : null,
      documentFace: match.document_face ? JSON.stringify(match.document_face) : null,
      liveFace: match.live_face ? JSON.stringify(match.live_face) : null,
      probeFrame: match.probe_frame ? JSON.stringify(match.probe_frame) : null,
      documentEmbeddingGenerated: match.document?.embedding_ready === true,
      liveEmbeddingGenerated: match.live?.embedding_ready === true,
      documentType: match.document?.type ?? null,
      portraitDetected: match.document?.portrait_detected === true,
      portraitCandidateCount: typeof match.document?.portrait_candidate_count === "number" ? match.document.portrait_candidate_count : null,
      documentFaceDetected: match.document?.document_face_detected === true,
      liveFaceDetected: match.live?.face_detected === true,
      liveFaceCount: typeof match.live?.face_count === "number" ? match.live.face_count : null,
      framesReceived: typeof match.live?.frames_received === "number" ? match.live.frames_received : null,
      framesWithFace: typeof match.live?.frames_with_face === "number" ? match.live.frames_with_face : null,
      selectedLiveFrame: typeof match.probe_frame?.selected_frame_index === "number" ? match.probe_frame.selected_frame_index : null,
      documentFaceQuality: match.document_face ? JSON.stringify(match.document_face) : null,
      liveFaceQuality: match.live?.face_quality ? JSON.stringify(match.live.face_quality) : null,
    },
  };

  const liveFaceDetected = match.live?.face_detected === true;
  const liveFaceCount = typeof match.live?.face_count === "number" ? match.live.face_count : null;
  const liveCapturePassed = liveFaceDetected && liveFaceCount === 1 && match.face_match_status !== "UNAVAILABLE";

  return {
    provenance: "REAL",
    livenessStatus,
    livenessConfidence: typeof liveness.confidence === "number" ? liveness.confidence : null,
    faceMatchStatus: match.face_match_status ?? "UNAVAILABLE",
    faceSimilarity,
    faceThreshold: faceThreshold ?? 0,
    liveCaptureStatus: liveCapturePassed ? "CAPTURED" : "UNCERTAIN",
    challenge: "TURN_LEFT → TURN_RIGHT → LOOK_STRAIGHT",
    evidence: {
      face: faceEvidence,
      liveness: {
        status: livenessStatus === "LIVE" ? "passed" : livenessStatus === "SPOOF" ? "fail" : "review",
        confidence: typeof liveness.confidence === "number" ? liveness.confidence : null,
        method: liveness.model ?? "Passive PAD",
        issues: Array.isArray(liveness.issues) ? liveness.issues : [],
        livenessConfidence: typeof liveness.confidence === "number" ? liveness.confidence : null,
        spoofProbability: typeof liveness.evidence?.pad?.spoof_probability_median === "number" ? liveness.evidence.pad.spoof_probability_median : null,
        source: "passive",
        measurements: {
          modelLoaded: liveness.model_loaded === true,
          modelValid: liveness.model_valid === true,
          calibrated: liveness.calibrated === true,
          framesAnalyzed: typeof liveness.evidence?.frames_analyzed === "number" ? liveness.evidence.frames_analyzed : null,
          faceCrops: typeof liveness.evidence?.face_crops === "number" ? liveness.evidence.face_crops : null,
          temporal: liveness.evidence?.temporal ? JSON.stringify(liveness.evidence.temporal) : null,
        },
      },
      challenge: {
        status: challengePassed ? "passed" : "fail",
        confidence: typeof challenge.confidence === "number" ? challenge.confidence : null,
        method: challenge.evidence?.pose_method ?? "YuNet-5-landmark + solvePnP(SQPNP)",
        issues: challenge.failure_reason ? [challenge.failure_reason] : [],
        source: "active",
        challenge: "TURN_LEFT → TURN_RIGHT → LOOK_STRAIGHT",
        completed: challengePassed,
        requestedAction: "TURN_LEFT → TURN_RIGHT → LOOK_STRAIGHT",
        initialPose: challenge.initial_pose ?? null,
        observedPose: challenge.observed_pose ?? null,
        movementDetected: challenge.movement_detected === true,
        challengeStatus: challengePassed ? "PASSED" : "FAILED",
        failureReason: challenge.failure_reason ?? null,
        measurements: {
          steps: JSON.stringify(challengeStepEvidence),
          framesReceived: typeof challenge.evidence?.frames_received === "number" ? challenge.evidence.frames_received : null,
          validPoseFrames: typeof challenge.evidence?.valid_pose_frames === "number" ? challenge.evidence.valid_pose_frames : null,
          yawConvention: challenge.evidence?.yaw_convention ?? null,
          reference: challenge.evidence?.reference ? JSON.stringify(challenge.evidence.reference) : null,
        },
      },
    },
  };
}
