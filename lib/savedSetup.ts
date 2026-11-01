import { validateSetupInput, type SetupInput } from "@/lib/gameConfig";

export interface SavedSetup extends SetupInput {
  hostPlays: boolean;
  hostName: string;
}
export const SAVED_SETUP_KEY = "buzzr:last-setup";
// Pacing options are optional additions to v1; older saves keep legacy defaults.
const VERSION = 1;

function withGameOptions(settings: SavedSetup): SavedSetup {
  return {
    ...settings,
    answerTimerMs: settings.answerTimerMs ?? null,
    autoAdvanceMs: settings.autoAdvanceMs ?? null,
    doublePointsFinale: settings.doublePointsFinale ?? false,
  };
}

export function parseSavedSetup(json: string): SavedSetup | null {
  try {
    const raw = JSON.parse(json);
    if (!raw || raw.version !== VERSION) return null;
    const result = validateSetupInput(raw.settings);
    if (!result.ok || typeof raw.settings.hostPlays !== "boolean" ||
        typeof raw.settings.hostName !== "string" || raw.settings.hostName.length > 20) return null;
    // Pick known fields explicitly so newer optional fields can be ignored.
    return withGameOptions({ ...result.value, hostPlays: raw.settings.hostPlays, hostName: raw.settings.hostName });
  } catch { return null; }
}

export function readSavedSetupJson(): string | null {
  try { return window.localStorage.getItem(SAVED_SETUP_KEY); }
  catch { return null; }
}
export function readSavedSetup(): SavedSetup | null {
  return parseSavedSetup(readSavedSetupJson() ?? "");
}
export function saveSetup(settings: SavedSetup): void {
  try { window.localStorage.setItem(SAVED_SETUP_KEY, JSON.stringify({ version: VERSION, settings: withGameOptions(settings) })); }
  catch { /* Private browsing / quotas must not prevent room creation. */ }
}
export function clearSavedSetup(): void {
  try { window.localStorage.removeItem(SAVED_SETUP_KEY); }
  catch { /* Storage may be unavailable. */ }
}
