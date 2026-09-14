import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  FolderSearch,
  LayoutDashboard,
  ScanSearch,
  Settings,
  ShieldAlert,
} from "lucide-react";
import { Toaster } from "sonner";
import { ShieldLogo } from "@/components/shield-logo";
import { TooltipProvider } from "@/components/ui/tooltip";
import { formatLongDate, initialsFromName } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Overview", full: "Overview", icon: LayoutDashboard },
  { to: "/verify", label: "Verify", full: "Verify document", icon: ScanSearch },
  { to: "/cases", label: "Cases", full: "Case history", icon: FolderSearch },
  { to: "/watchlists", label: "Watchlists", full: "Watchlists", icon: ShieldAlert },
  { to: "/settings", label: "Settings", full: "Settings", icon: Settings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const settings = useAppStore((s) => s.settings);
  const setHydrated = useAppStore((s) => s.setHydrated);
  const [now, setNow] = useState("");

  useEffect(() => {
    void useAppStore.persist.rehydrate();
    setHydrated(true);
  }, [setHydrated]);

  useEffect(() => {
    setNow(formatLongDate());
    const id = window.setInterval(() => setNow(formatLongDate()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-dvh">
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-sidebar px-3 py-6 md:flex">
          <div className="mb-8 flex items-center gap-3 px-3">
            <div className="grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground">
              <ShieldLogo className="size-5" />
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">CYBERSHIELD 3.1</div>
              <div className="mt-0.5 text-xs font-medium tracking-widest text-muted-foreground">
                AI SECURITY
              </div>
            </div>
          </div>
          <nav className="flex flex-1 flex-col gap-1">
            {NAV.map((item) => {
              const active =
                item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "flex h-11 items-center gap-3 rounded-lg border-l-2 border-transparent px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground",
                    active && "border-primary bg-accent text-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  {item.full}
                </Link>
              );
            })}
          </nav>
          <div className="px-3 pt-4 text-xs text-muted-foreground">
            <div className="font-medium tracking-wider">SYSTEM STATUS</div>
            <div className="mt-3 flex items-center gap-2 text-success">
              <span className="size-1.5 rounded-full bg-success" />
              All systems operational
            </div>
            <div className="mt-4">Training simulator</div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-4 border-b border-border px-4 py-4 sm:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground md:hidden">
                <ShieldLogo className="size-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium uppercase tracking-widest text-primary">
                  Officer workspace / {settings.checkpoint}
                </div>
                {now ? (
                  <div className="mt-1 hidden text-sm text-muted-foreground sm:block">{now}</div>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <div className="grid size-9 place-items-center rounded-full bg-secondary text-xs font-semibold text-foreground">
                {initialsFromName(settings.officerName)}
              </div>
              <div className="hidden leading-tight sm:block">
                <div className="font-medium text-foreground">{settings.officerName}</div>
                <div className="text-xs">{settings.officerRole}</div>
              </div>
            </div>
          </header>
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 pb-24 sm:px-8 sm:py-8 md:pb-10">
            {children}
          </main>
        </div>

        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-sidebar/95 md:hidden">
          <ul className="grid grid-cols-5">
            {NAV.map((item) => {
              const active =
                item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
              const Icon = item.icon;
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className={cn(
                      "flex h-16 flex-col items-center justify-center gap-1 text-xs text-muted-foreground",
                      active && "text-primary",
                    )}
                  >
                    <Icon className="size-4" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
      <Toaster theme="dark" position="bottom-right" richColors />
    </TooltipProvider>
  );
}
