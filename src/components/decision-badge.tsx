import { Badge } from "@/components/ui/badge";
import { decisionLabel } from "@/lib/format";
import type { Decision, FinalDecision } from "@/lib/types";

export function DecisionBadge({ decision, finalDecision }: { decision: Decision; finalDecision?: FinalDecision }) {
  if (finalDecision) {
    const variant = finalDecision === "VERIFIED" ? "safe" : finalDecision === "NOT_VERIFIED" ? "hold" : "manual";
    return <Badge variant={variant}>{finalDecision}</Badge>;
  }
  return <Badge variant={decision === "safe" ? "safe" : decision === "hold" ? "hold" : "manual"}>{decisionLabel(decision)}</Badge>;
}
