import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { buildRecord, readDocument } from "./analyze-document.ts";
import { biometricResultFromService } from "./biometric-result.ts";
import { finalizeVerification } from "./finalize-verification.ts";
import type { DocumentImageQuality } from "./document-image.ts";
import { selectAuthoritativeInput, type AuthorityInput } from "./authoritative-contract.ts";

const DATA_URL = z.string().min(32).max(5_500_000).regex(/^data:image\/[a-zA-Z0-9.+-]+;base64,/);
const IMAGE_QUALITY = z.object({
  width: z.number().finite(), height: z.number().finite(), sharpness: z.number().finite(),
  brightness: z.number().finite(), resolutionOk: z.boolean(), blurLikely: z.boolean(),
  brightnessStatus: z.enum(["dark", "balanced", "bright"]),
}).nullable().optional();
const AuthorityInputSchema = z.object({
  documentImageDataUrl: DATA_URL, fileName: z.string().min(1).max(200), imageQuality: IMAGE_QUALITY,
  referenceFrames: z.array(DATA_URL).min(1).max(24), leftFrames: z.array(DATA_URL).min(1).max(24),
  rightFrames: z.array(DATA_URL).min(1).max(24), straightFrames: z.array(DATA_URL).min(1).max(24),
});

function serverWatchlistNames(): string[] {
  return (process.env.CYBERSHIELD_SERVER_WATCHLIST_NAMES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 100);
}

function serverAutoHoldWatchlist(): boolean {
  return process.env.CYBERSHIELD_AUTO_HOLD_WATCHLIST !== "false";
}

function biometricUrl(): string {
  const value = process.env.BIOMETRIC_SERVICE_URL ?? process.env.VITE_BIOMETRIC_URL;
  if (process.env.NODE_ENV === "production" && !value) {
    throw new Error("BIOMETRIC_SERVICE_URL must be explicitly configured in production.");
  }
  return value ?? "http://127.0.0.1:8765";
}

async function biometricPost(path: string, body: unknown): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(`${biometricUrl()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: any = null;
    try { payload = JSON.parse(text); } catch { payload = null; }
    if (!response.ok) {
      throw new Error(`Biometric service returned ${response.status} for ${path}: ${payload?.detail ?? text.slice(0, 300)}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function biometricHealth(): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${biometricUrl()}/health`, { signal: controller.signal });
    const payload = await response.json();
    if (!response.ok) throw new Error(`Biometric health check returned ${response.status}.`);
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function toImageQuality(value: AuthorityInput["imageQuality"]): DocumentImageQuality | null {
  return value ? {
    width: value.width,
    height: value.height,
    sharpness: value.sharpness,
    brightness: value.brightness,
    resolutionOk: value.resolutionOk,
    blurLikely: value.blurLikely,
    brightnessStatus: value.brightnessStatus,
  } : null;
}

/**
 * Security boundary: this function accepts raw capture evidence only. It does
 * not accept client-calculated biometric results, risk scores, decisions,
 * watchlist hits, or case records. All security-sensitive evidence is
 * recomputed before finalization.
 */
export const authoritativeVerification = createServerFn({ method: "POST" })
  .validator((input: unknown) => AuthorityInputSchema.parse(input))
  .handler(async ({ data }) => {
    data = selectAuthoritativeInput(data);
    const health = await biometricHealth();
    if (health.face_detector_loaded !== true || health.face_recognizer_loaded !== true) {
      throw new Error("Trusted biometric service is not ready: YuNet/SFace model unavailable.");
    }

    const documentAnalysis = await readDocument(data.documentImageDataUrl, toImageQuality(data.imageQuality));
    const watchlistNames = serverWatchlistNames();
    const autoHoldWatchlist = serverAutoHoldWatchlist();
    const pending = buildRecord(documentAnalysis, data.fileName, watchlistNames, autoHoldWatchlist);

    const challenge = await biometricPost("/api/active-challenge", {
      reference_frames_data_urls: data.referenceFrames,
      steps: [
        { action: "TURN_LEFT", frames_data_urls: data.leftFrames },
        { action: "TURN_RIGHT", frames_data_urls: data.rightFrames },
        { action: "LOOK_STRAIGHT", frames_data_urls: data.straightFrames },
      ],
    });

    const livenessFrames = [...data.referenceFrames, ...data.leftFrames.slice(0, Math.max(0, 24 - data.referenceFrames.length))];
    const liveness = await biometricPost("/api/liveness", {
      frames_data_urls: livenessFrames,
    });

    const allFrames = [...data.referenceFrames, ...data.leftFrames, ...data.rightFrames, ...data.straightFrames];
    const liveFrames = allFrames.slice(-24);
    const match = await biometricPost("/api/face-match", {
      document_image_data_url: data.documentImageDataUrl,
      document_type: pending.documentType,
      live_frames_data_urls: liveFrames,
    });

    const biometric = biometricResultFromService(liveness, challenge, match);
    const finalized = finalizeVerification(pending, biometric, { autoHoldWatchlist });
    const createdAt = new Date().toISOString();
    const id = `CASE-${createdAt.slice(0, 4)}-${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;

    return {
      ok: true as const,
      authority: "SERVER",
      authoritative: true,
      record: {
        ...finalized,
        id,
        createdAt,
      },
      security: {
        clientDecisionAccepted: false,
        clientRiskAccepted: false,
        clientWatchlistAccepted: false,
        serverWatchlistConfigured: watchlistNames.length > 0,
      },
    };
  });
