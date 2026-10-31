"use server";

import { getServiceClient } from "@/lib/supabase/server";
import { authorizeHostByCode } from "@/lib/serverAuth";
import { broadcastToRoom } from "@/lib/realtime/broadcast";
import { ROOM_EVENTS } from "@/lib/realtime/events";

export type Ruling = "uphold" | "reject";

export async function adjudicate(
  code: string,
  hostToken: string,
  challengeId: string,
  ruling: Ruling,
  correction?: string,
): Promise<{ resumed: boolean }> {
  const supabase = getServiceClient();
  const game = await authorizeHostByCode(supabase, code, hostToken);
  if (game.status === "ended") throw new Error("This game has ended");

  const { data: challenge, error: lookupError } = await supabase
    .from("challenges")
    .select("question_id, type, questions!inner(game_id)")
    .eq("id", challengeId)
    .maybeSingle();
  if (lookupError) throw new Error(`Could not load challenge: ${lookupError.message}`);
  const embedded = challenge?.questions as { game_id: string } | { game_id: string }[] | null;
  const challengeGameId = Array.isArray(embedded) ? embedded[0]?.game_id : embedded?.game_id;
  if (!challenge || challengeGameId !== game.id) throw new Error("Challenge not found");

  const { data, error } = await supabase.rpc("resolve_challenge", {
    p_game_id: game.id,
    p_challenge_id: challengeId,
    p_uphold: ruling === "uphold",
    p_correction: correction ?? null,
  });
  if (error) {
    if (error.message.includes("already resolved")) throw new Error("Challenge already resolved");
    throw new Error(`Could not resolve challenge: ${error.message}`);
  }

  if (ruling === "uphold" && challenge.type === "question") {
    await broadcastToRoom(game.code, ROOM_EVENTS.void, { questionId: challenge.question_id });
  }
  const result = data as { resumed: boolean };
  if (result.resumed) await broadcastToRoom(game.code, ROOM_EVENTS.resume, {});
  await broadcastToRoom(game.code, ROOM_EVENTS.leaderboard, {});
  return result;
}
