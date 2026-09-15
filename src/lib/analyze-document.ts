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

async function analyzeWithLocalOcr(imageDataUrl: string): Promise<ModelResult> {
  const { execFile } = await import("node:child_process");
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { promisify } = await import("node:util");

  const execFileAsync = promisify(execFile);

  const tesseractCmd =
    process.env.TESSERACT_CMD || "C:\\Program Files\\Tesseract-OCR\\tesseract.exe";

  const match = imageDataUrl.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/s);

  if (!match) {
    throw new Error("Invalid image data URL.");
  }

  const mimeSubtype = match[1].toLowerCase();
  const base64Data = match[2];

  const extension = mimeSubtype === "png" ? ".png" : mimeSubtype === "webp" ? ".webp" : ".jpg";

  const tempDirectory = await mkdtemp(path.join(tmpdir(), "cybershield-ocr-"));

  const imagePath = path.join(tempDirectory, `document${extension}`);

  try {
    await writeFile(imagePath, Buffer.from(base64Data, "base64"));

    /*
     * First pass: normal OCR text.
     */
    const textResult = await execFileAsync(tesseractCmd, [imagePath, "stdout", "--psm", "6"], {
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });

    const text = String(textResult.stdout ?? "").trim();

    /*
     * Second pass: TSV gives us real word-level OCR confidence.
     */
    let ocrConfidence = 0;

    try {
      const tsvResult = await execFileAsync(
        tesseractCmd,
        [imagePath, "stdout", "--psm", "6", "tsv"],
        {
          windowsHide: true,
          maxBuffer: 4 * 1024 * 1024,
        },
      );

      const tsvLines = String(tsvResult.stdout ?? "").split(/\r?\n/);
      const confidences: number[] = [];

      for (const line of tsvLines.slice(1)) {
        const columns = line.split("\t");

        if (columns.length < 12) continue;

        const recognizedText = String(columns[11] ?? "").trim();
        const confidence = Number(columns[10]);

        if (!recognizedText) continue;
        if (!Number.isFinite(confidence) || confidence < 0) continue;

        // Ignore extremely weak/noisy OCR tokens.
        if (confidence < 25) continue;

        confidences.push(confidence);
      }

      if (confidences.length > 0) {
        confidences.sort((a, b) => a - b);

        const middle = Math.floor(confidences.length / 2);

        const medianConfidence =
          confidences.length % 2 === 0
            ? (confidences[middle - 1] + confidences[middle]) / 2
            : confidences[middle];

        ocrConfidence = Math.round(medianConfidence);
      }
    } catch {
      /*
       * OCR text is still usable even if the confidence pass fails.
       */
      ocrConfidence = 0;
    }


    const normalizedText = text.replace(/[|]/g, "I").replace(/\r/g, "").trim();

    const lines = normalizedText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    /*
     * Detect document type.
     */
    let documentType = "unknown";

    if (/\bpassport\b/i.test(normalizedText)) {
      documentType = "passport";
    } else if (/\bvisa\b/i.test(normalizedText)) {
      documentType = "visa";
    } else if (/\bpermit\b/i.test(normalizedText)) {
      documentType = "permit";
    } else if (lines.some((line) => /^P<[A-Z<]{3}/i.test(line.replace(/\s+/g, "")))) {
      documentType = "passport";
    }

    /*
     * Helper for labeled fields.
     */
    function fieldValue(pattern: RegExp): string | null {
      for (const line of lines) {
        const found = line.match(pattern);

        if (found?.[1]) {
          return found[1].replace(/<+/g, " ").replace(/\s+/g, " ").trim();
        }
      }

      return null;
    }

    /*
     * Parse dates such as:
     * 12 APR 1991
     * 18 AUG 2029
     */
    function parseHumanDate(value: string | null): string | null {
      if (!value) return null;

      const match = value.match(
        /^(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(\d{4})$/i,
      );

      if (!match) return null;

      const months: Record<string, string> = {
        JAN: "01",
        FEB: "02",
        MAR: "03",
        APR: "04",
        MAY: "05",
        JUN: "06",
        JUL: "07",
        AUG: "08",
        SEP: "09",
        OCT: "10",
        NOV: "11",
        DEC: "12",
      };

      const month = months[match[2].slice(0, 3).toUpperCase()];

      if (!month) return null;

      return `${match[3]}-${month}-${match[1].padStart(2, "0")}`;
    }

    /*
     * Find passport MRZ lines.
     */
    const mrzLines = lines
      .map((line) => line.replace(/\s+/g, "").toUpperCase())
      .filter((line) => /^[A-Z0-9<]{25,44}$/.test(line));

    let documentNumber: string | null = null;
    let holderName: string | null = null;
    let nationality: string | null = null;
    let dateOfBirth: string | null = null;
    let expiryDate: string | null = null;

    /*
     * Prefer clearly labeled fields.
     */
    documentNumber = fieldValue(/(?:No\.?|Number|Document\s*No\.?)\s*[:#]?\s*([A-Z0-9<\-]+)/i);

    const surname = fieldValue(/Surname\s*[:#]?\s*(.+)$/i);

    const givenNames = fieldValue(/Given\s+names?\s*[:#]?\s*(.+)$/i);

    if (surname || givenNames) {
      holderName = [surname, givenNames]
        .filter(Boolean)
        .join(" ")
        .replace(/<+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    nationality = fieldValue(/Nationality\s*[:#]?\s*(.+)$/i);

    dateOfBirth = parseHumanDate(fieldValue(/Date\s+of\s+birth\s*[:#]?\s*(.+)$/i));

    expiryDate = parseHumanDate(fieldValue(/Date\s+of\s+expiry\s*[:#]?\s*(.+)$/i));

    /*
     * Passport MRZ fallback.
     *
     * TD3 passport format:
     * Line 1 = P<CCC...
     * Line 2 = document number + nationality + DOB + sex + expiry...
     */
    if (mrzLines.length >= 2) {
      const mrz1 = mrzLines[mrzLines.length - 2];
      const mrz2 = mrzLines[mrzLines.length - 1];

      if (/^P</.test(mrz1) && mrz2.length >= 27) {
        documentType = "passport";

        if (!documentNumber) {
          const rawNumber = mrz2.slice(0, 9);

          documentNumber = rawNumber.replace(/<+$/, "").trim() || null;
        }

        if (!nationality) {
          nationality = mrz2.slice(10, 13).replace(/</g, "").trim() || null;
        }

        if (!dateOfBirth) {
          const rawDob = mrz2.slice(13, 19);

          if (/^\d{6}$/.test(rawDob)) {
            const yy = Number(rawDob.slice(0, 2));
            const mm = rawDob.slice(2, 4);
            const dd = rawDob.slice(4, 6);

            const year = yy >= 50 ? 1900 + yy : 2000 + yy;

            dateOfBirth = `${year}-${mm}-${dd}`;
          }
        }

        if (!expiryDate) {
          const rawExpiry = mrz2.slice(21, 27);

          if (/^\d{6}$/.test(rawExpiry)) {
            const yy = Number(rawExpiry.slice(0, 2));
            const mm = rawExpiry.slice(2, 4);
            const dd = rawExpiry.slice(4, 6);

            const year = yy >= 50 ? 1900 + yy : 2000 + yy;

            expiryDate = `${year}-${mm}-${dd}`;
          }
        }

        if (!holderName) {
          const nameField = mrz1.slice(5);

          const nameParts = nameField.split("<<");

          const surnamePart = nameParts[0]?.replace(/<+/g, " ").trim() || "";

          const givenPart =
            nameParts.slice(1).join(" ").replace(/<+/g, " ").replace(/\s+/g, " ").trim() || "";

          holderName = [surnamePart, givenPart].filter(Boolean).join(" ").trim() || null;
        }
      }
    }

    /*
     * Determine expiry status from the extracted date.
     */
    let expiryStatus = "unknown";

    if (expiryDate) {
      const expiry = new Date(`${expiryDate}T23:59:59`);
      const now = new Date();

      if (!Number.isNaN(expiry.getTime())) {
        expiryStatus = expiry >= now ? "valid" : "expired";
      }
    }

    /*
     * OCR itself does NOT prove that a document has not been tampered with.
     * Therefore we deliberately report review instead of inventing a
     * successful tamper result.
     */
    const extractedFieldCount = [
      documentNumber,
      holderName,
      nationality,
      dateOfBirth,
      expiryDate,
    ].filter(Boolean).length;

    if (ocrConfidence === 0) {
      ocrConfidence = Math.min(95, 45 + extractedFieldCount * 10);
    }

    const flags: string[] = ["Local Tesseract OCR"];

    if (mrzLines.length >= 2) {
      flags.push("Passport MRZ detected");
    }

    if (extractedFieldCount === 0) {
      flags.push("No structured identity fields confidently extracted");
    }

    flags.push("Visual tamper analysis requires review");

    return {
      documentType,

      documentNumber,

      holderName,

      nationality,

      dateOfBirth,

      expiryDate,

      expiryStatus,

      ocrConfidence,

      tamperAnalysis: {
        status: "review",
        notes:
          "Local OCR extracted document text successfully, but OCR alone cannot establish whether the document image has been visually tampered with.",
      },

      faceMatch: {
        status: "review",
        score: null,
        notes: "Face matching is deferred until the person-camera stage.",
      },

      liveness: {
        status: "unavailable",
        notes: "Liveness is evaluated during the live camera stage.",
      },

      rationale:
        extractedFieldCount > 0
          ? "Document information was extracted using local Tesseract OCR. Biometric and visual tamper checks remain separate verification stages."
          : "Tesseract OCR completed, but structured identity fields could not be confidently extracted from the document.",

      flags,
    };
  } finally {
    await rm(tempDirectory, {
      recursive: true,
      force: true,
    });
  }
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
      const localOcrResult = await analyzeWithLocalOcr(data.imageDataUrl);

      return {
        ok: true as const,
        simulated: false,
        record: buildRecord(
          localOcrResult,
          data.fileName,
          data.watchlistNames,
          data.autoHoldWatchlist,
        ),
      };
    }

    const prompt = `You are a document-forensics assistant inside CYBERSHIELD 3.1.
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
