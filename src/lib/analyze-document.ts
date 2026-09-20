import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { CaseRecord, CheckStatus, DocumentEvidence, MRZEvidence, ScanCheck } from "./types.ts";
import type { DocumentImageQuality } from "./document-image.ts";
import { parseDocumentText } from "./document-parser.ts";
import { watchlistMatch } from "./watchlist.ts";

const InputSchema = z.object({
  imageDataUrl: z.string().min(32).max(5_500_000),
  fileName: z.string().min(1).max(200),
  watchlistNames: z.array(z.string().max(120)).max(40),
  autoHoldWatchlist: z.boolean(),
  imageQuality: z
    .object({
      width: z.number(),
      height: z.number(),
      sharpness: z.number(),
      brightness: z.number(),
      resolutionOk: z.boolean(),
      blurLikely: z.boolean(),
      brightnessStatus: z.enum(["dark", "balanced", "bright"]),
    })
    .nullable()
    .optional(),
});

type DocumentAnalysis = {
  documentType: string;
  documentNumber: string | null;
  holderName: string | null;
  nationality: string | null;
  dateOfBirth: string | null;
  expiryDate: string | null;
  expiryStatus: "valid" | "expired" | "unknown";
  /** Median word-level Tesseract confidence, or null when unmeasured. */
  ocrConfidence: number | null;
  tamperStatus: CheckStatus;
  tamperNotes: string;
  rationale: string;
  flags: string[];
  evidence: { document: DocumentEvidence; mrz: MRZEvidence };
};

/**
 * Tesseract's own name, resolved on PATH. Earlier builds defaulted to a
 * Windows install path, so on Linux and macOS the whole document stage threw
 * ENOENT and the operator only saw "Scan failed".
 */
const TESSERACT_CMD = process.env.TESSERACT_CMD || "tesseract";

function emptyMrzEvidence(method: string): MRZEvidence {
  return {
    status: "unavailable",
    confidence: null,
    method,
    issues: [],
    format: "unknown",
    detected: false,
    lines: 0,
    checks: {
      documentNumber: null,
      dateOfBirth: null,
      expiryDate: null,
      optionalData: null,
      composite: null,
    },
    fieldConsistency: {
      documentNumber: null,
      nationality: null,
      dateOfBirth: null,
      expiryDate: null,
      holderName: null,
    },
  };
}

/** What we report when the OCR engine itself is unavailable. */
function ocrUnavailable(reason: string, quality?: DocumentImageQuality | null): DocumentAnalysis {
  return {
    documentType: "unknown",
    documentNumber: null,
    holderName: null,
    nationality: null,
    dateOfBirth: null,
    expiryDate: null,
    expiryStatus: "unknown",
    ocrConfidence: null,
    tamperStatus: "review",
    tamperNotes: "No document text was read, so no tamper assessment was possible.",
    rationale: reason,
    flags: [reason],
    evidence: {
      document: {
        status: "unavailable",
        confidence: null,
        method: "Tesseract OCR",
        issues: [reason],
        documentType: null,
        documentNumber: null,
        fields: { holderName: null, nationality: null, dateOfBirth: null, expiryDate: null },
        quality: quality
          ? {
              width: quality.width,
              height: quality.height,
              sharpness: quality.sharpness,
              brightness: quality.brightness,
              resolutionOk: quality.resolutionOk,
            }
          : undefined,
      },
      mrz: emptyMrzEvidence("TD3 MRZ detection (not reached)"),
    },
  };
}

/**
 * Median word-level confidence from Tesseract's TSV output.
 *
 * Returns null rather than a stand-in when nothing usable came back. An
 * earlier build synthesised a score from the number of extracted fields,
 * which then drove the risk engine and was shown to the operator as a
 * percentage - a number that measured nothing.
 */
function medianOcrConfidence(tsv: string): number | null {
  const confidences: number[] = [];

  for (const line of tsv.split(/\r?\n/).slice(1)) {
    const columns = line.split("\t");
    if (columns.length < 12) continue;

    const text = String(columns[11] ?? "").trim();
    const confidence = Number(columns[10]);
    if (!text) continue;
    if (!Number.isFinite(confidence) || confidence < 25) continue;

    confidences.push(confidence);
  }

  if (confidences.length === 0) return null;

  confidences.sort((a, b) => a - b);
  const middle = Math.floor(confidences.length / 2);
  const median =
    confidences.length % 2 === 0
      ? (confidences[middle - 1] + confidences[middle]) / 2
      : confidences[middle];

  return Math.round(median);
}

