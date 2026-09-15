import { i as __toESM } from "../_runtime.mjs";
import { u as require_react } from "../_libs/@floating-ui/react-dom+[...].mjs";
import { r as useAppStore, t as cn } from "./store-DHXVKHB4.mjs";
import { n as require_jsx_runtime } from "../_libs/radix-ui__react-context+react.mjs";
import { n as RiskRing, r as ScanChecks, t as DecisionBadge } from "./scan-checks-Ds1UvmHw.mjs";
import { a as ShieldCheck, g as Camera, h as CircleCheck, m as CircleX, n as Upload, p as FileImage, u as LoaderCircle } from "../_libs/lucide-react.mjs";
import { a as CardHeader, i as CardDescription, n as Card, o as CardTitle, r as CardContent, t as Button } from "./card-Du_jeUaG.mjs";
import { n as TSS_SERVER_FUNCTION, r as getServerFnById, t as createServerFn } from "./ssr.mjs";
import { t as calculateRisk } from "./risk-engine-CGH9tEAN.mjs";
import { a as object, n as boolean, o as string, t as array } from "../_libs/zod.mjs";
import { n as toast } from "../_libs/sonner.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/verify-DY6lAgE6.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var createSsrRpc = (functionId) => {
	const url = "/_serverFn/" + functionId;
	const serverFnMeta = { id: functionId };
	const fn = async (...args) => {
		return (await getServerFnById(functionId, { origin: "server" }))(...args);
	};
	return Object.assign(fn, {
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
var analyzeDocument = createServerFn({ method: "POST" }).validator((input) => InputSchema.parse(input)).handler(createSsrRpc("0dd498e77b9e53de357e07a44b530687e9bf65df1a7712d7800977842608ec53"));
var MAX_EDGE = 1280;
var JPEG_QUALITY = .78;
var MAX_BYTES = 10485760;
async function prepareDocumentImage(file) {
	if (file.size > MAX_BYTES) throw new Error("File is larger than 10 MB.");
	if (file.type === "application/pdf") throw new Error("Upload a PNG or JPG of the document page — PDFs are not scanned in this build.");
	if (!file.type.startsWith("image/")) throw new Error("Please upload a PNG or JPG scan of the travel document.");
	const bitmap = await createImageBitmap(file);
	const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
	const width = Math.max(1, Math.round(bitmap.width * scale));
	const height = Math.max(1, Math.round(bitmap.height * scale));
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		bitmap.close();
		throw new Error("Could not read this image.");
	}
	ctx.drawImage(bitmap, 0, 0, width, height);
	bitmap.close();
	const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
	return {
		dataUrl,
		previewUrl: dataUrl,
		fileName: file.name
	};
}
var MOCK_IDENTITY_DB = [{
	documentNumber: "P1234567",
	name: "Rahul Sharma",
	dateOfBirth: "2001-05-14",
	nationality: "Indian",
	expiryDate: "2031-05-14",
	status: "ACTIVE"
}];
function normalize(value) {
	return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
function verifyAgainstMockDatabase(record) {
	if (!record.documentNumber || record.documentNumber === "UNKNOWN") return {
		status: "unavailable",
		matchedFields: 0,
		mismatchedFields: 0,
		issues: ["No document number available for lookup"]
	};
	const found = MOCK_IDENTITY_DB.find((item) => normalize(item.documentNumber) === normalize(record.documentNumber));
	if (!found) return {
		status: "review",
		matchedFields: 0,
		mismatchedFields: 0,
		issues: ["No matching mock authoritative record"]
	};
	const pairs = [
		[
			"name",
			record.holderName,
			found.name
		],
		[
			"date of birth",
			record.dateOfBirth,
			found.dateOfBirth
		],
		[
			"nationality",
			record.nationality,
			found.nationality
		],
		[
			"expiry",
			record.expiryDate,
			found.expiryDate
		]
	];
	const issues = [];
	let matchedFields = 1;
	let mismatchedFields = 0;
	for (const [field, actual, expected] of pairs) {
		if (!actual) continue;
		if (normalize(actual) === normalize(expected)) matchedFields += 1;
		else {
			mismatchedFields += 1;
			issues.push(`${field} mismatch`);
		}
	}
	if (found.status !== "ACTIVE") {
		mismatchedFields += 1;
		issues.push(`record status is ${found.status}`);
	} else matchedFields += 1;
	return {
		status: mismatchedFields > 0 ? "fail" : "passed",
		matchedFields,
		mismatchedFields,
		issues
	};
}
function finalizeVerification(record, biometric) {
	const databaseVerification = verifyAgainstMockDatabase(record);
	const risk = calculateRisk({
		ocrConfidence: Number(record.checks.find((c) => c.id === "ocr")?.detail.match(/\d+/)?.[0] ?? 0),
		expiryStatus: record.checks.find((c) => c.id === "expiry")?.status === "passed" ? "valid" : record.checks.find((c) => c.id === "expiry")?.status === "fail" ? "expired" : "unknown",
		tamperStatus: record.checks.find((c) => c.id === "tamper")?.status === "fail" ? "fail" : record.checks.find((c) => c.id === "tamper")?.status === "review" ? "review" : "passed",
		faceStatus: biometric.faceMatchStatus === "NO_MATCH" ? "fail" : biometric.faceMatchStatus === "UNCERTAIN" || biometric.faceMatchStatus === "UNAVAILABLE" ? "review" : "passed",
		livenessStatus: biometric.livenessStatus === "SPOOF" ? "fail" : biometric.livenessStatus === "UNCERTAIN" || biometric.livenessStatus === "UNAVAILABLE" ? "unavailable" : "passed",
		databaseStatus: databaseVerification.status,
		documentTypeKnown: record.documentType !== "unknown",
		documentNumberPresent: record.documentNumber !== "UNKNOWN",
		holderNamePresent: Boolean(record.holderName),
		nationalityPresent: Boolean(record.nationality),
		dobPresent: Boolean(record.dateOfBirth),
		expiryDatePresent: Boolean(record.expiryDate),
		watchlistHit: record.watchlistHit
	});
	const checks = [
		...record.checks.filter((c) => c.id !== "face" && c.id !== "liveness"),
		{
			id: "database",
			label: "Identity database",
			status: databaseVerification.status === "fail" ? "fail" : databaseVerification.status === "passed" ? "passed" : "review",
			detail: databaseVerification.issues.length ? databaseVerification.issues.join("; ") : `${databaseVerification.matchedFields} fields matched`
		},
		{
			id: "liveness",
			label: "Liveness detection",
			status: biometric.livenessStatus === "LIVE" ? "passed" : biometric.livenessStatus === "SPOOF" ? "fail" : "review",
			detail: biometric.livenessConfidence == null ? biometric.livenessStatus : `${Math.round(biometric.livenessConfidence * 100)}% live confidence`
		},
		{
			id: "face",
			label: "Face match",
			status: biometric.faceMatchStatus === "MATCH" ? "passed" : biometric.faceMatchStatus === "NO_MATCH" ? "fail" : "review",
			detail: biometric.faceSimilarity == null ? biometric.faceMatchStatus : `${Math.round(biometric.faceSimilarity * 100)}% similarity`
		}
	];
	const flags = [...record.flags, ...risk.reasons.filter((r) => !record.flags.includes(r))];
	return {
		...record,
		biometric,
		databaseVerification,
		riskScore: risk.score,
		decision: risk.decision,
		checks,
		flags,
		rationale: risk.reasons.length ? risk.reasons.join(". ") + "." : "All available verification signals are consistent."
	};
}
var BIOMETRIC_URL = "http://127.0.0.1:8765";
var CHALLENGES = [
	"Turn your head to the left",
	"Turn your head to the right",
	"Look straight at the camera"
];
function newCaseId() {
	return `CASE-2026-${String(Date.now()).slice(-6)}`;
}
function VerifyPage() {
	const inputRef = (0, import_react.useRef)(null);
	const videoRef = (0, import_react.useRef)(null);
	const streamRef = (0, import_react.useRef)(null);
	const addCase = useAppStore((s) => s.addCase);
	const cases = useAppStore((s) => s.cases);
	const watchlist = useAppStore((s) => s.watchlist);
	const autoHold = useAppStore((s) => s.settings.autoHoldWatchlist);
	const hydrated = useAppStore((s) => s.hydrated);
	const [dragging, setDragging] = (0, import_react.useState)(false);
	const [fileName, setFileName] = (0, import_react.useState)(null);
	const [preview, setPreview] = (0, import_react.useState)(null);
	const [payload, setPayload] = (0, import_react.useState)(null);
	const [scanning, setScanning] = (0, import_react.useState)(false);
	const [latest, setLatest] = (0, import_react.useState)(null);
	const [pending, setPending] = (0, import_react.useState)(null);
	const [caseId, setCaseId] = (0, import_react.useState)(null);
	const [cameraOpen, setCameraOpen] = (0, import_react.useState)(false);
	const [biometricBusy, setBiometricBusy] = (0, import_react.useState)(false);
	const [bioResult, setBioResult] = (0, import_react.useState)(null);
	const [challenge] = (0, import_react.useState)(() => CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)]);
	const displayed = latest ?? cases[0] ?? null;
	(0, import_react.useEffect)(() => {
		const video = videoRef.current;
		const stream = streamRef.current;
		if (!cameraOpen || !video || !stream) return;
		video.srcObject = stream;
		video.play().catch((error) => {
			console.warn("Video autoplay/playback warning:", error);
		});
	}, [cameraOpen]);
	(0, import_react.useEffect)(() => {
		return () => {
			streamRef.current?.getTracks().forEach((track) => track.stop());
			streamRef.current = null;
		};
	}, []);
	async function acceptFile(file) {
		try {
			const prepared = await prepareDocumentImage(file);
			setFileName(prepared.fileName);
			setPreview(prepared.previewUrl);
			setPayload(prepared.dataUrl);
			setPending(null);
			setBioResult(null);
			setLatest(null);
			setCaseId(null);
			streamRef.current?.getTracks().forEach((track) => track.stop());
			streamRef.current = null;
			setCameraOpen(false);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not read that file.");
		}
	}
	async function runScan() {
		if (!payload || !fileName) {
			toast.error("Drop a document image first.");
			return;
		}
		setScanning(true);
		try {
			const result = await analyzeDocument({ data: {
				imageDataUrl: payload,
				fileName,
				watchlistNames: watchlist.map((item) => item.name),
				autoHoldWatchlist: autoHold
			} });
			const id = newCaseId();
			setCaseId(id);
			setPending(result.record);
			setBioResult(null);
			toast.success(`Document analysis complete · ${id}`);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Scan failed.");
		} finally {
			setScanning(false);
		}
	}
	async function startCamera() {
		if (!pending || !payload) return;
		if (!navigator.mediaDevices?.getUserMedia) {
			toast.error("Camera access is not supported by this browser or page.");
			return;
		}
		try {
			streamRef.current?.getTracks().forEach((track) => track.stop());
			streamRef.current = null;
			const stream = await navigator.mediaDevices.getUserMedia({
				video: {
					facingMode: "user",
					width: { ideal: 640 },
					height: { ideal: 480 }
				},
				audio: false
			});
			streamRef.current = stream;
			setCameraOpen(true);
			setBioResult(null);
			toast.success("Camera connected.");
		} catch (error) {
			console.error("Camera error:", error);
			if (error instanceof DOMException) {
				if (error.name === "NotAllowedError") toast.error("Camera permission was denied. Allow camera access for localhost and try again.");
				else if (error.name === "NotFoundError") toast.error("No camera was found on this device.");
				else if (error.name === "NotReadableError") toast.error("The camera is already being used by another application.");
				else toast.error(`Camera error: ${error.name}`);
			} else toast.error("Camera unavailable. Check browser permission and camera connection.");
		}
	}
	function stopCamera() {
		streamRef.current?.getTracks().forEach((track) => track.stop());
		streamRef.current = null;
		if (videoRef.current) videoRef.current.srcObject = null;
		setCameraOpen(false);
	}
	function captureFrame() {
		const video = videoRef.current;
		if (!video) throw new Error("Camera video element is unavailable.");
		if (video.readyState < 2) throw new Error("Camera is not ready. Please wait a moment.");
		if (!video.videoWidth || !video.videoHeight) throw new Error("Camera video has no usable frame yet.");
		const canvas = document.createElement("canvas");
		canvas.width = video.videoWidth;
		canvas.height = video.videoHeight;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Could not create camera capture canvas.");
		context.drawImage(video, 0, 0, canvas.width, canvas.height);
		return canvas.toDataURL("image/jpeg", .82);
	}
	async function runBiometric() {
		if (!pending || !payload || !caseId) return;
		setBiometricBusy(true);
		try {
			const liveFrame = captureFrame();
			const liveResponse = await fetch(`${BIOMETRIC_URL}/api/liveness`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ image_data_url: liveFrame })
			});
			if (!liveResponse.ok) throw new Error("Liveness service unavailable.");
			const live = await liveResponse.json();
			const matchResponse = await fetch(`${BIOMETRIC_URL}/api/face-match`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					document_image_data_url: payload,
					live_image_data_url: liveFrame
				})
			});
			if (!matchResponse.ok) throw new Error("Face-match service unavailable.");
			const match = await matchResponse.json();
			const biometric = {
				livenessStatus: live.liveness_status ?? "UNAVAILABLE",
				livenessConfidence: typeof live.confidence === "number" ? live.confidence : null,
				faceMatchStatus: match.face_match_status ?? "UNAVAILABLE",
				faceSimilarity: typeof match.similarity_score === "number" ? match.similarity_score : null,
				faceThreshold: Number(match.threshold ?? .8),
				challenge
			};
			setBioResult(biometric);
			const finalized = finalizeVerification(pending, biometric);
			const created = addCase({
				...finalized,
				createdAt: (/* @__PURE__ */ new Date()).toISOString()
			}, caseId);
			setLatest(created);
			setPending(null);
			stopCamera();
			toast.success(`Verification complete · ${created.id}`);
		} catch (error) {
			console.error("Biometric verification error:", error);
			toast.error(error instanceof Error ? error.message : "Biometric verification failed.");
		} finally {
			setBiometricBusy(false);
		}
	}
	function runDemoScenario(kind) {
		const id = newCaseId();
		const common = {
			createdAt: (/* @__PURE__ */ new Date()).toISOString(),
			fileName: `demo-${kind}.jpg`,
			documentType: "passport",
			documentNumber: kind === "valid" ? "P1234567" : "DEMO-0001",
			holderName: "Rahul Sharma",
			nationality: "Indian",
			dateOfBirth: "2001-05-14",
			expiryDate: "2031-05-14",
			watchlistHit: false,
			checks: [
				{
					id: "ocr",
					label: "OCR & data extraction",
					status: "passed",
					detail: "98% confidence"
				},
				{
					id: "expiry",
					label: "Document expiry",
					status: "passed",
					detail: "Valid"
				},
				{
					id: "tamper",
					label: "Tamper analysis",
					status: kind === "inconsistent" ? "review" : "passed",
					detail: kind === "inconsistent" ? "Field inconsistency simulated" : "No anomalies"
				}
			]
		};
		const demo = kind === "spoof" ? {
			livenessStatus: "SPOOF",
			livenessConfidence: .98,
			faceMatchStatus: "MATCH",
			faceSimilarity: .94,
			faceThreshold: .8,
			challenge
		} : kind === "wrong-person" ? {
			livenessStatus: "LIVE",
			livenessConfidence: .96,
			faceMatchStatus: "NO_MATCH",
			faceSimilarity: .42,
			faceThreshold: .8,
			challenge
		} : {
			livenessStatus: "LIVE",
			livenessConfidence: .97,
			faceMatchStatus: "MATCH",
			faceSimilarity: .94,
			faceThreshold: .8,
			challenge
		};
		const finalized = finalizeVerification({
			...common,
			riskScore: 0,
			decision: "safe",
			rationale: "Demo scenario",
			flags: kind === "spoof" ? ["DEMO MODE: spoof attack"] : kind === "wrong-person" ? ["DEMO MODE: wrong person"] : kind === "inconsistent" ? ["DEMO MODE: inconsistent identity"] : ["DEMO MODE"]
		}, demo);
		const created = addCase({
			...finalized,
			createdAt: common.createdAt
		}, id);
		setLatest(created);
		setCaseId(id);
		toast.success(`DEMO MODE · ${created.decision.toUpperCase()}`);
	}
	function clearAll() {
		stopCamera();
		setFileName(null);
		setPreview(null);
		setPayload(null);
		setPending(null);
		setLatest(null);
		setBioResult(null);
		setCaseId(null);
		if (inputRef.current) inputRef.current.value = "";
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-6",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex items-center gap-2 text-primary",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ShieldCheck, { className: "size-5" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "text-xs font-semibold uppercase tracking-widest",
						children: "CYBERSHIELD 3.1"
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
					className: "mt-2 text-2xl font-semibold tracking-tight sm:text-3xl",
					children: "Intelligent Identity Verification Gateway"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-2 max-w-3xl text-sm text-muted-foreground",
					children: "Document authenticity → identity consistency → liveness → face verification → explainable risk. Prototype results are for demonstration only."
				})
			] }),
			caseId ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "rounded-lg border bg-muted px-4 py-3 font-mono text-sm",
				children: ["CASE ID · ", caseId]
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "grid gap-4 lg:grid-cols-5",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Card, {
					className: "lg:col-span-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(CardHeader, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CardTitle, { children: "1 · Document capture" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CardDescription, { children: "PNG/JPG/WebP · maximum 10 MB · biodata page works best." })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(CardContent, {
						className: "space-y-4",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								onDragOver: (e) => {
									e.preventDefault();
									setDragging(true);
								},
								onDragLeave: () => setDragging(false),
								onDrop: (e) => {
									e.preventDefault();
									setDragging(false);
									const file = e.dataTransfer.files[0];
									if (file) acceptFile(file);
								},
								className: cn("rounded-xl bg-muted px-6 py-10 text-center transition", dragging && "bg-accent"),
								children: [
									preview ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
										src: preview,
										alt: "Selected identity document",
										className: "mx-auto max-h-48 rounded-lg object-contain outline outline-1 -outline-offset-1 outline-foreground/10"
									}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "mx-auto grid size-12 place-items-center rounded-lg bg-secondary text-primary",
										children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Upload, { className: "size-5" })
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
										className: "mt-4 text-sm font-medium",
										children: fileName ?? "Drop passport, visa, permit, or ID here"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
										type: "button",
										variant: "secondary",
										className: "mt-5",
										onClick: () => inputRef.current?.click(),
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(FileImage, {}), "Browse files"]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
										ref: inputRef,
										type: "file",
										accept: "image/png,image/jpeg,image/jpg,image/webp",
										className: "hidden",
										onChange: (e) => {
											const file = e.target.files?.[0];
											if (file) acceptFile(file);
										}
									})
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex gap-3",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
									className: "flex-1",
									onClick: () => void runScan(),
									disabled: scanning || !payload,
									children: [scanning ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoaderCircle, { className: "animate-spin" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ArrowIcon, {}), scanning ? "Analyzing document…" : "Analyze document"]
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
									variant: "outline",
									disabled: scanning || !fileName,
									onClick: clearAll,
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CircleX, {}), "Clear"]
								})]
							}),
							pending ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "rounded-lg border bg-background p-4",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "text-xs font-semibold uppercase tracking-wider text-muted-foreground",
									children: "Document analysis complete"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "mt-3 grid grid-cols-2 gap-3 text-sm",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
											label: "Type",
											value: pending.documentType
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
											label: "Document",
											value: pending.documentNumber
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
											label: "Holder",
											value: pending.holderName ?? "Not extracted"
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
											label: "Expiry",
											value: pending.expiryDate ?? "Unknown"
										})
									]
								})]
							}) : null
						]
					})]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Card, {
					className: "lg:col-span-2",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(CardHeader, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CardTitle, { children: "2 · Biometric verification" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CardDescription, { children: "Camera opens only after document analysis." })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(CardContent, {
						className: "space-y-4",
						children: [
							!cameraOpen ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
								className: "w-full",
								disabled: !pending,
								onClick: () => void startCamera(),
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Camera, {}), "Open secure camera"]
							}) : null,
							cameraOpen ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "overflow-hidden rounded-xl bg-black",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("video", {
									ref: videoRef,
									muted: true,
									autoPlay: true,
									playsInline: true,
									className: "aspect-video w-full object-cover"
								})
							}) : null,
							cameraOpen ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "rounded-lg border bg-muted p-3 text-sm",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "font-semibold",
										children: "Active challenge"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										className: "mt-1 text-primary",
										children: [
											"“",
											challenge,
											"”"
										]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "mt-1 text-xs text-muted-foreground",
										children: "The bundled detector currently provides passive PAD; challenge completion is operator guidance and is not counted as a passed signal."
									})
								]
							}) : null,
							cameraOpen ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "space-y-2",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
									className: "w-full",
									disabled: biometricBusy,
									onClick: () => void runBiometric(),
									children: [biometricBusy ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoaderCircle, { className: "animate-spin" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Camera, {}), biometricBusy ? "Checking…" : "Capture & verify person"]
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
									variant: "outline",
									className: "w-full",
									disabled: biometricBusy,
									onClick: stopCamera,
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CircleX, {}), "Close camera"]
								})]
							}) : null,
							bioResult ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "grid gap-2 text-sm",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(BioLine, {
									ok: bioResult.livenessStatus === "LIVE",
									label: "Liveness",
									value: bioResult.livenessStatus
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(BioLine, {
									ok: bioResult.faceMatchStatus === "MATCH",
									label: "Face match",
									value: bioResult.faceSimilarity == null ? bioResult.faceMatchStatus : `${Math.round(bioResult.faceSimilarity * 100)}% similarity`
								})]
							}) : null
						]
					})]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Card, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(CardHeader, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CardTitle, { children: "3 · Final assessment" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CardDescription, { children: displayed ? `${displayed.id}${hydrated ? ` · ${new Date(displayed.createdAt).toLocaleString()}` : ""}` : "Complete the workflow to populate the decision." })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CardContent, { children: displayed ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "grid gap-5 md:grid-cols-[auto_1fr]",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex items-center gap-4",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(RiskRing, {
						score: displayed.riskScore,
						decision: displayed.decision
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DecisionBadge, { decision: displayed.decision }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "mt-2 text-sm text-muted-foreground",
						children: [
							"Risk score · ",
							displayed.riskScore,
							" / 100"
						]
					})] })]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ScanChecks, { checks: displayed.checks }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-4 text-sm text-muted-foreground",
					children: displayed.rationale
				})] })]
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-muted-foreground",
				children: "Run document analysis, then biometric verification, to produce a final GREEN / YELLOW / RED assessment."
			}) })] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Card, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(CardHeader, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CardTitle, { children: "DEMO MODE" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CardDescription, { children: "Clearly labeled simulated outcomes for the hackathon presentation." })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(CardContent, {
				className: "flex flex-wrap gap-2",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						variant: "outline",
						onClick: () => runDemoScenario("valid"),
						children: "Valid person"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						variant: "outline",
						onClick: () => runDemoScenario("spoof"),
						children: "Spoof attack"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						variant: "outline",
						onClick: () => runDemoScenario("wrong-person"),
						children: "Wrong person"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						variant: "outline",
						onClick: () => runDemoScenario("inconsistent"),
						children: "Inconsistent identity"
					})
				]
			})] })
		]
	});
}
function Field({ label, value }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "rounded-lg bg-muted px-3 py-2.5",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "text-xs text-muted-foreground",
			children: label
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mt-1 font-medium",
			children: value
		})]
	});
}
function BioLine({ ok, label, value }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex items-center justify-between rounded-lg bg-muted px-3 py-2",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: label }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
			className: cn("flex items-center gap-1 font-medium", ok ? "text-success" : "text-warning"),
			children: [ok ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CircleCheck, { className: "size-4" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CircleX, { className: "size-4" }), value]
		})]
	});
}
function ArrowIcon() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
		"aria-hidden": "true",
		children: "→"
	});
}
//#endregion
export { VerifyPage as component };
