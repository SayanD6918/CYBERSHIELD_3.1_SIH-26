import { cn } from "@/lib/utils";
import type { Decision } from "@/lib/types";

const RADIUS = 34;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function RiskRing({
  score,
  decision,
  className,
}: {
  score: number;
  decision: Decision;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, score));
  const offset = CIRCUMFERENCE - (clamped / 100) * CIRCUMFERENCE;
  const stroke =
    decision === "safe"
      ? "stroke-success"
      : decision === "hold"
        ? "stroke-danger"
        : "stroke-warning";

  return (
    <div className={cn("relative size-24", className)}>
      <svg viewBox="0 0 88 88" className="size-full -rotate-90">
        <circle
          cx="44"
          cy="44"
          r={RADIUS}
          fill="none"
          className="stroke-secondary"
          strokeWidth="8"
        />
        <circle
          cx="44"
          cy="44"
          r={RADIUS}
          fill="none"
          className={stroke}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span className="font-mono text-2xl font-semibold tabular-nums leading-none">
          {clamped}
        </span>
      </div>
    </div>
  );
}
