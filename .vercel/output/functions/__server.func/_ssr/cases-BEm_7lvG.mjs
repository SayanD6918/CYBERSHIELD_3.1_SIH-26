import { i as __toESM } from "../_runtime.mjs";
import { u as require_react } from "../_libs/@floating-ui/react-dom+[...].mjs";
import { r as useAppStore, t as cn } from "./store-BiL2_mqV.mjs";
import { n as require_jsx_runtime } from "../_libs/radix-ui__react-context+react.mjs";
import { n as CaseTable, t as CaseDetailDialog } from "./case-table-DqMGWu9S.mjs";
import { a as CardHeader, i as CardDescription, n as Card, o as CardTitle, r as CardContent, t as Button } from "./card-vbhcDHeF.mjs";
import { t as Input } from "./input-CGjnuAHH.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/cases-BEm_7lvG.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var FILTERS = [
	{
		id: "all",
		label: "All"
	},
	{
		id: "safe",
		label: "Safe"
	},
	{
		id: "manual",
		label: "Manual"
	},
	{
		id: "hold",
		label: "Hold"
	}
];
function CasesPage() {
	const cases = useAppStore((s) => s.cases);
	const [query, setQuery] = (0, import_react.useState)("");
	const [filter, setFilter] = (0, import_react.useState)("all");
	const [selected, setSelected] = (0, import_react.useState)(null);
	const visible = (0, import_react.useMemo)(() => {
		const q = query.trim().toLowerCase();
		return cases.filter((item) => {
			if (filter !== "all" && item.decision !== filter) return false;
			if (!q) return true;
			return item.id.toLowerCase().includes(q) || (item.holderName ?? "").toLowerCase().includes(q) || item.documentNumber.toLowerCase().includes(q) || item.documentType.toLowerCase().includes(q);
		});
	}, [
		cases,
		filter,
		query
	]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-6",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "text-2xl font-semibold tracking-tight sm:text-3xl",
				children: "Case history"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-2 text-sm text-muted-foreground",
				children: "Review activity from this checkpoint. Open a row for the full check list."
			})] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Card, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(CardHeader, {
				className: "gap-4 sm:flex-row sm:items-end sm:justify-between",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CardTitle, { children: "Filed cases" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(CardDescription, { children: [visible.length, " shown"] })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
						value: query,
						onChange: (event) => setQuery(event.target.value),
						placeholder: "Search name, case, or number",
						className: "sm:w-64"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "flex gap-1",
						children: FILTERS.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							type: "button",
							size: "sm",
							variant: filter === item.id ? "secondary" : "ghost",
							className: cn(filter === item.id && "text-foreground"),
							onClick: () => setFilter(item.id),
							children: item.label
						}, item.id))
					})]
				})]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CardContent, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CaseTable, {
				cases: visible,
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
//#endregion
export { CasesPage as component };
