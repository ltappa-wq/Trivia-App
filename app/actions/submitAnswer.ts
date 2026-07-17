"use server";
// U7. Answer submission, judging & speed scoring (R7, R9; AE1, AE2; KTD4, KTD7).
// The acting player is resolved from their server-issued token — never a
// client-supplied player_id (KTD7). The server stamps the submit time, judges,
// and computes the speed score from submit-minus-reveal (KTD4); clients never
// compute their own score. One answer per player per question (dup-submit guard,
// enforced by the unique constraint in U2).

import { getServiceClient } from "@/lib/supabase/server";
import { resolvePlayerByToken } from "@/lib/serverAuth";
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
    .select("id, code, current_index, reveal_at, answer_mode, paused, status")
    .eq("id", player.gameId)
    .single();
  if (!game || game.status !== "active" || game.current_index < 0 || !game.reveal_at) {
    throw new Error("No active question");
  }
  if (game.paused) throw new Error("The game is paused");

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
    revealAtMs: new Date(game.reveal_at).getTime(),
    submitAtMs,
  });

  const { error: insertError } = await supabase.from("answers").insert({
    question_id: question.id,
    player_id: player.playerId,
    raw_answer: rawAnswer,
    is_correct: correct,
    awarded_points: points,
    submitted_at: new Date(submitAtMs).toISOString(),
  });
  if (insertError) {
    if (insertError.code === "23505") {
      throw new Error("You already answered this question");
    }
    throw new Error(`Could not record answer: ${insertError.message}`);
  }

  if (points > 0) {
    // Only this player's own submit touches their row, and the dup guard above
    // serializes it, so read-modify-write on the score is safe here.
    const { error: scoreError } = await supabase
      .from("players")
      .update({ score: player.score + points })
      .eq("id", player.playerId);
    // The answer row is already persisted; if the score write fails, surface it
    // rather than reporting a success that never landed on the leaderboard.
    if (scoreError) throw new Error(`Failed to record score: ${scoreError.message}`);
  }

  await broadcastToRoom(game.code, ROOM_EVENTS.leaderboard, { by: player.playerId });

  // R5.1/R5.4: once every active (non-spectator) player has answered this
  // question, close it into the review phase. Counts are server-side; spectators
  // can't answer (guarded above), so every answer row is from an active player.
  await maybeEnterReview(supabase, game.id, question.id, game.code, game.current_index);

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

/**
 * Enter the review phase if all active players have now answered the current
 * question. Uses a compare-and-set on `reviewing` so the `review` broadcast
 * fires exactly once even if the last two submits race.
 */
async function maybeEnterReview(
  supabase: ReturnType<typeof getServiceClient>,
  gameId: string,
  questionId: string,
  code: string,
  currentIndex: number,
): Promise<void> {
  const [{ count: activeCount }, { count: answeredCount }] = await Promise.all([
    supabase
      .from("players")
      .select("id", { count: "exact", head: true })
      .eq("game_id", gameId)
      .eq("is_spectator", false),
    supabase
      .from("answers")
      .select("id", { count: "exact", head: true })
      .eq("question_id", questionId),
  ]);

  if (activeCount === null || answeredCount === null) return;
  if (answeredCount < activeCount) return;

  // CAS: flip reviewing only from false, and only while still on this question,
  // so a late resume/advance can't be clobbered and the broadcast fires once.
  const { data: flipped } = await supabase
    .from("games")
    .update({ reviewing: true })
    .eq("id", gameId)
    .eq("current_index", currentIndex)
    .eq("reviewing", false)
    // Don't enter review on a game a challenge just paused (atomic guard).
    .eq("paused", false)
    .select("id")
    .maybeSingle();

  if (flipped) {
    await broadcastToRoom(code, ROOM_EVENTS.review, { index: currentIndex });
  }
}
