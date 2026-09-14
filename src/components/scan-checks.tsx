import { cn } from "@/lib/utils";
import type { ScanCheck } from "@/lib/types";

const STATUS_CLASS: Record<ScanCheck["status"], string> = {
  passed: "bg-success/15 text-success",
  review: "bg-warning/15 text-warning",
  fail: "bg-danger/15 text-danger",
  unavailable: "bg-secondary text-muted-foreground",
};

const STATUS_LABEL: Record<ScanCheck["status"], string> = {
  passed: "Passed",
  review: "Review",
  fail: "Fail",
  unavailable: "N/A",
};

export function ScanChecks({ checks }: { checks: ScanCheck[] }) {
  return (
    <ul className="grid gap-2">
      {checks.map((check) => (
        <li
          key={check.id}
          className="flex flex-col gap-2 rounded-lg bg-muted px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
        >
          <span className="text-sm">{check.label}</span>
          <span
            className={cn(
              "w-fit rounded-full px-2.5 py-1 text-xs font-medium",
              STATUS_CLASS[check.status],
            )}
          >
            {STATUS_LABEL[check.status]}
            {check.detail ? ` · ${check.detail}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
