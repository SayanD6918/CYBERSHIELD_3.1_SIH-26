import type { Decision } from "./types.ts";

/** Partially masks a document number for display in lists and exports. */
export function maskDocumentNumber(value: string): string {
  const trimmed = value.replace(/\s+/g, "");
  if (trimmed.length < 4) return trimmed || "—";
  return `${trimmed.slice(0, 1)}••••${trimmed.slice(-2)}`;
}

export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "OF";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

/** "3 minutes ago" for a case timestamp, via Intl rather than a date library. */
export function formatCaseTime(iso: string, now = new Date()): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "just now";

  const elapsed = parsed.getTime() - now.getTime();
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  for (const [unit, milliseconds] of RELATIVE_UNITS) {
    if (Math.abs(elapsed) >= milliseconds) {
      return formatter.format(Math.round(elapsed / milliseconds), unit);
    }
  }
  return "just now";
}

export function formatLongDate(date = new Date()): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function decisionLabel(decision: Decision): string {
  if (decision === "safe") return "Safe to proceed";
  if (decision === "manual") return "Manual review";
  return "Hold";
}

export function titleCaseDocType(type: string): string {
  if (!type) return "Document";
  return type.charAt(0).toUpperCase() + type.slice(1);
}
