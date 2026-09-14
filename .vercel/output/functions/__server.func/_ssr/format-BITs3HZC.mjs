import { n as formatDistanceToNowStrict, r as format, t as parseISO } from "../_libs/date-fns.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/format-BITs3HZC.js
function maskDocumentNumber(value) {
	const trimmed = value.replace(/\s+/g, "");
	if (trimmed.length < 4) return trimmed || "—";
	return `${trimmed.slice(0, 1)}••••${trimmed.slice(-2)}`;
}
function initialsFromName(name) {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return "OF";
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}
function formatCaseTime(iso) {
	try {
		return formatDistanceToNowStrict(parseISO(iso), { addSuffix: true });
	} catch {
		return "just now";
	}
}
function formatLongDate(date = /* @__PURE__ */ new Date()) {
	return format(date, "EEEE, d MMMM yyyy");
}
function decisionLabel(decision) {
	if (decision === "safe") return "Safe to proceed";
	if (decision === "manual") return "Manual review";
	return "Hold";
}
function titleCaseDocType(type) {
	if (!type) return "Document";
	return type.charAt(0).toUpperCase() + type.slice(1);
}
//#endregion
export { maskDocumentNumber as a, initialsFromName as i, formatCaseTime as n, titleCaseDocType as o, formatLongDate as r, decisionLabel as t };
