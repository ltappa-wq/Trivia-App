// U8. Pure challenge/adjudication helpers (R12, R13). The per-player cap and the
// void-recompute math are DB-independent so they are unit-testable; the actions
// apply them against Postgres.

export type ChallengeKind = "question" | "answer";

// Anti-griefing cap: a player can raise at most this many challenges per game so
// one flagger can't indefinitely stall play (R13, AE5). Tunable constant.
export const CHALLENGE_CAP = 3;

export function isAtChallengeCap(existingCount: number, cap: number = CHALLENGE_CAP): boolean {
  return existingCount >= cap;
}

/**
 * Per-player score adjustments to reverse when a question is voided: each
 * recorded answer's awarded points are subtracted from its player (R12). Answers
 * with 0 points contribute nothing.
 */
export function voidScoreDeltas(
  answers: { player_id: string; awarded_points: number }[],
): Map<string, number> {
  const deltas = new Map<string, number>();
  for (const a of answers) {
    if (a.awarded_points) {
      deltas.set(a.player_id, (deltas.get(a.player_id) ?? 0) - a.awarded_points);
    }
  }
  return deltas;
}
