import { useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCaseTime } from "@/lib/format";
import { useAppStore } from "@/lib/store";

export const Route = createFileRoute("/_app/watchlists")({
  component: WatchlistsPage,
});

function WatchlistsPage() {
  const watchlist = useAppStore((s) => s.watchlist);
  const addWatchlist = useAppStore((s) => s.addWatchlist);
  const removeWatchlist = useAppStore((s) => s.removeWatchlist);
  const hydrated = useAppStore((s) => s.hydrated);
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");

  function onAdd(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      toast.error("Enter a name to watch.");
      return;
    }
    addWatchlist(name, reason);
    setName("");
    setReason("");
    toast.success("Watchlist entry added");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Watchlists</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Names on this list raise the risk score when they appear in a scan. This list lives on
          this device only.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Add a name</CardTitle>
            <CardDescription>Used for training matches during verification.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={onAdd}>
              <div className="space-y-2">
                <Label htmlFor="wl-name">Full name</Label>
                <Input
                  id="wl-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="As printed on the document"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wl-reason">Reason</Label>
                <Input
                  id="wl-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Notice, stolen blank, fraud ring"
                />
              </div>
              <Button type="submit" className="w-full">
                <Plus />
                Add to watchlist
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Active entries</CardTitle>
            <CardDescription>{watchlist.length} names monitored</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {watchlist.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Watchlist is empty.
              </p>
            ) : (
              watchlist.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start justify-between gap-3 rounded-xl bg-muted px-4 py-3"
                >
                  <div>
                    <div className="font-medium">{entry.name}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{entry.reason}</div>
                    {hydrated ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Added {formatCaseTime(entry.addedAt)}
                      </div>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove ${entry.name}`}
                    onClick={() => {
                      removeWatchlist(entry.id);
                      toast.success("Removed from watchlist");
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
