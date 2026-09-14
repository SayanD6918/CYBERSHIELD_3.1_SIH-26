import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, ScanSearch } from "lucide-react";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CaseDetailDialog } from "@/components/case-detail";
import { CaseTable } from "@/components/case-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { computeStats, useAppStore } from "@/lib/store";
import type { CaseRecord } from "@/lib/types";

export const Route = createFileRoute("/_app/")({
  component: OverviewPage,
});

function OverviewPage() {
  const cases = useAppStore((s) => s.cases);
  const stats = useMemo(() => computeStats(cases), [cases]);
  const [selected, setSelected] = useState<CaseRecord | null>(null);
  const chart = useMemo(
    () => [
      { day: "Sat", n: 162 },
      { day: "Sun", n: 148 },
      { day: "Mon", n: 201 },
      { day: "Tue", n: 188 },
      { day: "Wed", n: 214 },
      { day: "Thu", n: 196 },
      { day: "Fri", n: 175 + Math.min(12, cases.length) },
    ],
    [cases.length],
  );

  const pct = (n: number) =>
    stats.total === 0 ? "0.0%" : `${((n / stats.total) * 100).toFixed(1)}%`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Verification overview
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            AI-assisted identity checks for this checkpoint. Training use only — never a live
            clearance decision.
          </p>
        </div>
        <Button asChild>
          <Link to="/verify">
            Start a scan
            <ArrowUpRight />
          </Link>
        </Button>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total verifications"
          value={stats.total.toLocaleString()}
          hint="All cases at this checkpoint"
        />
        <StatCard
          label="Safe to proceed"
          value={stats.safe.toLocaleString()}
          hint={`${pct(stats.safe)} of all cases`}
          tone="success"
        />
        <StatCard
          label="Manual review"
          value={stats.manual.toLocaleString()}
          hint={`${pct(stats.manual)} of all cases`}
          tone="warning"
        />
        <StatCard
          label="High-risk holds"
          value={stats.hold.toLocaleString()}
          hint={`${pct(stats.hold)} of all cases`}
          tone="danger"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Throughput this week</CardTitle>
            <CardDescription>Completed scans by day at this checkpoint.</CardDescription>
          </CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} barSize={28} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
                <XAxis
                  dataKey="day"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
                />
                <YAxis hide domain={[0, 260]} />
                <RechartsTooltip
                  cursor={{ fill: "color-mix(in oklab, var(--color-primary) 12%, transparent)" }}
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 12,
                    color: "var(--color-popover-foreground)",
                    fontSize: 12,
                  }}
                />
                <Bar
                  dataKey="n"
                  fill="var(--color-primary)"
                  radius={[6, 6, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Start a verification</CardTitle>
            <CardDescription>
              Scan a passport, visa, or permit to run an explainable risk check.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Drop a document image on the verify desk. The model extracts visible fields, flags
              tamper cues, and writes a case you can review with a supervisor.
            </p>
            <Button asChild className="w-full">
              <Link to="/verify">
                <ScanSearch />
                Open verify desk
              </Link>
            </Button>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Recent verification cases</CardTitle>
          <CardDescription>Tap a row to inspect checks, flags, and rationale.</CardDescription>
        </CardHeader>
        <CardContent>
          <CaseTable cases={cases.slice(0, 8)} onSelect={setSelected} />
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

function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "success" | "warning" | "danger";
}) {
  const valueClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "danger"
          ? "text-danger"
          : "text-foreground";
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className={`mt-3 font-mono text-3xl font-semibold tabular-nums ${valueClass}`}>
          {value}
        </div>
        <div className="mt-2 text-xs text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}
