"use client";

import { useState, useSyncExternalStore } from "react";
import { CATEGORIES } from "@/lib/gameConfig";
import { validateCustomCategory } from "@/app/actions/validateCategory";
import { clearSavedSetup, readSavedSetupJson, parseSavedSetup, type SavedSetup } from "@/lib/savedSetup";

function subscribe(notify: () => void) {
  window.addEventListener("storage", notify);
  return () => window.removeEventListener("storage", notify);
}

export function SavedSetupControls({ onRestore, onBusy }: {
  onRestore: (settings: SavedSetup) => void;
  onBusy: (busy: boolean) => void;
}) {
  const json = useSyncExternalStore(subscribe, readSavedSetupJson, () => null);
  const [cleared, setCleared] = useState(false);
  const saved = cleared || !json ? null : parseSavedSetup(json);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    if (!saved || busy) return;
    setBusy(true);
    onBusy(true);
    setError(null);
    try {
      const categories: string[] = [];
      for (const category of saved.categories) {
        if ((CATEGORIES as readonly string[]).includes(category)) categories.push(category);
        else {
          const result = await validateCustomCategory(category, saved.familyFriendly ?? false);
          if (!result.ok) throw new Error(`${category}: ${result.error}`);
          categories.push(result.category);
        }
      }
      onRestore({ ...saved, categories: [...new Set(categories)] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check saved categories. Try again.");
    } finally { setBusy(false); onBusy(false); }
  }

  if (!saved) return null;
  return <div className="saved-setup">
    <button type="button" disabled={busy} onClick={() => void restore()}>
      {busy ? "Checking saved categories…" : "Use last settings"}
    </button>{" "}
    <button type="button" disabled={busy} onClick={() => {
      clearSavedSetup(); setCleared(true); setError(null);
    }}>Clear saved settings</button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
