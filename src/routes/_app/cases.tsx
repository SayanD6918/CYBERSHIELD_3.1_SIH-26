import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CaseDetailDialog } from "@/components/case-detail";
import { CaseTable } from "@/components/case-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/lib/store";
import type { CaseRecord, Decision } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/cases")({
  component: CasesPage,
});

const FILTERS: { id: "all" | Decision; label: string }[] = [
  { id: "all", label: "All" },
  { id: "safe", label: "Safe" },
  { id: "manual", label: "Manual" },
  { id: "hold", label: "Hold" },
];

function CasesPage() {
  const cases = useAppStore((s) => s.cases);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | Decision>("all");
  const [selected, setSelected] = useState<CaseRecord | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cases.filter((item) => {
      if (filter !== "all" && item.decision !== filter) return false;
      if (!q) return true;
      return (
        item.id.toLowerCase().includes(q) ||
        (item.holderName ?? "").toLowerCase().includes(q) ||
        item.documentNumber.toLowerCase().includes(q) ||
        item.documentType.toLowerCase().includes(q)
      );
    });
  }, [cases, filter, query]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Case history</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Review activity from this checkpoint. Open a row for the full check list.
        </p>
      </div>

      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle>Filed cases</CardTitle>
            <CardDescription>{visible.length} shown</CardDescription>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, case, or number"
              className="sm:w-64"
            />
            <div className="flex gap-1">
              {FILTERS.map((item) => (
                <Button
                  key={item.id}
                  type="button"
                  size="sm"
                  variant={filter === item.id ? "secondary" : "ghost"}
                  className={cn(filter === item.id && "text-foreground")}
                  onClick={() => setFilter(item.id)}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <CaseTable cases={visible} onSelect={setSelected} />
        </CardContent>
      </Card>

      <CaseDetailDialog
        record={selected}
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </div>
  );
}
