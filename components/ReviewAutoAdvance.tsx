"use client";

import type { ClientGame } from "@/lib/db/types";
import { useCountdown } from "@/lib/realtime/hooks";

export function ReviewAutoAdvance({ game, offset, busy, onToggle }: {
  game: ClientGame; offset: number; busy: boolean; onToggle: (enabled: boolean) => void;
}) {
  const duration = game.auto_advance_ms ?? null;
  const deadline = game.auto_advance_at ? Date.parse(game.auto_advance_at) : NaN;
  const startedAt = duration !== null && Number.isFinite(deadline)
    ? new Date(deadline - duration).toISOString() : null;
  const remaining = useCountdown(startedAt, duration, offset, game.paused);
  if (!game.reviewing || game.current_index >= game.question_count - 1 || !game.auto_advance_ms) return null;
  const scheduled = !!game.auto_advance_at;
  return <div>
    <p aria-live="polite">{game.paused ? "Auto-advance paused for challenge" : scheduled
      ? `Next question in ${Math.ceil((remaining ?? 0) / 1000)} seconds` : "Auto-advance paused for this question"}</p>
    <button type="button" disabled={busy || game.paused} onClick={() => onToggle(!scheduled)}>
      {scheduled ? "Pause auto-advance" : "Resume auto-advance"}
    </button>
  </div>;
}
