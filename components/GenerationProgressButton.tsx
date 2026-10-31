"use client";

import { useEffect, useState } from "react";
import { getGenerationProgress } from "@/app/actions/startGame";
import type { GenerationProgress } from "@/lib/generation/progress";

/** Kept inside the lobby: polling also recovers after reload or lost events. */
export function GenerationProgressButton({ code, token, total, starting, disabled, onStart }: {
  code: string;
  token: string | null;
  total: number;
  starting: boolean;
  disabled: boolean;
  onStart: () => Promise<void>;
}) {
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    if (!token) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const next = await getGenerationProgress(code, token!);
        if (active) { setProgress(next); setLoadError(false); }
      } catch {
        if (active) setLoadError(true);
      }
      if (active) timer = setTimeout(refresh, 2000);
    }
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [code, token, starting]);
  const running = starting || progress?.running;
  return <>
    <button type="button" disabled={disabled || Boolean(running) || !progress}
      onClick={() => { setProgress(null); void onStart(); }}>
      {running ? `Writing questions… ${progress?.completed ?? 0}/${total}`
        : progress?.error ? "Retry" : "Start game"}
    </button>
    {running && <p role="status">The AI is writing your game. Players stay seated.</p>}
    {progress?.error && !running && <p role="alert">{progress.error}</p>}
    {loadError && <p role="status">Could not refresh generation progress. Reconnecting…</p>}
  </>;
}
