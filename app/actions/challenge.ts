"use server";
// U8. Raise a challenge on the active question (R10, R11, R13; AE5; KTD7).
// Player-token-gated: the acting player is resolved from their token and the
// per-player cap is keyed to that validated identity, never a client-claimed id.
// Raising a challenge pauses the game for everyone (broadcast pause); the host
// then adjudicates (adjudicate action).

import { getServiceClient } from "@/lib/supabase/server";
import { resolvePlayerByToken } from "@/lib/serverAuth";
import { isAtChallengeCap, type ChallengeKind } from "@/lib/challenge";
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
  if (!game || game.status !== "active" || game.current_index < 0) {
    throw new Error("No active question to challenge");
  }

  const { data: question } = await supabase
    .from("questions")
    .select("id")
    .eq("game_id", game.id)
    .eq("index", game.current_index)
    .single();
  if (!question) throw new Error("No active question to challenge");

  // Cap keyed to the validated player (KTD7, R13) — count this player's
  // challenges across the whole game.
  const { count } = await supabase
    .from("challenges")
    .select("id", { count: "exact", head: true })
    .eq("player_id", player.playerId);
  if (isAtChallengeCap(count ?? 0)) {
    throw new Error("You've reached the challenge limit for this game");
  }

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

  const { data: inserted, error } = await supabase
    .from("challenges")
    .insert({
      question_id: question.id,
      player_id: player.playerId,
      type,
      status: "open",
      submitted_text: submittedText,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not raise challenge: ${error.message}`);

  // Pause play for all devices; the host's panel reads authoritative detail via
  // list_open_challenges (KTD8).
  await supabase.from("games").update({ paused: true }).eq("id", game.id);
  await broadcastToRoom(game.code, ROOM_EVENTS.pause, { challengeId: inserted.id });

  return { id: inserted.id as string };
}