async function readDocument(
  imageDataUrl: string,
  imageQuality?: DocumentImageQuality | null,
): Promise<DocumentAnalysis> {
  const { execFile } = await import("node:child_process");
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { promisify } = await import("node:util");

  const run = promisify(execFile);

  const match = imageDataUrl.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/s);
  if (!match) {
    return ocrUnavailable("The uploaded image could not be read.", imageQuality);
  }

  const subtype = match[1].toLowerCase();
  const extension = subtype === "png" ? ".png" : subtype === "webp" ? ".webp" : ".jpg";
  const directory = await mkdtemp(path.join(tmpdir(), "cybershield-ocr-"));
  const imagePath = path.join(directory, `document${extension}`);

  try {
    await writeFile(imagePath, Buffer.from(match[2], "base64"));

    let text: string;
    try {
      const result = await run(TESSERACT_CMD, [imagePath, "stdout", "--psm", "6"], {
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024,
      });
      text = String(result.stdout ?? "").trim();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return ocrUnavailable(
          `OCR engine not found. Install Tesseract or set TESSERACT_CMD (tried "${TESSERACT_CMD}").`,
          imageQuality,
        );
      }
      return ocrUnavailable(
        `OCR engine failed: ${error instanceof Error ? error.message : String(error)}`,
        imageQuality,
      );
    }

    // Second pass: TSV carries real per-word confidence. Losing it is not
    // fatal, but it must not be replaced with a guess.
    let ocrConfidence: number | null = null;
    try {
      const tsv = await run(TESSERACT_CMD, [imagePath, "stdout", "--psm", "6", "tsv"], {
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      });
      ocrConfidence = medianOcrConfidence(String(tsv.stdout ?? ""));
    } catch {
      ocrConfidence = null;
    }

    const parsed = parseDocumentText(text);
    const extractedFields = [
      parsed.documentNumber,
      parsed.holderName,
      parsed.nationality,
      parsed.dateOfBirth,
      parsed.expiryDate,
    ].filter(Boolean).length;

    const qualityIssues: string[] = [];
    if (!imageQuality) {
      qualityIssues.push("Document image quality evidence is unavailable");
    } else {
      if (!imageQuality.resolutionOk) {
        qualityIssues.push("Document image resolution is below the configured minimum");
      }
      if (imageQuality.blurLikely) {
        qualityIssues.push("Document image appears blurred");
      }
      if (imageQuality.brightnessStatus !== "balanced") {
        qualityIssues.push(`Document image is ${imageQuality.brightnessStatus}`);
      }
    }

    // Missing quality evidence degrades to review like every other missing
    // signal here, rather than passing by default.
    const documentStatus: CheckStatus =
      qualityIssues.length > 0 ? "review" : extractedFields > 0 ? "passed" : "review";

    const fieldIssues = extractedFields > 0 ? [] : ["No structured identity fields confidently extracted"];

    const mrz = parsed.mrz;
    const mrzEvidence: MRZEvidence = mrz
      ? {
          status: mrz.status === "MRZ_VALID" ? "passed" : mrz.status === "MRZ_INVALID" ? "fail" : "review",
          confidence: null,
          method: "TD3 MRZ parser and ICAO check-digit validation",
          issues: mrz.issues.map((issue) => issue.message),
          format: "TD3",
          detected: true,
          lines: 2,
          checks: mrz.checks,
          fieldConsistency: mrz.fieldConsistency ?? {
            documentNumber: null,
            nationality: null,
            dateOfBirth: null,
            expiryDate: null,
            holderName: null,
          },
        }
      : emptyMrzEvidence("TD3 MRZ detection");

    const flags = ["Local Tesseract OCR", ...parsed.flags, ...fieldIssues];
    if (ocrConfidence == null) {
      flags.push("OCR confidence could not be measured");
    }

    return {
      documentType: parsed.documentType,
      documentNumber: parsed.documentNumber,
      holderName: parsed.holderName,
      nationality: parsed.nationality,
      dateOfBirth: parsed.dateOfBirth,
      expiryDate: parsed.expiryDate,
      expiryStatus: parsed.expiryStatus,
      ocrConfidence,
      tamperStatus: "review",
      tamperNotes:
        "OCR read the document text, but text alone cannot establish whether the document image has been visually tampered with.",
      rationale:
        extractedFields > 0
          ? "Document fields were extracted with local Tesseract OCR. Biometric and tamper checks are separate stages."
          : "Tesseract OCR completed, but no structured identity fields could be extracted.",
      flags,
      evidence: {
        document: {
          status: documentStatus,
          confidence: ocrConfidence,
          method: "Document image quality + Tesseract OCR + structured document parser",
          issues: [...qualityIssues, ...fieldIssues],
          documentType: parsed.documentType,
          documentNumber: parsed.documentNumber,
          fields: {
            holderName: parsed.holderName,
            nationality: parsed.nationality,
            dateOfBirth: parsed.dateOfBirth,
            expiryDate: parsed.expiryDate,
          },
          quality: imageQuality
            ? {
                width: imageQuality.width,
                height: imageQuality.height,
                sharpness: imageQuality.sharpness,
                brightness: imageQuality.brightness,
                resolutionOk: imageQuality.resolutionOk,
              }
            : undefined,
        },
        mrz: mrzEvidence,
      },
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function buildRecord(
  analysis: DocumentAnalysis,
  fileName: string,
  watchlistNames: string[],
  autoHoldWatchlist: boolean,
): Omit<CaseRecord, "id" | "createdAt"> {
  const flags = [...analysis.flags];
  const hit = watchlistMatch(analysis.holderName, watchlistNames);

  if (hit) {
    flags.unshift(
      autoHoldWatchlist
        ? `Watchlist match (auto-hold enabled): ${hit}`
        : `Watchlist match: ${hit}`,
    );
  }

  const ocr = analysis.ocrConfidence;

  // Only document-stage checks belong here. Face, liveness, challenge,
  // identity and MRZ checks are produced by finalizeVerification once the
  // biometric evidence exists.
  const checks: ScanCheck[] = [
    {
      id: "ocr",
      label: "OCR & data extraction",
      status: ocr == null ? "unavailable" : ocr >= 85 ? "passed" : ocr >= 60 ? "review" : "fail",
      detail: ocr == null ? "Confidence not measured" : `Median word confidence ${ocr}`,
    },
    {
      id: "expiry",
      label: "Document expiry",
      status:
        analysis.expiryStatus === "expired"
          ? "fail"
          : analysis.expiryStatus === "valid"
            ? "passed"
            : "review",
      detail:
        analysis.expiryStatus === "expired"
          ? "Expired"
          : analysis.expiryDate
            ? `Valid until ${analysis.expiryDate}`
            : "Not confirmed",
    },
    {
      id: "tamper",
      label: "Tamper analysis",
      status: analysis.tamperStatus,
      detail: analysis.tamperNotes,
    },
  ];

  return {
    documentType: analysis.documentType.toLowerCase(),
    documentNumber: analysis.documentNumber?.trim() || "UNKNOWN",
    holderName: analysis.holderName,
    nationality: analysis.nationality,
    dateOfBirth: analysis.dateOfBirth,
    expiryDate: analysis.expiryDate,
    riskScore: 0,
    decision: "manual",
    checks,
    rationale:
      "Document analysis complete. Risk and the final decision are produced only after biometric, identity, watchlist and document evidence are fused.",
    flags,
    fileName,
    watchlistHit: Boolean(hit),
    evidence: analysis.evidence,
  };
}

/**
 * Document stage: image quality, OCR, field parsing and MRZ validation.
 *
 * Deterministic and local by design. An earlier build could route the image
 * to a hosted vision model, which then supplied document, face and liveness
 * observations - a non-reproducible input into an evidence bundle that is
 * supposed to be auditable.
 */
export const analyzeDocument = createServerFn({ method: "POST" })
  .validator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const analysis = await readDocument(data.imageDataUrl, data.imageQuality);
    return {
      ok: true as const,
      record: buildRecord(analysis, data.fileName, data.watchlistNames, data.autoHoldWatchlist),
    };
  });
