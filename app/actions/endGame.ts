"use server";
// U9. End the game and reveal final standings (R15, F5; KTD7).
// Host-token-gated and idempotent — marking an already-ended game ends is a
// no-op. Standings are the durable player scores (source of truth); no state
// persists beyond the game's durable records.

import { getServiceClient } from "@/lib/supabase/server";
import { authorizeHostByCode } from "@/lib/serverAuth";
import { broadcastToRoom } from "@/lib/realtime/broadcast";
import { ROOM_EVENTS } from "@/lib/realtime/events";

export async function endGame(code: string, hostToken: string): Promise<{ ended: true }> {
  const supabase = getServiceClient();
  const game = await authorizeHostByCode(supabase, code, hostToken);

  if (game.status !== "ended") {
    await supabase.from("games").update({ status: "ended", paused: false }).eq("id", game.id);
    await broadcastToRoom(game.code, ROOM_EVENTS.results, {});
  }
  return { ended: true };
}
