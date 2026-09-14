import { Badge } from "@/components/ui/badge";
import { decisionLabel } from "@/lib/format";
import type { Decision } from "@/lib/types";

export function DecisionBadge({ decision }: { decision: Decision }) {
  return <Badge variant={decision}>{decisionLabel(decision)}</Badge>;
}
