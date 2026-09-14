import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { CaseRecord, CheckStatus, Decision, ScanCheck } from "./types";
import { calculateRisk } from "./risk-engine";

const InputSchema = z.object({
  imageDataUrl: z.string().min(32).max(5_500_000),
  fileName: z.string().min(1).max(200),
  watchlistNames: z.array(z.string().max(120)).max(40),
  autoHoldWatchlist: z.boolean(),
});

type ModelResult = {
  documentType?: string;
  documentNumber?: string | null;
  holderName?: string | null;
  nationality?: string | null;
  dateOfBirth?: string | null;
  expiryDate?: string | null;
  expiryStatus?: string;
  ocrConfidence?: number;
  tamperAnalysis?: { status?: string; notes?: string };
  faceMatch?: { status?: string; score?: number | null; notes?: string };
  liveness?: { status?: string; notes?: string };
  rationale?: string;
  flags?: string[];
};

function asStatus(value: string | undefined, fallback: CheckStatus): CheckStatus {
  if (value === "passed" || value === "review" || value === "fail" || value === "unavailable") {
    return value;
  }
  return fallback;
}

function asDecision(value: string | undefined, score: number): Decision {
  if (value === "safe" || value === "manual" || value === "hold") return value;
  if (score >= 80) return "hold";
  if (score >= 40) return "manual";
  return "safe";
}

function parseModelJson(text: string): ModelResult {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  return JSON.parse(stripped) as ModelResult;
}

function fallbackFromImage(imageDataUrl: string): ModelResult {
  const commaIndex = imageDataUrl.indexOf(",");
  const base64 = commaIndex >= 0 ? imageDataUrl.slice(commaIndex + 1) : imageDataUrl;

  // Create several independent deterministic signals from different
  // regions of the uploaded image data.
  const length = base64.length;

  const samplePositions = [
    0,
    Math.floor(length * 0.2),
    Math.floor(length * 0.4),
    Math.floor(length * 0.6),
    Math.floor(length * 0.8),
  ];

  function hashSample(start: number, size: number): number {
    const sample = base64.slice(start, start + size);

    let hash = 2166136261;

    for (let i = 0; i < sample.length; i += 1) {
      hash ^= sample.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }

    return hash >>> 0;
  }

  const signals = samplePositions.map((position) => hashSample(position, 6000));

  const [signalA, signalB, signalC, signalD, signalE] = signals;

  // Image-size signal.
  const sizeSignal = length % 1000;

  // OCR confidence.
  // Larger and more varied images can produce different simulated
  // extraction confidence while remaining deterministic.
  const ocrConfidence = 55 + ((signalA ^ signalC ^ sizeSignal) % 46);

  // Expiry status.
  const expiryOptions = ["valid", "valid", "valid", "unknown", "expired"] as const;

  const expiryStatus = expiryOptions[(signalB ^ signalE) % expiryOptions.length];

  // Tamper status.
  const tamperOptions = ["passed", "passed", "review", "review", "fail"] as const;

  const tamperStatus = tamperOptions[(signalA ^ signalD) % tamperOptions.length];

  // Simulated document classification.
  const documentTypes = ["passport", "visa", "permit"] as const;

  const documentType = documentTypes[(signalB ^ signalC) % documentTypes.length];

  // Generate a stable simulated document number.
  const documentNumberValue = (signalA ^ signalB ^ signalD) % 900000;

  // Simulated face comparison estimate.
  const faceScore = 50 + ((signalC ^ signalE) % 46);

  return {
    documentType,

    documentNumber: `SIM-${String(100000 + documentNumberValue)}`,

    holderName: null,
    nationality: null,
    dateOfBirth: null,

    expiryDate:
      expiryStatus === "expired" ? "2024-01-01" : expiryStatus === "valid" ? "2028-06-01" : null,

    expiryStatus,

    ocrConfidence,

    tamperAnalysis: {
      status: tamperStatus,
      notes:
        tamperStatus === "fail"
          ? "Training simulation detected significant visual anomalies."
          : tamperStatus === "review"
            ? "Training simulation detected features requiring manual review."
            : "Training simulation detected no significant visual anomalies.",
    },

    faceMatch: {
      status: "review",
      score: faceScore,
      notes: "Estimated from image-derived simulation signals; not a biometric verification.",
    },

    liveness: {
      status: "unavailable",
      notes: "Liveness cannot be verified from a still image.",
    },

    rationale:
      "AI service unavailable. Training-mode analysis uses multiple deterministic image-derived simulation signals.",

    flags: ["Simulated result", "AI service unavailable"],
  };
}

