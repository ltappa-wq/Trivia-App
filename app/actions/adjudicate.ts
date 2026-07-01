"use server";
// U8. Host adjudication of a challenge (R11, R12, R14; AE3, AE4; KTD7).
// Host-token-gated. Uphold of a question challenge voids the question, reverses
// every score it awarded, and records the bad question with its correction so it
// is not reused (R14). Uphold of a disputed-answer challenge counts that answer
// correct and rescores it. The host's ruling is final. Play resumes once no open
// challenge remains.

import { getServiceClient } from "@/lib/supabase/server";
import { authorizeHostByCode } from "@/lib/serverAuth";
import { voidScoreDeltas } from "@/lib/challenge";
import { computeScore } from "@/lib/scoring/speed";
import { broadcastToRoom } from "@/lib/realtime/broadcast";
import { ROOM_EVENTS } from "@/lib/realtime/events";

export type Ruling = "uphold" | "reject";

async function addToScore(
  supabase: ReturnType<typeof getServiceClient>,
  playerId: string,
  delta: number,
): Promise<void> {
  if (delta === 0) return;
  const { data } = await supabase.from("players").select("score").eq("id", playerId).single();
  await supabase
    .from("players")
    .update({ score: Math.max(0, (data?.score ?? 0) + delta) })
    .eq("id", playerId);
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
  if (challenge.status !== "open") throw new Error("Challenge already resolved");

  if (ruling === "reject") {
    await supabase
      .from("challenges")
      .update({ status: "rejected", resolution: "Rejected by host" })
      .eq("id", challengeId);
  } else if (challenge.type === "question") {
    // Void + reverse every awarded point on this question (R12), then record the
    // bad question with its correction (R14).
    const { data: answers } = await supabase
      .from("answers")
      .select("player_id, awarded_points")
      .eq("question_id", question.id);
    for (const [playerId, delta] of voidScoreDeltas(answers ?? [])) {
      await addToScore(supabase, playerId, delta);
    }
    await supabase
      .from("answers")
      .update({ awarded_points: 0, is_correct: false })
      .eq("question_id", question.id);
    await supabase
      .from("questions")
      .update({ voided: true, correction: correction ?? "Voided by host challenge" })
      .eq("id", question.id);
    await supabase
      .from("challenges")
      .update({ status: "upheld", resolution: "Question voided" })
      .eq("id", challengeId);
    await broadcastToRoom(game.code, ROOM_EVENTS.void, { questionId: question.id });
  } else {
    // Disputed answer: count the challenger's answer correct and rescore it (R12).
    const { data: answer } = await supabase
      .from("answers")
      .select("id, awarded_points, submitted_at")
      .eq("question_id", question.id)
      .eq("player_id", challenge.player_id)
      .maybeSingle();
    if (!answer) throw new Error("Disputed answer no longer exists");
    if (!game.reveal_at) throw new Error("Question timing unavailable");

    const newPoints = computeScore({
      correct: true,
      mode: game.answer_mode,
      revealAtMs: new Date(game.reveal_at).getTime(),
      submitAtMs: new Date(answer.submitted_at as string).getTime(),
    });
    const delta = newPoints - (answer.awarded_points as number);
    await supabase
      .from("answers")
      .update({ is_correct: true, awarded_points: newPoints })
      .eq("id", answer.id);
    await addToScore(supabase, challenge.player_id as string, delta);
    await supabase
      .from("challenges")
      .update({ status: "upheld", resolution: "Answer counted correct" })
      .eq("id", challengeId);
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
