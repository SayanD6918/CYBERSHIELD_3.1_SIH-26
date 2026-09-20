/**
 * Demo controls are explicit and opt-in. Production/normal verification is
 * the default whenever VITE_DEMO_MODE is absent or not exactly "true".
 */
type ViteImportMeta = ImportMeta & { env?: Record<string, string | undefined> };

const env = (import.meta as ViteImportMeta).env;
export function isDemoMode(value: string | undefined): boolean {
  return value === "true";
}

export const DEMO_MODE = isDemoMode(env?.VITE_DEMO_MODE);

export type VerificationSource = "REAL" | "DEMO";
