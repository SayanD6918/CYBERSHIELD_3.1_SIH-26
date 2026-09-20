import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAppStore } from "@/lib/store";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const clearCases = useAppStore((s) => s.clearCases);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Officer profile and desk preferences for this training workspace.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Officer profile</CardTitle>
          <CardDescription>Shown in the workspace header.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="officer-name">Display name</Label>
            <Input
              id="officer-name"
              value={settings.officerName}
              onChange={(event) => updateSettings({ officerName: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="officer-role">Role</Label>
            <Input
              id="officer-role"
              value={settings.officerRole}
              onChange={(event) => updateSettings({ officerRole: event.target.value })}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="checkpoint">Checkpoint</Label>
            <Input
              id="checkpoint"
              value={settings.checkpoint}
              onChange={(event) => updateSettings({ checkpoint: event.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scan policy</CardTitle>
          <CardDescription>How watchlist hits are treated on this desk.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4 rounded-xl bg-muted px-4 py-4">
          <div>
            <div className="text-sm font-medium">Auto-hold watchlist matches</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Force a hold when a scanned name matches an entry on the watchlist.
            </p>
          </div>
          <Switch
            checked={settings.autoHoldWatchlist}
            onCheckedChange={(checked) => updateSettings({ autoHoldWatchlist: checked })}
            aria-label="Auto-hold watchlist matches"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Verification provenance</CardTitle>
          <CardDescription>
            Every case in this workspace comes from the live document and
            biometric pipeline. No sample history, and no mock identity data,
            is consulted.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
            The identity provider is non-authoritative until a real issuer
            integration is configured, so a case cannot reach VERIFIED on
            biometric evidence alone.
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              clearCases();
              toast.success("Case history cleared");
            }}
          >
            Clear case history
          </Button>
        </CardContent>
      </Card>

    </div>
  );
}
