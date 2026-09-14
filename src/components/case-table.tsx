import { DecisionBadge } from "@/components/decision-badge";
import { formatCaseTime, maskDocumentNumber, titleCaseDocType } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { CaseRecord } from "@/lib/types";

export function CaseTable({
  cases,
  onSelect,
}: {
  cases: CaseRecord[];
  onSelect: (record: CaseRecord) => void;
}) {
  const hydrated = useAppStore((s) => s.hydrated);

  if (cases.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No verification cases match this filter.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-3 font-medium">Case ID</th>
            <th className="px-3 py-3 font-medium">Document</th>
            <th className="px-3 py-3 font-medium">Risk</th>
            <th className="px-3 py-3 font-medium">Decision</th>
            <th className="hidden px-3 py-3 font-medium sm:table-cell">When</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((item) => (
            <tr
              key={item.id}
              className="cursor-pointer border-t border-border transition-colors duration-150 hover:bg-accent/60"
              onClick={() => onSelect(item)}
            >
              <td className="px-3 py-3.5 font-mono text-xs font-medium sm:text-sm">
                {item.id}
              </td>
              <td className="px-3 py-3.5">
                <div>{titleCaseDocType(item.documentType)}</div>
                <div className="text-xs text-muted-foreground">
                  {maskDocumentNumber(item.documentNumber)}
                  {item.holderName ? ` · ${item.holderName}` : ""}
                </div>
              </td>
              <td
                className={cn(
                  "px-3 py-3.5 font-mono tabular-nums",
                  item.decision === "safe" && "text-success",
                  item.decision === "manual" && "text-warning",
                  item.decision === "hold" && "text-danger",
                )}
              >
                {item.riskScore} / 100
              </td>
              <td className="px-3 py-3.5">
                <DecisionBadge decision={item.decision} />
              </td>
              <td className="hidden px-3 py-3.5 text-muted-foreground sm:table-cell">
                {hydrated ? formatCaseTime(item.createdAt) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
