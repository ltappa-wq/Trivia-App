// U6/U9. Pure game-progression helpers. The host advance action (U6) and end
// detection (U9) share this so "what comes after question i" is defined once.

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
