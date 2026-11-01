"use server";

import { getServiceClient } from "@/lib/supabase/server";
import { callerIp } from "@/lib/serverRequest";
import { broadcastToRoom } from "@/lib/realtime/broadcast";
import { ROOM_EVENTS } from "@/lib/realtime/events";
import type { CreateGameResult } from "./createGame";
import type { JoinResult } from "./joinGame";

/** Database validates the old host token and atomically creates or recovers the link. */
export async function createRematch(code: string, token: string): Promise<CreateGameResult> {
  const { data, error } = await getServiceClient().rpc("create_rematch", {
    p_code: code, p_token: token, p_rate_key: `create:${await callerIp()}`,
  });
  if (error || !data) throw new Error(error?.message ?? "Could not create rematch");
  await broadcastToRoom(code, ROOM_EVENTS.rematch, {});
  return data as CreateGameResult;
}

/** The destination is resolved from the old player's game, never supplied by the client. */
export async function joinRematch(code: string, token: string): Promise<JoinResult> {
  const { data, error } = await getServiceClient().rpc("join_rematch", { p_code: code, p_token: token });
  if (error || !data) throw new Error(error?.message ?? "Could not join rematch");
  const result = data as JoinResult;
  await broadcastToRoom(result.code, ROOM_EVENTS.playerJoined, {
    id: result.playerId, username: result.username, isSpectator: result.isSpectator,
  });
  return result;
}
