import { format, formatDistanceToNowStrict, parseISO } from "date-fns";
import type { Decision } from "./types";

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

export function formatCaseTime(iso: string): string {
  try {
    return formatDistanceToNowStrict(parseISO(iso), { addSuffix: true });
  } catch {
    return "just now";
  }
}

export function formatLongDate(date = new Date()): string {
  return format(date, "EEEE, d MMMM yyyy");
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
