"use server";
// U8. Raise a challenge on the active question (R10, R11, R13; AE5; KTD7).
// Player-token-gated: the acting player is resolved from their token and the
// per-player cap is keyed to that validated identity, never a client-claimed id.
// Spectators cannot raise challenges (they are not scoring). Raising a challenge
// pauses the game for everyone (broadcast pause); the host then adjudicates.

import { getServiceClient } from "@/lib/supabase/server";
import { resolvePlayerByToken } from "@/lib/serverAuth";
import { assertCanChallenge } from "@/lib/phaseGuards";
import type { ChallengeKind } from "@/lib/challenge";
import { broadcastToRoom } from "@/lib/realtime/broadcast";
import { ROOM_EVENTS } from "@/lib/realtime/events";

export async function challenge(token: string, type: ChallengeKind): Promise<{ id: string }> {
  const supabase = getServiceClient();
  const player = await resolvePlayerByToken(supabase, token);

  const { data: game } = await supabase
    .from("games")
    .select("id, code, current_index, status")
    .eq("id", player.gameId)
    .single();
  if (!game) throw new Error("No active question to challenge");
  assertCanChallenge(game, player.isSpectator);

  const { data: question } = await supabase
    .from("questions")
    .select("id")
    .eq("game_id", game.id)
    .eq("index", game.current_index)
    .single();
  if (!question) throw new Error("No active question to challenge");

  // For a disputed-answer challenge, capture the player's own submission so the
  // host can review it (R11).
  let submittedText: string | null = null;
  if (type === "answer") {
    const { data: answer } = await supabase
      .from("answers")
      .select("raw_answer")
      .eq("question_id", question.id)
      .eq("player_id", player.playerId)
      .maybeSingle();
    if (!answer) throw new Error("You have no answer to dispute on this question");
    submittedText = answer.raw_answer as string;
  }

  const { data: challengeId, error } = await supabase.rpc("create_challenge_and_pause", {
    p_game_id: game.id,
    p_question_id: question.id,
    p_player_id: player.playerId,
    p_type: type,
    p_submitted_text: submittedText,
  });
  if (error) {
    if (error.code === "23505") {
      throw new Error("You already have an open challenge on this question");
    }
    throw new Error(`Could not raise challenge: ${error.message}`);
  }
  await broadcastToRoom(game.code, ROOM_EVENTS.pause, { challengeId });

  return { id: challengeId as string };
}
