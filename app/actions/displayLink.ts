"use server";

import { getServiceClient } from "@/lib/supabase/server";
import { authorizeHostByCode } from "@/lib/serverAuth";
import { generateToken, hashToken } from "@/lib/codes";
import { broadcastToRoom } from "@/lib/realtime/broadcast";
import { ROOM_EVENTS } from "@/lib/realtime/events";

/** The raw token is returned once; replacing/removing its hash revokes old links. */
export async function updateDisplayLink(code: string, hostToken: string, revoke = false): Promise<string | null> {
  const client = getServiceClient();
  const game = await authorizeHostByCode(client, code, hostToken);
  const token = revoke ? null : generateToken();
  const { error } = await client.from("games").update({ display_token_hash: token ? hashToken(token) : null }).eq("id", game.id);
  if (error) throw new Error("Could not update TV display link");
  // Existing displays rehydrate and discard revoked credentials, without pacing.
  await broadcastToRoom(game.code, ROOM_EVENTS.leaderboard, {});
  return token;
}
