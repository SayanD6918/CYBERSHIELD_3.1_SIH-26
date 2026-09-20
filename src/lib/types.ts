export type Decision = "safe" | "manual" | "hold";

export type FinalDecision = "VERIFIED" | "NOT_VERIFIED" | "UNCERTAIN" | "MANUAL_REVIEW";

export type CheckStatus = "passed" | "review" | "fail" | "unavailable";

export type EvidenceStatus = CheckStatus | "unknown";

export type EvidenceBase = {
  status: EvidenceStatus;
  confidence: number | null;
  method: string;
  issues: string[];
};

export type DocumentEvidence = EvidenceBase & {
  documentType: string | null;
  documentNumber: string | null;
  quality?: {
    width: number | null;
    height: number | null;
    sharpness: number | null;
    brightness: number | null;
    resolutionOk: boolean | null;
  };
  fields: {
    holderName: string | null;
    nationality: string | null;
    dateOfBirth: string | null;
    expiryDate: string | null;
  };
};

export type MRZEvidence = EvidenceBase & {
  format: "TD3" | "unknown";
  detected: boolean;
  lines: number;
  checks: {
    documentNumber: boolean | null;
    dateOfBirth: boolean | null;
    expiryDate: boolean | null;
    optionalData: boolean | null;
    composite: boolean | null;
  };
  fieldConsistency: {
    documentNumber: boolean | null;
    nationality: boolean | null;
    dateOfBirth: boolean | null;
    expiryDate: boolean | null;
    holderName: boolean | null;
  };
};

export type FaceEvidence = EvidenceBase & {
  similarity: number | null;
  distance?: number | null;
  threshold: number | null;
  uncertainBand?: number | null;
  metric?: "cosine_similarity" | "norm_l2" | "unknown";
  model?: string | null;
  modelVersion?: string | null;
  calibrated?: boolean;
  source: "document" | "live" | "comparison" | "unknown";
  measurements?: Record<string, number | string | boolean | null>;
};

export type LivenessEvidence = EvidenceBase & {
  livenessConfidence: number | null;
  spoofProbability: number | null;
  source: "passive" | "active" | "combined" | "unknown";
  measurements?: Record<string, number | string | boolean | null>;
};

export type ChallengeEvidence = EvidenceBase & {
  challenge: string | null;
  completed: boolean | null;
  requestedAction?: string | null;
  initialPose?: { yaw: number; pitch: number; roll: number } | null;
  observedPose?: { yaw: number; pitch: number; roll: number } | null;
  movementDetected?: boolean;
  challengeStatus?: "PASSED" | "FAILED" | "NOT_RUN";
  failureReason?: string | null;
  source?: "active" | "unknown";
  measurements: Record<string, number | string | boolean | null>;
};

export type IdentityEvidence = EvidenceBase & {
  provider: string;
  authoritative: boolean;
  provenance: "REAL" | "DEMO";
  matchedFields: number;
  mismatchedFields: number;
  measurements?: Record<string, number | string | boolean | null>;
};

export type RiskEvidence = EvidenceBase & {
  score: number | null;
  decision: Decision | null;
  finalDecision?: FinalDecision | null;
  reasons: string[];
  measurements?: Record<string, number | string | boolean | null>;
};

export type ScanCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
};

export type DatabaseVerification = {
  provider?: string;
  authoritative?: boolean;
  provenance?: "REAL" | "DEMO";
  status: "passed" | "review" | "fail" | "unavailable";
  matchedFields: number;
  mismatchedFields: number;
  issues: string[];
};

export type BiometricResult = {
  provenance?: "REAL" | "DEMO";
  livenessStatus: "LIVE" | "SPOOF" | "UNCERTAIN" | "UNAVAILABLE";
  livenessConfidence: number | null;
  faceMatchStatus: "MATCH" | "NO_MATCH" | "UNCERTAIN" | "UNAVAILABLE";
  faceSimilarity: number | null;
  faceThreshold: number;
  challenge?: string;
  evidence?: {
    face?: FaceEvidence;
    liveness?: LivenessEvidence;
    challenge?: ChallengeEvidence;
  };
};

export type CaseRecord = {
  provenance?: "REAL" | "DEMO";
  finalDecision?: FinalDecision;
  id: string;
  createdAt: string;
  documentType: string;
  documentNumber: string;
  holderName: string | null;
  nationality: string | null;
  dateOfBirth: string | null;
  expiryDate: string | null;
  riskScore: number;
  decision: Decision;
  checks: ScanCheck[];
  rationale: string;
  flags: string[];
  fileName: string;
  watchlistHit: boolean;
  databaseVerification?: DatabaseVerification;
  biometric?: BiometricResult;
  evidence?: {
    document?: DocumentEvidence;
    mrz?: MRZEvidence;
    face?: FaceEvidence;
    liveness?: LivenessEvidence;
    challenge?: ChallengeEvidence;
    identity?: IdentityEvidence;
    risk?: RiskEvidence;
  };
};

export type WatchlistEntry = {
  id: string;
  name: string;
  reason: string;
  addedAt: string;
};

export type OfficerSettings = {
  officerName: string;
  officerRole: string;
  checkpoint: string;
  autoHoldWatchlist: boolean;
};