function watchlistMatch(name: string | null | undefined, list: string[]): string | null {
  if (!name) return null;
  const needle = name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!needle) return null;
  for (const entry of list) {
    const hay = entry
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!hay) continue;
    if (needle.includes(hay) || hay.includes(needle)) return entry;
  }
  return null;
}

function buildRecord(
  model: ModelResult,
  fileName: string,
  watchlistNames: string[],
  autoHoldWatchlist: boolean,
): Omit<CaseRecord, "id" | "createdAt"> {
  const flags = [...(model.flags ?? [])];

  const hit = watchlistMatch(model.holderName, watchlistNames);
  const watchlistHit = Boolean(hit);

  if (hit) {
    flags.unshift(`Watchlist match: ${hit}`);
  }

  const ocr = Math.max(0, Math.min(100, Math.round(model.ocrConfidence ?? 0)));

  const expiryStatus =
    model.expiryStatus === "expired"
      ? "expired"
      : model.expiryStatus === "valid"
        ? "valid"
        : "unknown";

  const tamperStatus =
    model.tamperAnalysis?.status === "passed"
      ? "passed"
      : model.tamperAnalysis?.status === "fail"
        ? "fail"
        : model.tamperAnalysis?.status === "review"
          ? "review"
          : "unknown";

  const faceStatus =
    model.faceMatch?.status === "passed"
      ? "passed"
      : model.faceMatch?.status === "fail"
        ? "fail"
        : model.faceMatch?.status === "review"
          ? "review"
          : "unknown";

  const livenessStatus =
    model.liveness?.status === "passed"
      ? "passed"
      : model.liveness?.status === "fail"
        ? "fail"
        : model.liveness?.status === "review"
          ? "review"
          : "unavailable";

  const risk = calculateRisk({
    ocrConfidence: ocr,
    expiryStatus,
    tamperStatus,
    faceStatus,
    livenessStatus,

    documentTypeKnown: Boolean(model.documentType) && model.documentType !== "unknown",

    documentNumberPresent: Boolean(model.documentNumber?.trim()),

    holderNamePresent: Boolean(model.holderName?.trim()),

    nationalityPresent: Boolean(model.nationality?.trim()),

    dobPresent: Boolean(model.dateOfBirth?.trim()),

    expiryDatePresent: Boolean(model.expiryDate?.trim()),

    watchlistHit,
  });

  for (const reason of risk.reasons) {
    if (!flags.includes(reason)) {
      flags.push(reason);
    }
  }

  const faceScore = model.faceMatch?.score ?? null;

  const checks: ScanCheck[] = [
    {
      id: "ocr",
      label: "OCR & data extraction",
      status: ocr >= 85 ? "passed" : ocr >= 60 ? "review" : "fail",
      detail: `${ocr}% confidence`,
    },

    {
      id: "expiry",
      label: "Document expiry",
      status: expiryStatus === "expired" ? "fail" : expiryStatus === "valid" ? "passed" : "review",
      detail:
        expiryStatus === "expired"
          ? "Expired"
          : model.expiryDate
            ? `Valid until ${model.expiryDate}`
            : "Not confirmed",
    },

    {
      id: "tamper",
      label: "Tamper analysis",
      status: tamperStatus === "unknown" ? "review" : tamperStatus,
      detail: model.tamperAnalysis?.notes ?? "No detailed tamper explanation available",
    },

    {
      id: "face",
      label: "Face match",
      status: faceStatus === "unknown" ? "review" : faceStatus,
      detail:
        faceScore != null
          ? `${Math.round(faceScore)}% match`
          : (model.faceMatch?.notes ?? "Single image — estimated"),
    },

    {
      id: "liveness",
      label: "Liveness detection",
      status: livenessStatus,
      detail: model.liveness?.notes ?? "Still image only",
    },
  ];

  return {
    documentType: (model.documentType ?? "unknown").toLowerCase(),

    documentNumber: model.documentNumber?.trim() || "UNKNOWN",

    holderName: model.holderName ?? null,

    nationality: model.nationality ?? null,

    dateOfBirth: model.dateOfBirth ?? null,

    expiryDate: model.expiryDate ?? null,

    riskScore: risk.score,

    decision: risk.decision,

    checks,

    rationale:
      risk.reasons.length > 0
        ? risk.reasons.join(". ") + "."
        : "No significant risk indicators were detected.",

    flags,

    fileName,

    watchlistHit,
  };
}

