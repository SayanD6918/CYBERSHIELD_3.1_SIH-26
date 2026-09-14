export type Decision = "safe" | "manual" | "hold";

export type CheckStatus = "passed" | "review" | "fail" | "unavailable";

export type ScanCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
};

export type DatabaseVerification = {
  status: "passed" | "review" | "fail" | "unavailable";
  matchedFields: number;
  mismatchedFields: number;
  issues: string[];
};

export type BiometricResult = {
  livenessStatus: "LIVE" | "SPOOF" | "UNCERTAIN" | "UNAVAILABLE";
  livenessConfidence: number | null;
  faceMatchStatus: "MATCH" | "NO_MATCH" | "UNCERTAIN" | "UNAVAILABLE";
  faceSimilarity: number | null;
  faceThreshold: number;
  challenge?: string;
};

export type CaseRecord = {
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
