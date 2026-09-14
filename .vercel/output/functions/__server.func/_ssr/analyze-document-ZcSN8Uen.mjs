import { n as TSS_SERVER_FUNCTION, t as createServerFn } from "./ssr.mjs";
import { a as object, n as boolean, o as string, t as array } from "../_libs/zod.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/analyze-document-ZcSN8Uen.js
var createServerRpc = (serverFnMeta, splitImportFn) => {
	const url = "/_serverFn/" + serverFnMeta.id;
	return Object.assign(splitImportFn, {
		url,
		serverFnMeta,
		[TSS_SERVER_FUNCTION]: true
	});
};
var InputSchema = object({
	imageDataUrl: string().min(32).max(55e5),
	fileName: string().min(1).max(200),
	watchlistNames: array(string().max(120)).max(40),
	autoHoldWatchlist: boolean()
});
function asStatus(value, fallback) {
	if (value === "passed" || value === "review" || value === "fail" || value === "unavailable") return value;
	return fallback;
}
function asDecision(value, score) {
	if (value === "safe" || value === "manual" || value === "hold") return value;
	if (score >= 80) return "hold";
	if (score >= 40) return "manual";
	return "safe";
}
function parseModelJson(text) {
	const stripped = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
	return JSON.parse(stripped);
}
function watchlistMatch(name, list) {
	if (!name) return null;
	const needle = name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
	if (!needle) return null;
	for (const entry of list) {
		const hay = entry.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
		if (!hay) continue;
		if (needle.includes(hay) || hay.includes(needle)) return entry;
	}
	return null;
}
function buildRecord(model, fileName, watchlistNames, autoHoldWatchlist) {
	const score = Math.max(0, Math.min(100, Math.round(model.riskScore ?? 42)));
	let decision = asDecision(model.decision, score);
	const flags = [...model.flags ?? []];
	const hit = watchlistMatch(model.holderName, watchlistNames);
	let riskScore = score;
	let watchlistHit = false;
	if (hit) {
		watchlistHit = true;
		flags.unshift(`Watchlist match: ${hit}`);
		if (autoHoldWatchlist) {
			decision = "hold";
			riskScore = Math.max(riskScore, 88);
		} else if (decision === "safe") {
			decision = "manual";
			riskScore = Math.max(riskScore, 55);
		}
	}
	const ocr = Math.max(0, Math.min(100, Math.round(model.ocrConfidence ?? 90)));
	const faceScore = model.faceMatch?.score ?? null;
	const checks = [
		{
			id: "ocr",
			label: "OCR & data extraction",
			status: ocr >= 85 ? "passed" : ocr >= 60 ? "review" : "fail",
			detail: `${ocr}% confidence`
		},
		{
			id: "expiry",
			label: "Document expiry",
			status: model.expiryStatus === "expired" ? "fail" : model.expiryStatus === "valid" ? "passed" : "review",
			detail: model.expiryStatus === "expired" ? "Expired" : model.expiryDate ? `Valid until ${model.expiryDate}` : "Not confirmed"
		},
		{
			id: "tamper",
			label: "Tamper analysis",
			status: asStatus(model.tamperAnalysis?.status, "review"),
			detail: model.tamperAnalysis?.notes ?? "Review required"
		},
		{
			id: "face",
			label: "Face match",
			status: asStatus(model.faceMatch?.status, "review"),
			detail: faceScore != null ? `${Math.round(faceScore)}% match` : model.faceMatch?.notes ?? "Single image — estimated"
		},
		{
			id: "liveness",
			label: "Liveness detection",
			status: asStatus(model.liveness?.status, "unavailable"),
			detail: model.liveness?.notes ?? "Still image only"
		}
	];
	return {
		documentType: (model.documentType ?? "unknown").toLowerCase(),
		documentNumber: model.documentNumber?.trim() || "UNKNOWN",
		holderName: model.holderName ?? null,
		nationality: model.nationality ?? null,
		dateOfBirth: model.dateOfBirth ?? null,
		expiryDate: model.expiryDate ?? null,
		riskScore,
		decision,
		checks,
		rationale: model.rationale?.trim() || "Automated review complete. Confirm fields against the physical document.",
		flags,
		fileName,
		watchlistHit
	};
}
function fallbackFromName(fileName) {
	let hash = 0;
	for (let i = 0; i < fileName.length; i += 1) hash = hash * 33 + fileName.charCodeAt(i) | 0;
	const n = Math.abs(hash);
	const score = 12 + n % 78;
	const decision = score >= 80 ? "hold" : score >= 40 ? "manual" : "safe";
	return {
		documentType: [
			"passport",
			"visa",
			"permit"
		][n % 3],
		documentNumber: `X${String(1e5 + n % 9e5)}`,
		holderName: null,
		nationality: null,
		dateOfBirth: null,
		expiryDate: "2028-06-01",
		expiryStatus: "valid",
		ocrConfidence: 70 + n % 25,
		tamperAnalysis: {
			status: score >= 70 ? "review" : "passed",
			notes: score >= 70 ? "Could not fully verify security print" : "No obvious anomalies"
		},
		faceMatch: {
			status: score >= 50 ? "review" : "passed",
			score: Math.max(55, 98 - score % 40),
			notes: "Estimated from a still image"
		},
		liveness: {
			status: "unavailable",
			notes: "Still image only"
		},
		riskScore: score,
		decision,
		rationale: "AI service was unavailable, so this is a simulated training result. Do not use it for a real identity decision.",
		flags: ["Simulated result"]
	};
}
var analyzeDocument_createServerFn_handler = createServerRpc({
	id: "0dd498e77b9e53de357e07a44b530687e9bf65df1a7712d7800977842608ec53",
	name: "analyzeDocument",
	filename: "src/lib/analyze-document.ts"
}, (opts) => analyzeDocument.__executeServer(opts));
var analyzeDocument = createServerFn({ method: "POST" }).validator((input) => InputSchema.parse(input)).handler(analyzeDocument_createServerFn_handler, async ({ data }) => {
	const apiKey = process.env.XAI_API_KEY;
	if (!apiKey) return {
		ok: true,
		simulated: true,
		record: buildRecord(fallbackFromName(data.fileName), data.fileName, data.watchlistNames, data.autoHoldWatchlist)
	};
	const prompt = `You are a document-forensics assistant inside a BORDER CONTROL TRAINING SIMULATOR called BorderShield.
Analyze the uploaded image. This output is NEVER used for a real identity decision.

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
  "riskScore": number,
  "decision": "safe" | "manual" | "hold",
  "rationale": string,
  "flags": string[]
}

Rules:
- If the image is not a travel document, set documentType to "unknown", decision "hold", riskScore >= 70, and explain why.
- Do not invent MRZ / numbers that are not visible. Use null when unseen.
- Face match on a single still image should usually be "review" or an estimate, never a confident live capture.
- Liveness is "unavailable" for a still photo.
- riskScore 0-100. safe < 40, manual 40-79, hold >= 80 unless a clear fraud indicator requires hold earlier.
- Keep rationale to 2 short sentences.`;
	try {
		const res = await fetch("https://api.x.ai/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`
			},
			body: JSON.stringify({
				model: "grok-4.5",
				temperature: .2,
				max_tokens: 900,
				response_format: { type: "json_object" },
				messages: [{
					role: "user",
					content: [{
						type: "text",
						text: prompt
					}, {
						type: "image_url",
						image_url: {
							url: data.imageDataUrl,
							detail: "high"
						}
					}]
				}]
			})
		});
		if (!res.ok) return {
			ok: true,
			simulated: true,
			record: buildRecord(fallbackFromName(data.fileName), data.fileName, data.watchlistNames, data.autoHoldWatchlist)
		};
		return {
			ok: true,
			simulated: false,
			record: buildRecord(parseModelJson((await res.json()).choices?.[0]?.message?.content ?? ""), data.fileName, data.watchlistNames, data.autoHoldWatchlist)
		};
	} catch {
		return {
			ok: true,
			simulated: true,
			record: buildRecord(fallbackFromName(data.fileName), data.fileName, data.watchlistNames, data.autoHoldWatchlist)
		};
	}
});
//#endregion
export { analyzeDocument_createServerFn_handler };
