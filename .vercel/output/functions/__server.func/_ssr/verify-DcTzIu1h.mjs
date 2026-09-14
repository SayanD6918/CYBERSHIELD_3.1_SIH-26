import { i as __toESM } from "../_runtime.mjs";
import { u as require_react } from "../_libs/@floating-ui/react-dom+[...].mjs";
import { r as useAppStore, t as cn } from "./store-BiL2_mqV.mjs";
import { a as maskDocumentNumber, n as formatCaseTime, o as titleCaseDocType } from "./format-BITs3HZC.mjs";
import { n as require_jsx_runtime } from "../_libs/radix-ui__react-context+react.mjs";
import { n as RiskRing, r as ScanChecks, t as DecisionBadge } from "./scan-checks-A3MSulTT.mjs";
import { f as FileImage, l as LoaderCircle, m as ArrowRight, n as Upload } from "../_libs/lucide-react.mjs";
import { a as CardHeader, i as CardDescription, n as Card, o as CardTitle, r as CardContent, t as Button } from "./card-vbhcDHeF.mjs";
import { n as TSS_SERVER_FUNCTION, r as getServerFnById, t as createServerFn } from "./ssr.mjs";
import { a as object, n as boolean, o as string, t as array } from "../_libs/zod.mjs";
import { n as toast } from "../_libs/sonner.mjs";
import { n as Root, t as Indicator } from "../_libs/radix-ui__react-progress.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/verify-DcTzIu1h.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var Progress = import_react.forwardRef(({ className, value, ...props }, ref) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Root, {
	ref,
	className: cn("relative h-1.5 w-full overflow-hidden rounded-full bg-secondary", className),
	...props,
	children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Indicator, {
		className: "h-full w-full flex-1 bg-primary transition-transform duration-300 ease-out",
		style: { transform: `translateX(-${100 - (value ?? 0)}%)` }
	})
}));
Progress.displayName = Root.displayName;
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
var STEPS = [
	"Preprocessing document image",
	"Extracting visible text",
	"Checking document integrity",
	"Comparing identity features",
	"Writing an explainable risk score"
];
function VerifyPage() {
	const inputRef = (0, import_react.useRef)(null);
	const addCase = useAppStore((s) => s.addCase);
	const cases = useAppStore((s) => s.cases);
	const watchlist = useAppStore((s) => s.watchlist);
	const autoHold = useAppStore((s) => s.settings.autoHoldWatchlist);
	const [dragging, setDragging] = (0, import_react.useState)(false);
	const [fileName, setFileName] = (0, import_react.useState)(null);
	const [preview, setPreview] = (0, import_react.useState)(null);
	const [payload, setPayload] = (0, import_react.useState)(null);
	const [scanning, setScanning] = (0, import_react.useState)(false);
	const [step, setStep] = (0, import_react.useState)(0);
	const [latest, setLatest] = (0, import_react.useState)(null);
	const [simulated, setSimulated] = (0, import_react.useState)(false);
	const displayed = latest ?? cases[0] ?? null;
	async function acceptFile(file) {
		try {
			const prepared = await prepareDocumentImage(file);
			setFileName(prepared.fileName);
			setPreview(prepared.previewUrl);
			setPayload(prepared.dataUrl);
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
		setStep(0);
		const timer = window.setInterval(() => {
			setStep((current) => Math.min(STEPS.length - 1, current + 1));
		}, 700);
		try {
			const result = await analyzeDocument({ data: {
				imageDataUrl: payload,
				fileName,
				watchlistNames: watchlist.map((item) => item.name),
				autoHoldWatchlist: autoHold
			} });
			const created = addCase({
				...result.record,
				createdAt: (/* @__PURE__ */ new Date()).toISOString()
			});
			setLatest(created);
			setSimulated(result.simulated);
			toast.success(`Case ${created.id} filed`);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Scan failed. Try another image.");
		} finally {
			window.clearInterval(timer);
			setScanning(false);
			setStep(STEPS.length);
		}
	}
	const progress = scanning ? Math.round((step + 1) / STEPS.length * 90) : latest && step >= STEPS.length ? 100 : 0;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-6",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
			className: "text-2xl font-semibold tracking-tight sm:text-3xl",
			children: "Verify document"
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "mt-2 max-w-2xl text-sm text-muted-foreground",
			children: "Scan a travel document to begin an AI-assisted identity check. Results are for training and demonstration only."
		})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			className: "grid gap-4 lg:grid-cols-5",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Card, {
				className: "lg:col-span-3",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(CardHeader, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CardTitle, { children: "Document intake" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CardDescription, { children: "PNG or JPG · maximum 10 MB · one page at a time." })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(CardContent, {
					className: "space-y-4",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							onDragOver: (event) => {
								event.preventDefault();
								setDragging(true);
							},
							onDragLeave: () => setDragging(false),
							onDrop: (event) => {
								event.preventDefault();
								setDragging(false);
								const file = event.dataTransfer.files[0];
								if (file) acceptFile(file);
							},
							className: cn("rounded-xl bg-muted px-6 py-10 text-center shadow-panel transition-[box-shadow,background-color] duration-150", dragging && "shadow-panel-hover bg-accent"),
							children: [
								preview ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
									src: preview,
									alt: "Selected travel document",
									className: "mx-auto max-h-48 rounded-lg object-contain outline outline-1 -outline-offset-1 outline-foreground/10"
								}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "mx-auto grid size-12 place-items-center rounded-lg bg-secondary text-primary",
									children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Upload, { className: "size-5" })
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "mt-4 text-sm font-medium",
									children: fileName ?? "Drop passport, visa, or permit here"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "mt-1 text-xs text-muted-foreground",
									children: "Visible biodata page works best. PDFs are not accepted."
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
									onChange: (event) => {
										const file = event.target.files?.[0];
										if (file) acceptFile(file);
									}
								})
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex flex-col gap-3 sm:flex-row",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
								className: "flex-1",
								onClick: () => void runScan(),
								disabled: scanning,
								children: [scanning ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoaderCircle, { className: "animate-spin" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ArrowRight, {}), scanning ? "Analyzing document" : "Run verification scan"]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
								type: "button",
								variant: "outline",
								disabled: scanning || !fileName && !preview,
								onClick: () => {
									setFileName(null);
									setPreview(null);
									setPayload(null);
									if (inputRef.current) inputRef.current.value = "";
								},
								children: "Clear"
							})]
						}),
						scanning || progress > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "space-y-2",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Progress, { value: progress }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-center text-xs text-primary",
								children: scanning ? STEPS[step] : "Verification complete"
							})]
						}) : null,
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "rounded-lg border-l-2 border-warning bg-warning/10 px-3 py-2.5 text-xs text-warning",
							children: "Prototype mode: never use these scores for a real identity or border decision."
						})
					]
				})]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Card, {
				className: "lg:col-span-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(CardHeader, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CardTitle, { children: "Latest scan" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CardDescription, { children: displayed ? `${displayed.id} · ${formatCaseTime(displayed.createdAt)}` : "No scan on this desk yet" })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CardContent, { children: displayed ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "space-y-5",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ScanChecks, { checks: displayed.checks }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex items-center gap-4",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(RiskRing, {
								score: displayed.riskScore,
								decision: displayed.decision
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DecisionBadge, { decision: displayed.decision }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
									className: "mt-2 text-xs text-muted-foreground",
									children: [
										"Risk score · ",
										displayed.riskScore,
										" / 100"
									]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
									className: "mt-2 text-sm",
									children: [
										titleCaseDocType(displayed.documentType),
										" ·",
										" ",
										maskDocumentNumber(displayed.documentNumber)
									]
								}),
								displayed.holderName ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "mt-1 text-sm text-muted-foreground",
									children: displayed.holderName
								}) : null
							] })]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "text-sm text-muted-foreground",
							children: displayed.rationale
						}),
						simulated ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "text-xs text-warning",
							children: "AI service fell back to a simulated result for this file."
						}) : null
					]
				}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-sm text-muted-foreground",
					children: "Run a scan to populate OCR, expiry, tamper, and face-match checks."
				}) })]
			})]
		})]
	});
}
//#endregion
export { VerifyPage as component };
