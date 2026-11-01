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

  const { data: changed, error } = await supabase.rpc("end_game", {
    p_game_id: game.id,
  });
  if (error) throw new Error(`Could not end game: ${error.message}`);
  if (!changed) return { ended: true };

  await broadcastToRoom(game.code, ROOM_EVENTS.results, {});
  return { ended: true };
}
