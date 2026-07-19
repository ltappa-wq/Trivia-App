"use client";
// U10 / R3. End-game podium for the host shared screen. Reveals the top-three
// steps one at a time, 3rd -> 2nd -> 1st (R3.1); tied players share a step
// (R3.4); fewer than three scoring groups render fewer steps and nobody-scored
// renders nothing (R3.3). Ranking is pure (lib/results.podium); this component
// only sequences the reveal. The full standings still render alongside (R3.2).

import { useEffect, useMemo, useState } from "react";
import { formatScore } from "@/lib/formatScore";
import { podium } from "@/lib/results";
import type { LeaderboardEntry } from "@/lib/db/types";

const REVEAL_STEP_MS = 900;
const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };
// 1st centered, 2nd to its left, 3rd to its right — classic podium layout.
const VISUAL_ORDER: Record<number, number> = { 1: 2, 2: 1, 3: 3 };

export function Podium({ standings }: { standings: LeaderboardEntry[] }) {
  const steps = useMemo(() => podium(standings), [standings]);
  // Stable signature so a re-hydrate with identical results doesn't replay the
  // reveal (an upheld challenge that rescored would change it and replay — the
  // intended behavior).
  const signature = steps.map((s) => `${s.rank}:${s.score}:${s.players.map((p) => p.id).join(",")}`).join("|");
  const [revealed, setRevealed] = useState<Set<number>>(new Set());

  useEffect(() => {
    setRevealed(new Set());
    // Reveal by descending rank first: 3rd, then 2nd, then 1st.
    const order = [...steps].sort((a, b) => b.rank - a.rank);
    const timers = order.map((s, i) =>
      setTimeout(() => {
        setRevealed((prev) => new Set(prev).add(s.rank));
      }, (i + 1) * REVEAL_STEP_MS),
    );
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  if (steps.length === 0) return null;

  return (
    <div className="podium" aria-label="Top finishers">
      {steps.map((step) => (
        <div
          key={step.rank}
          className={`podium-step podium-step--${step.rank}${
            revealed.has(step.rank) ? " is-revealed" : ""
          }`}
          style={{ order: VISUAL_ORDER[step.rank] }}
        >
          <div className="podium-step__medal" aria-hidden="true">
            {MEDALS[step.rank]}
          </div>
          <div className="podium-step__names">
            {step.players.map((p) => (
              <span key={p.id} className="podium-step__name">
                {p.username}
              </span>
            ))}
          </div>
          <div className="podium-step__score">{formatScore(step.score)}</div>
          <div className="podium-step__block" aria-hidden="true">
            {step.rank}
          </div>
        </div>
      ))}
    </div>
  );
}
