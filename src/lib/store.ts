import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  CaseRecord,
  Decision,
  OfficerSettings,
  WatchlistEntry,
} from "./types.ts";

/** Starter watchlist so the feature is exercisable on a fresh install. */
const SEED_WATCHLIST: WatchlistEntry[] = [
  {
    id: "wl-1",
    name: "Viktor Hale",
    reason: "Interpol notice — document fraud",
    addedAt: "2026-08-16T10:00:00.000Z",
  },
  {
    id: "wl-2",
    name: "Mira Solano",
    reason: "Stolen blank passport series",
    addedAt: "2026-07-19T10:00:00.000Z",
  },
];

export const DEFAULT_OFFICER_NAME = "Sayan DN";

/** Officer names shipped by earlier builds, replaced on rehydration. */
const SUPERSEDED_OFFICER_NAMES = new Set(["Sayan Debnath", "Arnab K."]);

type AppState = {
  hydrated: boolean;
  cases: CaseRecord[];
  watchlist: WatchlistEntry[];
  settings: OfficerSettings;
  nextSerial: number;
  setHydrated: (value: boolean) => void;
  addCase: (record: Omit<CaseRecord, "id">, caseId?: string) => CaseRecord;
  addWatchlist: (name: string, reason: string) => void;
  removeWatchlist: (id: string) => void;
  updateSettings: (patch: Partial<OfficerSettings>) => void;
  clearCases: () => void;
};

function countDecision(cases: CaseRecord[], decision: Decision): number {
  return cases.filter((item) => item.decision === decision).length;
}

/**
 * Counts over the cases actually processed on this machine.
 *
 * Earlier builds padded these with 1,280 invented historical cases, which
 * made the overview look like a system in service rather than a prototype.
 */
export function computeStats(cases: CaseRecord[]) {
  return {
    total: cases.length,
    safe: countDecision(cases, "safe"),
    manual: countDecision(cases, "manual"),
    hold: countDecision(cases, "hold"),
  };
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      cases: [],
      watchlist: SEED_WATCHLIST,
      settings: {
        officerName: DEFAULT_OFFICER_NAME,
        officerRole: "Checkpoint officer",
        checkpoint: "Checkpoint 04",
        autoHoldWatchlist: true,
      },
      nextSerial: 1,
      setHydrated: (value) => set({ hydrated: value }),
      addCase: (record, caseId) => {
        // The verify page mints an ID and shows it to the officer for the
        // whole session. Ignoring it here meant the ID on screen never
        // matched the ID in the case list.
        const serial = get().nextSerial;
        const created: CaseRecord = {
          ...record,
          id: caseId ?? `BS-2026-${String(serial).padStart(5, "0")}`,
        };
        set({
          cases: [created, ...get().cases],
          nextSerial: caseId ? serial : serial + 1,
        });
        return created;
      },
      addWatchlist: (name, reason) => {
        const entry: WatchlistEntry = {
          id: `wl-${crypto.randomUUID()}`,
          name: name.trim(),
          reason: reason.trim() || "Officer added",
          addedAt: new Date().toISOString(),
        };
        set({ watchlist: [entry, ...get().watchlist] });
      },
      removeWatchlist: (id) => {
        set({ watchlist: get().watchlist.filter((item) => item.id !== id) });
      },
      updateSettings: (patch) => {
        set({ settings: { ...get().settings, ...patch } });
      },
      clearCases: () => {
        set({ cases: [], nextSerial: 1 });
      },
    }),
    {
      name: "cybershield-v1",
      skipHydration: true,
      partialize: (state) => ({
        cases: state.cases,
        watchlist: state.watchlist,
        settings: state.settings,
        nextSerial: state.nextSerial,
      }),
      merge: (persisted, current) => {
        const state = persisted as Partial<AppState>;
        // Cases written by an earlier build's demo generator are dropped on
        // load; nothing fabricated should survive into the case history.
        const persistedCases = Array.isArray(state.cases) ? state.cases : [];
        const realCases = persistedCases.filter((item) => item.provenance !== "DEMO");

        // Browsers that used an earlier build still hold the old officer
        // name in localStorage, so carry it forward to the current one.
        const settings = { ...current.settings, ...(state.settings ?? {}) };
        if (SUPERSEDED_OFFICER_NAMES.has(settings.officerName)) {
          settings.officerName = DEFAULT_OFFICER_NAME;
        }

        return {
          ...current,
          ...state,
          settings,
          cases: realCases,
          watchlist: Array.isArray(state.watchlist) ? state.watchlist : current.watchlist,
        };
      },
    },
  ),
);