export const analyzeDocument = createServerFn({ method: "POST" })
  .validator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      return {
        ok: true as const,
        simulated: true,
        record: buildRecord(
          fallbackFromImage(data.imageDataUrl),
          data.fileName,
          data.watchlistNames,
          data.autoHoldWatchlist,
        ),
      };
    }

    const prompt = `You are a document-forensics assistant inside a BORDER CONTROL TRAINING SIMULATOR called BorderShield.
Analyze the uploaded image. This output is NEVER used for a real identity decision.

Do not calculate a final risk score.
Do not choose the final decision.
Return only observations and evidence.
The application will calculate the final risk score and decision.

Return JSON only with this shape:
{
  "documentType": "passport" | "visa" | "permit" | "id" | "unknown",
  "documentNumber": string | null,
  "holderName": string | null,
  "nationality": string | null,
  "dateOfBirth": "YYYY-MM-DD" | null,
  "expiryDate": "YYYY-MM-DD" | null,
  "expiryStatus": "valid" | "expired" | "unknown",
  "ocrConfidence": number,
  "tamperAnalysis": { "status": "passed" | "review" | "fail", "notes": string },
  "faceMatch": { "status": "passed" | "review" | "fail", "score": number | null, "notes": string },
  "liveness": { "status": "passed" | "review" | "unavailable", "notes": string },
  "rationale": string,
  "flags": string[]
}

Rules:
- If the image is not a travel document, set documentType to "unknown" and explain why in the rationale or flags.
- Do not invent MRZ, document numbers, names, or dates that are not visible. Use null when unseen.
- Face match on a single still image should usually be "review" or an estimate, never a confident biometric verification.
- Liveness is "unavailable" for a still photo.
- Report uncertainty honestly using "unknown", "review", or null where appropriate.
- Keep rationale to 2 short sentences.
`;

    try {
      const res = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "grok-4.5",
          temperature: 0.2,
          max_tokens: 900,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                {
                  type: "image_url",
                  image_url: { url: data.imageDataUrl, detail: "high" },
                },
              ],
            },
          ],
        }),
      });

      if (!res.ok) {
        return {
          ok: true as const,
          simulated: true,
          record: buildRecord(
            fallbackFromImage(data.imageDataUrl),
            data.fileName,
            data.watchlistNames,
            data.autoHoldWatchlist,
          ),
        };
      }

      const body = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const text = body.choices?.[0]?.message?.content ?? "";
      const parsed = parseModelJson(text);
      return {
        ok: true as const,
        simulated: false,
        record: buildRecord(parsed, data.fileName, data.watchlistNames, data.autoHoldWatchlist),
      };
    } catch {
      return {
        ok: true as const,
        simulated: true,
        record: buildRecord(
          fallbackFromImage(data.imageDataUrl),
          data.fileName,
          data.watchlistNames,
          data.autoHoldWatchlist,
        ),
      };
    }
  });
