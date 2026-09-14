import { t as cva } from "../_libs/class-variance-authority+clsx.mjs";
import { t as cn } from "./store-BiL2_mqV.mjs";
import { t as decisionLabel } from "./format-BITs3HZC.mjs";
import { n as require_jsx_runtime } from "../_libs/radix-ui__react-context+react.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/scan-checks-A3MSulTT.js
var import_jsx_runtime = require_jsx_runtime();
var badgeVariants = cva("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium tracking-wide", {
	variants: { variant: {
		default: "border-transparent bg-secondary text-secondary-foreground",
		safe: "border-transparent bg-success/15 text-success",
		manual: "border-transparent bg-warning/15 text-warning",
		hold: "border-transparent bg-danger/15 text-danger",
		outline: "border-border text-muted-foreground"
	} },
	defaultVariants: { variant: "default" }
});
function Badge({ className, variant, ...props }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
		className: cn(badgeVariants({ variant }), className),
		...props
	});
}
function DecisionBadge({ decision }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, {
		variant: decision,
		children: decisionLabel(decision)
	});
}
var RADIUS = 34;
var CIRCUMFERENCE = 2 * Math.PI * RADIUS;
function RiskRing({ score, decision, className }) {
	const clamped = Math.max(0, Math.min(100, score));
	const offset = CIRCUMFERENCE - clamped / 100 * CIRCUMFERENCE;
	const stroke = decision === "safe" ? "stroke-success" : decision === "hold" ? "stroke-danger" : "stroke-warning";
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: cn("relative size-24", className),
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", {
			viewBox: "0 0 88 88",
			className: "size-full -rotate-90",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", {
				cx: "44",
				cy: "44",
				r: RADIUS,
				fill: "none",
				className: "stroke-secondary",
				strokeWidth: "8"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", {
				cx: "44",
				cy: "44",
				r: RADIUS,
				fill: "none",
				className: stroke,
				strokeWidth: "8",
				strokeLinecap: "round",
				strokeDasharray: CIRCUMFERENCE,
				strokeDashoffset: offset
			})]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "absolute inset-0 grid place-items-center",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "font-mono text-2xl font-semibold tabular-nums leading-none",
				children: clamped
			})
		})]
	});
}
var STATUS_CLASS = {
	passed: "bg-success/15 text-success",
	review: "bg-warning/15 text-warning",
	fail: "bg-danger/15 text-danger",
	unavailable: "bg-secondary text-muted-foreground"
};
var STATUS_LABEL = {
	passed: "Passed",
	review: "Review",
	fail: "Fail",
	unavailable: "N/A"
};
function ScanChecks({ checks }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
		className: "grid gap-2",
		children: checks.map((check) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
			className: "flex flex-col gap-2 rounded-lg bg-muted px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "text-sm",
				children: check.label
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
				className: cn("w-fit rounded-full px-2.5 py-1 text-xs font-medium", STATUS_CLASS[check.status]),
				children: [STATUS_LABEL[check.status], check.detail ? ` · ${check.detail}` : ""]
			})]
		}, check.id))
	});
}
//#endregion
export { RiskRing as n, ScanChecks as r, DecisionBadge as t };
