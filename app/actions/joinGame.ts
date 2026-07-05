"use server";
// U5. Player join flow (F2; R5; KTD7, KTD8).
// Mints a high-entropy server-issued player token — the player's identity
// credential, never derived from client input — and emits a player-joined
// Broadcast so the host lobby updates live (a bare channel subscribe notifies
// no one, KTD8). Join attempts are rate-limited per IP so room codes can't be
// enumerated (KTD7).

import { getServiceClient } from "@/lib/supabase/server";
import { generateToken } from "@/lib/codes";
import { RateLimiter } from "@/lib/rateLimit";
import { callerIp } from "@/lib/serverRequest";
import { broadcastToRoom } from "@/lib/realtime/broadcast";
import { ROOM_EVENTS } from "@/lib/realtime/events";
import {
  normalizeCode,
  normalizeUsername,
  seatForStatus,
  validateUsername,
} from "@/lib/join";

// Tightened (R6.2c): the 5-digit numeric code space is small (100k), so join
// throttling is a primary defense against code enumeration, not just abuse. 5
// attempts/min/IP makes a full scan impractical. Best-effort per serverless
// instance (see RateLimiter); a shared store is the deferred upgrade path.
const joinLimiter = new RateLimiter(5, 60_000); // 5 attempts / minute / IP

export interface JoinResult {
  playerId: string;
  /** Plaintext player token — returned once to this client (KTD7). */
  token: string;
  username: string;
  code: string;
  isSpectator: boolean;
}

export async function joinGame(rawCode: string, rawUsername: string): Promise<JoinResult> {
  if (!joinLimiter.check(await callerIp())) {
    throw new Error("Too many attempts — please wait a moment.");
  }

  const code = normalizeCode(rawCode);
  const username = normalizeUsername(rawUsername);
  const nameCheck = validateUsername(username);
  if (!nameCheck.ok) throw new Error(nameCheck.error);

  const supabase = getServiceClient();
  // Filter to live games (R6.2b, KTD2): an ended game's code may have been reused
  // by a new lobby/active game, so restricting the lookup to joinable statuses
  // both retires the ended code and avoids a multi-row match on a recycled value.
  const { data: game } = await supabase
    .from("games")
    .select("id, status")
    .eq("code", code)
    .in("status", ["lobby", "active"])
    .maybeSingle();
  if (!game) throw new Error("Game not found");

  const seat = seatForStatus(game.status);
  if (!seat.canJoin) throw new Error(seat.reason ?? "This game has ended");

  const token = generateToken();
  const { data: player, error } = await supabase
    .from("players")
    .insert({
      game_id: game.id,
      username,
      token,
      is_spectator: seat.isSpectator,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      throw new Error("That username is taken in this room — pick another.");
    }
    throw new Error(`Could not join: ${error.message}`);
  }

  await broadcastToRoom(code, ROOM_EVENTS.playerJoined, {
    id: player.id,
    username,
    isSpectator: seat.isSpectator,
  });

  return {
    playerId: player.id,
    token,
    username,
    code,
    isSpectator: seat.isSpectator,
  };
}
