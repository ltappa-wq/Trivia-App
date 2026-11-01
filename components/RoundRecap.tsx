"use client";

import { useState } from "react";
import type { HydratedState } from "@/lib/db/types";
import { observeRound, rankMovement, recapText, type RoundSnapshot } from "@/lib/roundRecap";

/** Kept outside ReviewStage to avoid coupling recap to answer explanations. */
export function useRoundSnapshot(state: HydratedState | null, phase: string) {
  const [observed, setObserved] = useState<{ state: HydratedState; phase: string; snapshot: RoundSnapshot } | null>(null);
  if (!state) return null;
  if (observed?.state !== state || observed.phase !== phase) {
    const previous = observed?.state.game.id === state.game.id ? observed.snapshot : null;
    const snapshot = observeRound(previous, state.game.current_index, phase, state.leaderboard);
    setObserved({ state, phase, snapshot });
    return snapshot.baseline;
  }
  return observed.snapshot.baseline;
}

export function RoundRecap({ state, baseline }: {
  state: HydratedState;
  baseline: HydratedState["leaderboard"] | null;
}) {
  if (state.role === "spectator" || !state.player) return null;
  return <p className="round-recap" role="status">
    {recapText(state.my_answer?.points ?? 0,
      rankMovement(state.leaderboard, baseline, state.player.id), state.current_question?.voided ?? false)}
  </p>;
}
