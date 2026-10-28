"use server";
// U7. Answer submission, judging & speed scoring (R7, R9; AE1, AE2; KTD4, KTD7).
// The acting player is resolved from their server-issued token — never a
// client-supplied player_id (KTD7). The server stamps the submit time, judges,
// and computes the speed score from submit-minus-reveal (KTD4); clients never
// compute their own score. One answer per player per question (dup-submit guard,
// enforced by the unique constraint in U2). Review phase locks answering even
// when the answer key is revealable via RPC.

import { getServiceClient } from "@/lib/supabase/server";
import { resolvePlayerByToken } from "@/lib/serverAuth";
import { assertCanSubmitAnswer } from "@/lib/phaseGuards";
import { judgeMultipleChoice, judgeTypeAnswer } from "@/lib/judging/match";
import { computeScore } from "@/lib/scoring/speed";
import { currentStreak } from "@/lib/scoring/streak";
import { broadcastToRoom } from "@/lib/realtime/broadcast";
import { ROOM_EVENTS } from "@/lib/realtime/events";

export interface SubmitResult {
  correct: boolean;
  points: number;
  /** True when a mid-game spectator can't score the in-progress question. */
  spectating?: boolean;
  /** Trailing correct-answer streak (>=1 on a correct answer) for the badge. */
  streak?: number;
}

// One player's answered questions with correctness — the input to currentStreak.
type StreakHistoryRow = {
  is_correct: boolean;
  questions: { index: number } | { index: number }[] | null;
};

export async function submitAnswer(token: string, rawAnswer: string): Promise<SubmitResult> {
  // Server-side submit time — the honest input to the speed score (KTD4).
  const submitAtMs = Date.now();
  const supabase = getServiceClient();

  const player = await resolvePlayerByToken(supabase, token);

  const { data: game } = await supabase
    .from("games")
    .select("id, code, current_index, reveal_at, answer_mode, paused, status, reviewing")
    .eq("id", player.gameId)
    .single();
  if (!game) throw new Error("No active question");
  assertCanSubmitAnswer(game);

  // Get-ready interstitial: answers only after server-stamped reveal_at.
  const revealAtMs = new Date(game.reveal_at as string).getTime();
  if (submitAtMs < revealAtMs) {
    throw new Error("Question not open yet — get ready!");
  }

  // A spectator joined during this question — seated but not scored on it (U5).
  if (player.isSpectator) return { correct: false, points: 0, spectating: true };

  const { data: question } = await supabase
    .from("questions")
    .select("id, mode, correct_option, accepted_variants, voided")
    .eq("game_id", game.id)
    .eq("index", game.current_index)
    .single();
  if (!question || question.voided) throw new Error("No active question");

  const correct =
    question.mode === "multiple_choice"
      ? judgeMultipleChoice(Number.parseInt(rawAnswer, 10), question.correct_option ?? -1)
      : judgeTypeAnswer(rawAnswer, question.accepted_variants ?? []);

  const points = computeScore({
    correct,
    mode: game.answer_mode,
    revealAtMs,
    submitAtMs,
  });

  const { data: enteredReview, error: commitError } = await supabase.rpc("commit_answer", {
    p_game_id: game.id,
    p_question_id: question.id,
    p_player_id: player.playerId,
    p_expected_index: game.current_index,
    p_raw_answer: rawAnswer,
    p_is_correct: correct,
    p_points: points,
    p_submitted_at: new Date(submitAtMs).toISOString(),
  });
  if (commitError) {
    if (commitError.code === "23505") throw new Error("You already answered this question");
    throw new Error(`Could not record answer: ${commitError.message}`);
  }

  await broadcastToRoom(game.code, ROOM_EVENTS.leaderboard, { by: player.playerId });

  // R5.1/R5.4: once every active (non-spectator) player has answered this
  // question, close it into the review phase. Counts are server-side; spectators
  // can't answer (guarded above), so every answer row is from an active player.
  if (enteredReview) {
    await broadcastToRoom(game.code, ROOM_EVENTS.review, { index: game.current_index });
  }

  // Celebration flourish: the player's trailing correct-answer streak, derived
  // from their own persisted history (the row just inserted is included), so it
  // survives reload and the client never counts its own streak.
  const streak = correct
    ? await computeStreak(supabase, player.playerId)
    : undefined;

  return { correct, points, ...(streak !== undefined ? { streak } : {}) };
}

/** The player's current correct-answer streak from their answer history. */
async function computeStreak(
  supabase: ReturnType<typeof getServiceClient>,
  playerId: string,
): Promise<number | undefined> {
  const { data, error } = await supabase
    .from("answers")
    .select("is_correct, questions(index)")
    .eq("player_id", playerId);
  if (error || !data) return undefined;

  const history = (data as StreakHistoryRow[]).map((row) => {
    const q = Array.isArray(row.questions) ? row.questions[0] : row.questions;
    return { index: q?.index ?? -1, correct: row.is_correct };
  });
  return currentStreak(history.filter((r) => r.index >= 0));
}
