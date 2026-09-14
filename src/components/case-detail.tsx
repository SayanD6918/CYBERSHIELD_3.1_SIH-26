import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DecisionBadge } from "@/components/decision-badge";
import { RiskRing } from "@/components/risk-ring";
import { ScanChecks } from "@/components/scan-checks";
import { formatCaseTime, maskDocumentNumber, titleCaseDocType } from "@/lib/format";
import type { CaseRecord } from "@/lib/types";

export function CaseDetailDialog({
  record,
  open,
  onOpenChange,
}: {
  record: CaseRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        {record ? (
          <>
            <DialogHeader>
              <DialogTitle className="font-mono">{record.id}</DialogTitle>
              <DialogDescription>
                {titleCaseDocType(record.documentType)} · {formatCaseTime(record.createdAt)}
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-5">
              <RiskRing score={record.riskScore} decision={record.decision} />

              <div className="min-w-0 flex-1 space-y-2">
                <DecisionBadge decision={record.decision} />

                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Risk assessment
                  </p>

                  <p className="mt-1 text-sm text-muted-foreground">{record.rationale}</p>
                </div>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Holder" value={record.holderName ?? "Not extracted"} />
              <Field label="Nationality" value={record.nationality ?? "—"} />
              <Field label="Document" value={maskDocumentNumber(record.documentNumber)} />
              <Field label="Expiry" value={record.expiryDate ?? "—"} />
            </dl>
            <ScanChecks checks={record.checks} />
            {record.flags.length > 0 ? (
              <ul className="space-y-1 text-sm text-warning">
                {record.flags.map((flag) => (
                  <li key={flag}>{flag}</li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted px-3 py-2.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium">{value}</dd>
    </div>
  );
}
