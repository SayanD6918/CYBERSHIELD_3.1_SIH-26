import { i as __toESM } from "./_runtime.mjs";
import { u as require_react } from "./_libs/@floating-ui/react-dom+[...].mjs";
import { n as computeStats, r as useAppStore } from "./_ssr/store-BiL2_mqV.mjs";
import { n as require_jsx_runtime } from "./_libs/radix-ui__react-context+react.mjs";
import { p as ArrowUpRight, s as ScanSearch } from "./_libs/lucide-react.mjs";
import { n as CaseTable, t as CaseDetailDialog } from "./_ssr/case-table-DqMGWu9S.mjs";
import { a as CardHeader, i as CardDescription, n as Card, o as CardTitle, r as CardContent, t as Button } from "./_ssr/card-vbhcDHeF.mjs";
import { v as Link } from "./_libs/@tanstack/react-router+[...].mjs";
import { a as ResponsiveContainer, i as Bar, n as YAxis, o as Tooltip, r as XAxis, t as BarChart } from "./_libs/recharts+[...].mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/_app-C5xrkHZK.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function OverviewPage() {
	const cases = useAppStore((s) => s.cases);
	const stats = (0, import_react.useMemo)(() => computeStats(cases), [cases]);
	const [selected, setSelected] = (0, import_react.useState)(null);
	const chart = (0, import_react.useMemo)(() => [
		{
			day: "Sat",
			n: 162
		},
		{
			day: "Sun",
			n: 148
		},
		{
			day: "Mon",
			n: 201
		},
		{
			day: "Tue",
			n: 188
		},
		{
			day: "Wed",
			n: 214
		},
		{
			day: "Thu",
			n: 196
		},
		{
			day: "Fri",
			n: 175 + Math.min(12, cases.length)
		}
	], [cases.length]);
	const pct = (n) => stats.total === 0 ? "0.0%" : `${(n / stats.total * 100).toFixed(1)}%`;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-6",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex flex-wrap items-end justify-between gap-4",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
					className: "text-2xl font-semibold tracking-tight sm:text-3xl",
					children: "Verification overview"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-2 max-w-xl text-sm text-muted-foreground",
					children: "AI-assisted identity checks for this checkpoint. Training use only — never a live clearance decision."
				})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					asChild: true,
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
						to: "/verify",
						children: ["Start a scan", /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ArrowUpRight, {})]
					})
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "grid gap-3 sm:grid-cols-2 xl:grid-cols-4",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatCard, {
						label: "Total verifications",
						value: stats.total.toLocaleString(),
						hint: "All cases at this checkpoint"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatCard, {
						label: "Safe to proceed",
						value: stats.safe.toLocaleString(),
						hint: `${pct(stats.safe)} of all cases`,
						tone: "success"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatCard, {
						label: "Manual review",
						value: stats.manual.toLocaleString(),
						hint: `${pct(stats.manual)} of all cases`,
						tone: "warning"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatCard, {
						label: "High-risk holds",
						value: stats.hold.toLocaleString(),
						hint: `${pct(stats.hold)} of all cases`,
						tone: "danger"
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "grid gap-4 lg:grid-cols-5",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Card, {
					className: "lg:col-span-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(CardHeader, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CardTitle, { children: "Throughput this week" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CardDescription, { children: "Completed scans by day at this checkpoint." })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CardContent, {
						className: "h-56",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ResponsiveContainer, {
							width: "100%",
							height: "100%",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(BarChart, {
								data: chart,
								barSize: 28,
								margin: {
									top: 8,
									right: 4,
									left: 4,
									bottom: 0
								},
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(XAxis, {
										dataKey: "day",
										axisLine: false,
										tickLine: false,
										tick: {
											fill: "var(--color-muted-foreground)",
											fontSize: 12
										}
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(YAxis, {
										hide: true,
										domain: [0, 260]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Tooltip, {
										cursor: { fill: "color-mix(in oklab, var(--color-primary) 12%, transparent)" },
										contentStyle: {
											background: "var(--color-popover)",
											border: "1px solid var(--color-border)",
											borderRadius: 12,
											color: "var(--color-popover-foreground)",
											fontSize: 12
										}
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Bar, {
										dataKey: "n",
										fill: "var(--color-primary)",
										radius: [
											6,
											6,
											0,
											0
										],
										isAnimationActive: false
									})
								]
							})
						})
					})]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Card, {
					className: "lg:col-span-2",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(CardHeader, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CardTitle, { children: "Start a verification" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CardDescription, { children: "Scan a passport, visa, or permit to run an explainable risk check." })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(CardContent, {
						className: "space-y-4",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "text-sm text-muted-foreground",
							children: "Drop a document image on the verify desk. The model extracts visible fields, flags tamper cues, and writes a case you can review with a supervisor."
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							asChild: true,
							className: "w-full",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
								to: "/verify",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ScanSearch, {}), "Open verify desk"]
							})
						})]
					})]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Card, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(CardHeader, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CardTitle, { children: "Recent verification cases" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CardDescription, { children: "Tap a row to inspect checks, flags, and rationale." })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CardContent, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CaseTable, {
				cases: cases.slice(0, 8),
				onSelect: setSelected
			}) })] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CaseDetailDialog, {
				record: selected,
				open: selected !== null,
				onOpenChange: (open) => {
					if (!open) setSelected(null);
				}
			})
		]
	});
}
function StatCard({ label, value, hint, tone }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Card, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(CardContent, {
		className: "p-5",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "text-xs font-medium uppercase tracking-wider text-muted-foreground",
				children: label
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: `mt-3 font-mono text-3xl font-semibold tabular-nums ${tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : tone === "danger" ? "text-danger" : "text-foreground"}`,
				children: value
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "mt-2 text-xs text-muted-foreground",
				children: hint
			})
		]
	}) });
}
//#endregion
export { OverviewPage as component };
