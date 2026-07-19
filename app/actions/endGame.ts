"use server";
// U9. End the game and reveal final standings (R15, F5; KTD7).
// Host-token-gated and idempotent — marking an already-ended game ends is a
// no-op. Open challenges are auto-rejected so terminal state is consistent
// (no paused-with-open-dispute after finish). Standings are the durable player
// scores (source of truth).

import { getServiceClient } from "@/lib/supabase/server";
import { authorizeHostByCode } from "@/lib/serverAuth";
import { broadcastToRoom } from "@/lib/realtime/broadcast";
import { ROOM_EVENTS } from "@/lib/realtime/events";

export async function endGame(code: string, hostToken: string): Promise<{ ended: true }> {
  const supabase = getServiceClient();
  const game = await authorizeHostByCode(supabase, code, hostToken);

  if (game.status === "ended") {
    return { ended: true };
  }

  // Auto-reject any open challenges for this game before clearing pause.
  const { data: openRows } = await supabase
    .from("challenges")
    .select("id, questions!inner(game_id)")
    .eq("status", "open")
    .eq("questions.game_id", game.id);
  const openIds = (openRows ?? []).map((r) => r.id as string);
  if (openIds.length > 0) {
    const { error: rejectError } = await supabase
      .from("challenges")
      .update({ status: "rejected", resolution: "Game ended" })
      .in("id", openIds)
      .eq("status", "open");
    if (rejectError) {
      throw new Error(`Could not close open challenges: ${rejectError.message}`);
    }
  }

  const { error } = await supabase
    .from("games")
    .update({ status: "ended", paused: false, reviewing: false })
    .eq("id", game.id)
    .neq("status", "ended");
  if (error) throw new Error(`Could not end game: ${error.message}`);

  await broadcastToRoom(game.code, ROOM_EVENTS.results, {});
  return { ended: true };
}
