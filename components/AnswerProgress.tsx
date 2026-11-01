"use client";

import { useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";
import type { HydratedState } from "@/lib/db/types";

export interface AnswerProgressData {
  answered_count: number;
  active_count: number;
  answered_player_ids: string[];
}

/** Re-fetch on reconciled room state, including every leaderboard broadcast.
 * Stale responses are discarded when advancing to the next question. */
export function AnswerProgress({ state, token, isHost = false }: { state: HydratedState | null; token: string | null; isHost?: boolean }) {
  const [progress, setProgress] = useState<{ index: number; data: AnswerProgressData } | null>(null);
  useEffect(() => {
    if (!token || !state || state.game.status !== "active" || state.game.reviewing) return;
    let active = true;
    void Promise.resolve(getBrowserClient().rpc("answer_progress", { p_token: token })).then(({ data, error }) => {
      if (active && !error) setProgress(data ? { index: state.game.current_index, data: data as AnswerProgressData } : null);
    }).catch(() => {});
    return () => { active = false; };
  }, [state, token]);
  if (!state || progress?.index !== state.game.current_index) return null;
  const { data } = progress;
  return (
    <section aria-label="Answer progress">
      <p role="status">{data.answered_count} of {data.active_count} answered</p>
      {isHost && (
        <ul className="answer-progress__players" aria-label="Player answers">
          {state.leaderboard.map((p) => {
            const answered = data.answered_player_ids.includes(p.id);
            return <li key={p.id} className={answered ? "answer-progress__player answer-progress__player--answered" : "answer-progress__player"}>{p.username}{answered ? " ✓" : " — waiting"}</li>;
          })}
        </ul>
      )}
    </section>
  );
}
