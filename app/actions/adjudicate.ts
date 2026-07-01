"use server";
// U8. Host adjudication of a challenge (R11, R12, R14; AE3, AE4; KTD7).
// Host-token-gated. Uphold of a question challenge voids the question, reverses
// every score it awarded, and records the bad question with its correction so it
// is not reused (R14). Uphold of a disputed-answer challenge counts that answer
// correct and rescores it. The host's ruling is final. Play resumes once no open
// challenge remains.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/supabase/server";
import { authorizeHostByCode } from "@/lib/serverAuth";
import { disputedAnswerDelta, voidScoreDeltas } from "@/lib/challenge";
import { broadcastToRoom } from "@/lib/realtime/broadcast";
import { ROOM_EVENTS } from "@/lib/realtime/events";

export type Ruling = "uphold" | "reject";

/**
 * Apply per-player score deltas: one batched read of the affected scores, then
 * concurrent updates. Throws if a read/update fails or a player row is missing —
 * defaulting a missing score to 0 (the previous behavior) silently corrupts the
 * leaderboard on a transient failure.
 */
async function applyScoreDeltas(
  supabase: SupabaseClient,
  deltas: Map<string, number>,
): Promise<void> {
  const ids = [...deltas.keys()].filter((id) => (deltas.get(id) ?? 0) !== 0);
  if (ids.length === 0) return;

  const { data: rows, error } = await supabase
    .from("players")
    .select("id, score")
    .in("id", ids);
  if (error || !rows) {
    throw new Error(`Failed to read scores for recompute: ${error?.message ?? "no data"}`);
  }
  const scoreById = new Map(rows.map((r) => [r.id as string, r.score as number]));

  const results = await Promise.all(
    ids.map((id) => {
      const current = scoreById.get(id);
      if (current === undefined) {
        throw new Error(`Score recompute referenced unknown player ${id}`);
      }
      const next = Math.max(0, current + (deltas.get(id) ?? 0));
      return supabase.from("players").update({ score: next }).eq("id", id);
    }),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(`Failed to update score: ${failed.error.message}`);
}

export async function adjudicate(
  code: string,
  hostToken: string,
  challengeId: string,
  ruling: Ruling,
  correction?: string,
): Promise<{ resumed: boolean }> {
  const supabase = getServiceClient();
  const game = await authorizeHostByCode(supabase, code, hostToken);

  const { data: challenge } = await supabase
    .from("challenges")
    .select("id, type, player_id, question_id, status, questions!inner(id, game_id, voided)")
    .eq("id", challengeId)
    .maybeSingle();
  // PostgREST may embed a to-one relation as an object or a single-element
  // array depending on the client version — normalize both.
  const embedded = challenge?.questions as
    | { id: string; game_id: string; voided: boolean }
    | { id: string; game_id: string; voided: boolean }[]
    | null
    | undefined;
  const question = Array.isArray(embedded) ? (embedded[0] ?? null) : (embedded ?? null);
  if (!challenge || !question || question.game_id !== game.id) {
    throw new Error("Challenge not found");
  }

  const upheld = ruling === "uphold";
  const resolution =
    ruling === "reject"
      ? "Rejected by host"
      : challenge.type === "question"
        ? "Question voided"
        : "Answer counted correct";

  // Atomically CLAIM the challenge (compare-and-set on status) before mutating
  // any scores. A double-fired ruling (host double-click, retried action, two
  // tabs) then applies exactly once — mirrors the CAS in advance.ts. Scores are
  // mutated only after the claim wins, so a resolution can't be applied twice.
  const { data: claimed } = await supabase
    .from("challenges")
    .update({ status: upheld ? "upheld" : "rejected", resolution })
    .eq("id", challengeId)
    .eq("status", "open")
    .select("id")
    .maybeSingle();
  if (!claimed) throw new Error("Challenge already resolved");

  if (upheld && challenge.type === "question") {
    // Void + reverse every awarded point on this question (R12), then record the
    // bad question with its correction (R14).
    const { data: answers } = await supabase
      .from("answers")
      .select("player_id, awarded_points")
      .eq("question_id", question.id);
    await applyScoreDeltas(supabase, voidScoreDeltas(answers ?? []));
    await supabase
      .from("answers")
      .update({ awarded_points: 0, is_correct: false })
      .eq("question_id", question.id);
    await supabase
      .from("questions")
      .update({ voided: true, correction: correction ?? "Voided by host challenge" })
      .eq("id", question.id);
    await broadcastToRoom(game.code, ROOM_EVENTS.void, { questionId: question.id });
  } else if (upheld) {
    // Disputed answer: count the challenger's answer correct and rescore it (R12).
    const { data: answer } = await supabase
      .from("answers")
      .select("id, awarded_points, submitted_at")
      .eq("question_id", question.id)
      .eq("player_id", challenge.player_id)
      .maybeSingle();
    if (!answer) throw new Error("Disputed answer no longer exists");
    if (!game.reveal_at) throw new Error("Question timing unavailable");

    const { newPoints, delta } = disputedAnswerDelta({
      mode: game.answer_mode,
      revealAtMs: new Date(game.reveal_at).getTime(),
      submitAtMs: new Date(answer.submitted_at as string).getTime(),
      currentAwarded: answer.awarded_points as number,
    });
    await supabase
      .from("answers")
      .update({ is_correct: true, awarded_points: newPoints })
      .eq("id", answer.id);
    await applyScoreDeltas(supabase, new Map([[challenge.player_id as string, delta]]));
  }

  // Resume only when no challenge is still open for this game (R11/R12).
  const { count: openRemaining } = await supabase
    .from("challenges")
    .select("id, questions!inner(game_id)", { count: "exact", head: true })
    .eq("status", "open")
    .eq("questions.game_id", game.id);

  const resumed = (openRemaining ?? 0) === 0;
  if (resumed) {
    await supabase.from("games").update({ paused: false }).eq("id", game.id);
    await broadcastToRoom(game.code, ROOM_EVENTS.resume, {});
  }
  // Scores changed either way — nudge clients to re-hydrate the leaderboard.
  await broadcastToRoom(game.code, ROOM_EVENTS.leaderboard, {});

  return { resumed };
}
