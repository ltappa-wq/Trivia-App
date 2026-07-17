// U7. Speed-based scoring (R7, R4, KTD4, KTD1). A correct answer earns the full
// MAX_POINTS if it lands within the first second of the answer window, then the
// score slides down linearly to DEADLINE_POINTS for an answer given right before
// the window closes. A wrong, late, or missing answer scores 0. The decay runs
// against *that* mode's own timer (ANSWER_TIMER_MS), so type-the-answer — which
// has a longer window — decays more gently across its extra time rather than
// being penalized for being inherently slower (AE2). All timestamps are
// server-side (KTD4); the client never computes its own score.

import type { AnswerMode } from "@/lib/db/types";
import { ANSWER_TIMER_MS } from "@/lib/gameConfig";

// Range 500–1000: an answer in the first second earns MAX_POINTS; the score then
// decays linearly to DEADLINE_POINTS at the deadline and never below it in-window.
export const MAX_POINTS = 1000;
export const DEADLINE_POINTS = 500;
// The opening grace window that earns full points (the "first second").
export const FULL_POINTS_MS = 1000;

export interface ScoreInput {
  correct: boolean;
  mode: AnswerMode;
  revealAtMs: number;
  submitAtMs: number;
}

/**
 * Points for one answer. Wrong, late (past the window), or missing answers score
 * 0. A correct answer within the first second (FULL_POINTS_MS) scores MAX_POINTS;
 * after that it decays linearly with elapsed time to exactly DEADLINE_POINTS at
 * the deadline, and never below DEADLINE_POINTS while still in the window.
 */
export function computeScore({ correct, mode, revealAtMs, submitAtMs }: ScoreInput): number {
  if (!correct) return 0;

  const timerMs = ANSWER_TIMER_MS[mode];
  const elapsed = submitAtMs - revealAtMs;
  if (elapsed > timerMs) return 0; // late — outside the window
  const clamped = Math.max(0, elapsed); // guard clock skew before reveal

  // The opening grace second earns full points.
  if (clamped <= FULL_POINTS_MS) return MAX_POINTS;

  // Decay window is the time after the grace second up to the deadline. Guard the
  // degenerate case where a mode's timer is shorter than the grace itself.
  const decayWindow = timerMs - FULL_POINTS_MS;
  if (decayWindow <= 0) return MAX_POINTS;

  const fraction = (clamped - FULL_POINTS_MS) / decayWindow; // 0 just after 1s, 1 at deadline
  const drop = Math.round((MAX_POINTS - DEADLINE_POINTS) * fraction);
  return MAX_POINTS - drop;
}
