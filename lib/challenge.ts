// Pure challenge/adjudication helpers. Score recompute math is DB-independent
// so it is unit-testable; the actions apply it against Postgres.
// Per-player game-wide challenge caps were removed so players can always
// dispute AI errors; anti-spam remains via one open challenge per player per
// question (DB unique index) + host adjudication before advance.

import type { AnswerMode } from "@/lib/db/types";
import { computeScore } from "@/lib/scoring/speed";

export type ChallengeKind = "question" | "answer";

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

/**
 * Rescore an upheld disputed answer as correct (R12, AE4): the new speed score
 * for the answer and the delta to add to the player's total (new minus what was
 * already awarded). Uses the same server-side scoring as live submission (KTD4).
 */
export function disputedAnswerDelta(params: {
  mode: AnswerMode;
  revealAtMs: number;
  submitAtMs: number;
  currentAwarded: number;
}): { newPoints: number; delta: number } {
  const newPoints = computeScore({
    correct: true,
    mode: params.mode,
    revealAtMs: params.revealAtMs,
    submitAtMs: params.submitAtMs,
  });
  return { newPoints, delta: newPoints - params.currentAwarded };
}
