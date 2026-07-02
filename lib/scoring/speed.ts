// U7. Speed-based scoring (R7, R4, KTD4, KTD1). A correct in-window answer earns
// a guaranteed floor plus a time bonus that decays linearly across the answer
// window. The bonus is normalized against a fraction of *that* mode's own timer
// (ANSWER_TIMER_MS), so an equally-prompt answer earns a comparable score
// regardless of mode — type-the-answer is not penalized for being inherently
// slower (AE2), and its longer window makes the absolute per-second drop gentler.
// A correct answer at the reveal instant scores MAX_POINTS; at the deadline it
// scores FLOOR_POINTS and never less. All timestamps are server-side (KTD4).

import type { AnswerMode } from "@/lib/db/types";
import { ANSWER_TIMER_MS } from "@/lib/gameConfig";

// Range 100–1000: any correct in-window answer earns at least FLOOR_POINTS, and
// the time bonus (MAX_POINTS - FLOOR_POINTS) decays to 0 at the deadline.
export const FLOOR_POINTS = 100;
export const MAX_POINTS = 1000;
export const TIME_BONUS = MAX_POINTS - FLOOR_POINTS;

export interface ScoreInput {
  correct: boolean;
  mode: AnswerMode;
  revealAtMs: number;
  submitAtMs: number;
}

/**
 * Points for one answer. Wrong, late (past the window), or missing answers score
 * 0. Otherwise FLOOR_POINTS plus a linear time bonus in [0, TIME_BONUS] that is
 * largest at the reveal instant and reaches 0 at the deadline — so a correct
 * answer is worth MAX_POINTS at reveal and exactly FLOOR_POINTS at the deadline.
 */
export function computeScore({ correct, mode, revealAtMs, submitAtMs }: ScoreInput): number {
  if (!correct) return 0;

  const timerMs = ANSWER_TIMER_MS[mode];
  const elapsed = submitAtMs - revealAtMs;
  if (elapsed > timerMs) return 0; // late — outside the window
  const clamped = Math.max(0, elapsed); // guard clock skew before reveal

  const fraction = clamped / timerMs; // 0 at reveal, 1 at deadline
  const bonus = Math.round(TIME_BONUS * (1 - fraction));
  return FLOOR_POINTS + bonus;
}
