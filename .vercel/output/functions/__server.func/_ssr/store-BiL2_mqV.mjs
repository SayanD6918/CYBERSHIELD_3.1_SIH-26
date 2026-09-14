import { n as clsx } from "../_libs/class-variance-authority+clsx.mjs";
import { t as twMerge } from "../_libs/tailwind-merge.mjs";
import { n as create, t as persist } from "../_libs/zustand.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/store-BiL2_mqV.js
function cn(...inputs) {
	return twMerge(clsx(inputs));
}
var SEED_CASES = [
	{
		id: "BS-2026-00481",
		createdAt: (/* @__PURE__ */ new Date(Date.now() - 12e4)).toISOString(),
		documentType: "passport",
		documentNumber: "P882142",
		holderName: "Elena Voss",
		nationality: "NLD",
		dateOfBirth: "1991-04-12",
		expiryDate: "2029-08-18",
		riskScore: 64,
		decision: "manual",
		checks: [
			{
				id: "ocr",
				label: "OCR & data extraction",
				status: "passed",
				detail: "96% confidence"
			},
			{
				id: "expiry",
				label: "Document expiry",
				status: "passed",
				detail: "Valid until 2029"
			},
			{
				id: "tamper",
				label: "Tamper analysis",
				status: "review",
				detail: "Print-pattern irregularity"
			},
			{
				id: "face",
				label: "Face match",
				status: "review",
				detail: "78% match"
			},
			{
				id: "liveness",
				label: "Liveness detection",
				status: "passed",
				detail: "Passed"
			}
		],
		rationale: "Portrait lighting and microprint on the biodata page need a supervisor check before clearance.",
		flags: ["Face match below 80%", "Print-pattern irregularity"],
		fileName: "passport-voss.jpg",
		watchlistHit: false
	},
	{
		id: "BS-2026-00480",
		createdAt: (/* @__PURE__ */ new Date(Date.now() - 108e4)).toISOString(),
		documentType: "visa",
		documentNumber: "V441219",
		holderName: "Jonah Park",
		nationality: "KOR",
		dateOfBirth: "1988-11-02",
		expiryDate: "2027-01-09",
		riskScore: 18,
		decision: "safe",
		checks: [
			{
				id: "ocr",
				label: "OCR & data extraction",
				status: "passed",
				detail: "99% confidence"
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
				status: "passed",
				detail: "No anomalies"
			},
			{
				id: "face",
				label: "Face match",
				status: "passed",
				detail: "94% match"
			},
			{
				id: "liveness",
				label: "Liveness detection",
				status: "passed",
				detail: "Passed"
			}
		],
		rationale: "Machine-readable visa fields and portrait match are consistent.",
		flags: [],
		fileName: "visa-park.jpg",
		watchlistHit: false
	},
	{
		id: "BS-2026-00479",
		createdAt: (/* @__PURE__ */ new Date(Date.now() - 276e4)).toISOString(),
		documentType: "passport",
		documentNumber: "P190407",
		holderName: "Viktor Hale",
		nationality: "UNK",
		dateOfBirth: "1979-06-30",
		expiryDate: "2026-12-01",
		riskScore: 91,
		decision: "hold",
		checks: [
			{
				id: "ocr",
				label: "OCR & data extraction",
				status: "passed",
				detail: "91% confidence"
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
				status: "fail",
				detail: "UV pattern mismatch"
			},
			{
				id: "face",
				label: "Face match",
				status: "review",
				detail: "61% match"
			},
			{
				id: "liveness",
				label: "Liveness detection",
				status: "unavailable",
				detail: "Still image only"
			}
		],
		rationale: "Watchlist match plus tamper indicators. Do not clear.",
		flags: ["Watchlist match", "UV pattern mismatch"],
		fileName: "passport-hale.jpg",
		watchlistHit: true
	},
	{
		id: "BS-2026-00478",
		createdAt: (/* @__PURE__ */ new Date(Date.now() - 108e5)).toISOString(),
		documentType: "permit",
		documentNumber: "R773263",
		holderName: "Amira Cole",
		nationality: "CAN",
		dateOfBirth: "1996-02-21",
		expiryDate: "2028-05-14",
		riskScore: 11,
		decision: "safe",
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
				status: "passed",
				detail: "No anomalies"
			},
			{
				id: "face",
				label: "Face match",
				status: "passed",
				detail: "97% match"
			},
			{
				id: "liveness",
				label: "Liveness detection",
				status: "passed",
				detail: "Passed"
			}
		],
		rationale: "Residence permit fields are intact and biometrics align.",
		flags: [],
		fileName: "permit-cole.jpg",
		watchlistHit: false
	}
];
var SEED_WATCHLIST = [{
	id: "wl-1",
	name: "Viktor Hale",
	reason: "Interpol notice — document fraud",
	addedAt: (/* @__PURE__ */ new Date(Date.now() - 10368e5)).toISOString()
}, {
	id: "wl-2",
	name: "Mira Solano",
	reason: "Stolen blank passport series",
	addedAt: (/* @__PURE__ */ new Date(Date.now() - 3456e6)).toISOString()
}];
var BASELINE = {
	total: 1280,
	safe: 1100,
	manual: 142,
	hold: 38
};
function countDecision(cases, decision) {
	return cases.filter((item) => item.decision === decision).length;
}
function computeStats(cases) {
	const extra = cases.filter((item) => !SEED_CASES.some((seed) => seed.id === item.id));
	return {
		total: BASELINE.total + SEED_CASES.length + extra.length,
		safe: BASELINE.safe + countDecision(SEED_CASES, "safe") + countDecision(extra, "safe"),
		manual: BASELINE.manual + countDecision(SEED_CASES, "manual") + countDecision(extra, "manual"),
		hold: BASELINE.hold + countDecision(SEED_CASES, "hold") + countDecision(extra, "hold")
	};
}
var useAppStore = create()(persist((set, get) => ({
	hydrated: false,
	cases: SEED_CASES,
	watchlist: SEED_WATCHLIST,
	settings: {
		officerName: "Arnab K.",
		officerRole: "Checkpoint officer",
		checkpoint: "Checkpoint 04",
		autoHoldWatchlist: true
	},
	nextSerial: 482,
	setHydrated: (value) => set({ hydrated: value }),
	addCase: (record) => {
		const serial = get().nextSerial;
		const created = {
			...record,
			id: `BS-2026-${String(serial).padStart(5, "0")}`
		};
		set({
			cases: [created, ...get().cases],
			nextSerial: serial + 1
		});
		return created;
	},
	addWatchlist: (name, reason) => {
		set({ watchlist: [{
			id: `wl-${crypto.randomUUID()}`,
			name: name.trim(),
			reason: reason.trim() || "Officer added",
			addedAt: (/* @__PURE__ */ new Date()).toISOString()
		}, ...get().watchlist] });
	},
	removeWatchlist: (id) => {
		set({ watchlist: get().watchlist.filter((item) => item.id !== id) });
	},
	updateSettings: (patch) => {
		set({ settings: {
			...get().settings,
			...patch
		} });
	},
	resetDemo: () => {
		set({
			cases: SEED_CASES,
			watchlist: SEED_WATCHLIST,
			nextSerial: 482,
			settings: {
				officerName: "Arnab K.",
				officerRole: "Checkpoint officer",
				checkpoint: "Checkpoint 04",
				autoHoldWatchlist: true
			}
		});
	}
}), {
	name: "bordershield-v1",
	skipHydration: true,
	partialize: (state) => ({
		cases: state.cases,
		watchlist: state.watchlist,
		settings: state.settings,
		nextSerial: state.nextSerial
	})
}));
//#endregion
export { computeStats as n, useAppStore as r, cn as t };
