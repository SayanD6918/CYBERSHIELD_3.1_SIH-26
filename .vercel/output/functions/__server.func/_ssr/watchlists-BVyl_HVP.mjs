import { i as __toESM } from "../_runtime.mjs";
import { u as require_react } from "../_libs/@floating-ui/react-dom+[...].mjs";
import { r as useAppStore } from "./store-BiL2_mqV.mjs";
import { n as formatCaseTime } from "./format-BITs3HZC.mjs";
import { n as require_jsx_runtime } from "../_libs/radix-ui__react-context+react.mjs";
import { c as Plus, i as Trash2 } from "../_libs/lucide-react.mjs";
import { a as CardHeader, i as CardDescription, n as Card, o as CardTitle, r as CardContent, t as Button } from "./card-vbhcDHeF.mjs";
import { t as Input } from "./input-CGjnuAHH.mjs";
import { n as toast } from "../_libs/sonner.mjs";
import { t as Label } from "./label-ASVoZ5X9.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/watchlists-BVyl_HVP.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function WatchlistsPage() {
	const watchlist = useAppStore((s) => s.watchlist);
	const addWatchlist = useAppStore((s) => s.addWatchlist);
	const removeWatchlist = useAppStore((s) => s.removeWatchlist);
	const [name, setName] = (0, import_react.useState)("");
	const [reason, setReason] = (0, import_react.useState)("");
	function onAdd(event) {
		event.preventDefault();
		if (!name.trim()) {
			toast.error("Enter a name to watch.");
			return;
		}
		addWatchlist(name, reason);
		setName("");
		setReason("");
		toast.success("Watchlist entry added");
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-6",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
			className: "text-2xl font-semibold tracking-tight sm:text-3xl",
			children: "Watchlists"
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "mt-2 max-w-2xl text-sm text-muted-foreground",
			children: "Names on this list raise the risk score when they appear in a scan. This list lives on this device only."
		})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "grid gap-4 lg:grid-cols-5",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Card, {
				className: "lg:col-span-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(CardHeader, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CardTitle, { children: "Add a name" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CardDescription, { children: "Used for training matches during verification." })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CardContent, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
					className: "space-y-4",
					onSubmit: onAdd,
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "space-y-2",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
								htmlFor: "wl-name",
								children: "Full name"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
								id: "wl-name",
								value: name,
								onChange: (event) => setName(event.target.value),
								placeholder: "As printed on the document"
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "space-y-2",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
								htmlFor: "wl-reason",
								children: "Reason"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
								id: "wl-reason",
								value: reason,
								onChange: (event) => setReason(event.target.value),
								placeholder: "Notice, stolen blank, fraud ring"
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
							type: "submit",
							className: "w-full",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Plus, {}), "Add to watchlist"]
						})
					]
				}) })]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Card, {
				className: "lg:col-span-3",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(CardHeader, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CardTitle, { children: "Active entries" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(CardDescription, { children: [watchlist.length, " names monitored"] })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CardContent, {
					className: "space-y-2",
					children: watchlist.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "py-8 text-center text-sm text-muted-foreground",
						children: "Watchlist is empty."
					}) : watchlist.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-start justify-between gap-3 rounded-xl bg-muted px-4 py-3",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "font-medium",
								children: entry.name
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "mt-1 text-sm text-muted-foreground",
								children: entry.reason
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "mt-1 text-xs text-muted-foreground",
								children: ["Added ", formatCaseTime(entry.addedAt)]
							})
						] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							type: "button",
							size: "icon",
							variant: "ghost",
							"aria-label": `Remove ${entry.name}`,
							onClick: () => {
								removeWatchlist(entry.id);
								toast.success("Removed from watchlist");
							},
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Trash2, {})
						})]
					}, entry.id))
				})]
			})]
		})]
	});
}
//#endregion
export { WatchlistsPage as component };
