// U7. Speed-based scoring (R7, KTD4). A correct answer earns a flat base plus a
// time bonus that decays across the answer window. The window length is per-mode
// (ANSWER_TIMER_MS), and the bonus is computed against a fraction of *that* mode's
// own timer, so an equally-prompt answer earns a comparable bonus regardless of
// mode — type-the-answer is not penalized for being inherently slower (AE2). The
// per-mode decay exponent is gentler for type-the-answer, so at equal fraction it
// is never scored below multiple choice. All timestamps are server-side (KTD4).

import type { AnswerMode } from "@/lib/db/types";
import { ANSWER_TIMER_MS } from "@/lib/gameConfig";

export const BASE_POINTS = 100;
export const MAX_TIME_BONUS = 100;

// Lower exponent = gentler decay = more bonus retained as time passes.
export const DECAY_EXPONENT: Record<AnswerMode, number> = {
  multiple_choice: 1.0,
  type_answer: 0.7,
};

export interface ScoreInput {
  correct: boolean;
  mode: AnswerMode;
  revealAtMs: number;
  submitAtMs: number;
}

/**
 * Points for one answer. Wrong, late (past the window), or missing answers score
 * 0. Otherwise base + a time bonus in [0, MAX_TIME_BONUS] that is largest at the
 * reveal instant and reaches 0 at the deadline.
 */
export function computeScore({ correct, mode, revealAtMs, submitAtMs }: ScoreInput): number {
  if (!correct) return 0;

  const timerMs = ANSWER_TIMER_MS[mode];
  const elapsed = submitAtMs - revealAtMs;
  if (elapsed > timerMs) return 0; // late — outside the window
  const clamped = Math.max(0, elapsed); // guard clock skew before reveal

  const fraction = clamped / timerMs; // 0 at reveal, 1 at deadline
  const bonus = Math.round(MAX_TIME_BONUS * (1 - fraction) ** DECAY_EXPONENT[mode]);
  return BASE_POINTS + bonus;
}
