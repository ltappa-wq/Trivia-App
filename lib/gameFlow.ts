// U6/U9. Pure game-progression helpers. The host advance action (U6) and end
// detection (U9) share this so "what comes after question i" is defined once.

import type { AnswerMode } from "@/lib/db/types";
import { ANSWER_TIMER_MS } from "@/lib/gameConfig";
import { remainingMs } from "@/lib/realtime/clock";

/**
 * The index to reveal after `current`, given a 0-based question set of length
 * `count`. Returns null when there is no next question — the caller ends the
 * game (U9) rather than advancing past the last question. `current === -1` is
 * the pre-start state, so the first reveal is index 0.
 */
export function computeNextIndex(current: number, count: number): number | null {
  const next = current + 1;
  return next < count ? next : null;
}

/** True when `index` is the final question of a `count`-length set. */
export function isLastIndex(index: number, count: number): boolean {
  return index === count - 1;
}

/**
 * R4. Whether the host's timer-expiry auto-close should fire *right now* for the
 * current question. Deliberately recomputes remaining time from `reveal_at`
 * directly rather than trusting a React `remaining` render value: on the commit
 * immediately after `advance`, `game` has moved to the next question but the
 * countdown state can still hold the previous question's stale 0, which would
 * otherwise close the freshly-revealed question the instant it appears. Reading
 * `reveal_at` makes the decision immune to that lag.
 */
export function shouldAutoClose(
  game: { reveal_at: string | null; answer_mode: AnswerMode; current_index: number },
  offset: number,
  now: number = Date.now(),
): boolean {
  if (game.current_index < 0 || !game.reveal_at) return false;
  const remaining = remainingMs(
    new Date(game.reveal_at).getTime(),
    ANSWER_TIMER_MS[game.answer_mode],
    offset,
    now,
  );
  return remaining <= 0;
}
