// U6. Client clock reconciliation (KTD9). Devices have skewed clocks, so the
// countdown must be rendered against the server's authoritative reveal time, not
// a local start. Each client measures its offset to server time once on connect,
// then renders remaining time from `reveal_at + timer` corrected by that offset.
// The speed score is still computed server-side from submit-minus-reveal (KTD4);
// this only aligns the *displayed* countdown with the real submit window.

/**
 * Measure this client's offset from server time (serverNow - clientNow), folding
 * out the round trip by assuming symmetric latency: the server timestamp maps to
 * the midpoint of the request/response. Inject `fetchServerNow` and `now` for
 * tests.
 */
export async function measureClockOffset(
  fetchServerNow: () => Promise<number>,
  now: () => number = Date.now,
): Promise<number> {
  const t0 = now();
  const serverNow = await fetchServerNow();
  const t1 = now();
  return serverNow - (t0 + t1) / 2;
}

/**
 * Milliseconds left in the answer window, from the server-anchored `revealAtMs`
 * plus `timerMs`, evaluated at the offset-corrected local clock. Never negative.
 * Before reveal (get-ready phase) returns the full `timerMs` so callers that
 * only care about the answer window do not see a bloated pre-reveal total.
 */
export function remainingMs(
  revealAtMs: number,
  timerMs: number,
  offsetMs: number,
  now: number = Date.now(),
): number {
  const serverNow = now + offsetMs;
  const elapsed = serverNow - revealAtMs;
  if (elapsed < 0) return timerMs;
  return Math.max(0, timerMs - elapsed);
}

/** Milliseconds until `revealAtMs` on the offset-corrected clock (0 when open). */
export function msUntilReveal(
  revealAtMs: number,
  offsetMs: number,
  now: number = Date.now(),
): number {
  const serverNow = now + offsetMs;
  return Math.max(0, revealAtMs - serverNow);
}

/** True while the room is in the get-ready 3–2–1 interstitial before answers open. */
export function isGetReadyPhase(
  revealAt: string | null | undefined,
  offsetMs: number,
  now: number = Date.now(),
): boolean {
  if (!revealAt) return false;
  return msUntilReveal(new Date(revealAt).getTime(), offsetMs, now) > 0;
}
