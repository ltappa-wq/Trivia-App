"use server";
// U5. Player join flow (F2; R5; KTD7, KTD8).
// Mints a high-entropy server-issued player token — the player's identity
// credential, never derived from client input — and emits a player-joined
// Broadcast so the host lobby updates live (a bare channel subscribe notifies
// no one, KTD8). Join attempts are rate-limited per IP so room codes can't be
// enumerated (KTD7). Only the token hash is stored (migration 0009).

import { getServiceClient } from "@/lib/supabase/server";
import { generateToken, hashToken } from "@/lib/codes";
import { checkSharedRateLimit } from "@/lib/rateLimit";
import { callerIp } from "@/lib/serverRequest";
import { broadcastToRoom } from "@/lib/realtime/broadcast";
import { ROOM_EVENTS } from "@/lib/realtime/events";
import {
  isValidCodeShape,
  normalizeCode,
  normalizeUsername,
  seatForStatus,
  validateUsername,
} from "@/lib/join";
import { validateSuggestions } from "@/lib/suggestions";

// Per-IP join throttle (shared across serverless via check_rate_limit, migration
// 0009). Kept for basic abuse control; 30/min is high enough for a room to fill
// from a shared venue network without blocking legitimate players.
const JOIN_LIMIT = 30;
const JOIN_WINDOW_MS = 60_000;

export interface JoinResult {
  playerId: string;
  /** Plaintext player token — returned once to this client (KTD7). */
  token: string;
  username: string;
  code: string;
  isSpectator: boolean;
}

/**
 * Seat a player, optionally carrying the categories they'd like to see (U9/R7).
 * Suggestions ride along with the join rather than a separate call so there is
 * no pre-join room lookup to enumerate against (KTD7).
 */
export async function joinGame(
  rawCode: string,
  rawUsername: string,
  rawSuggestions?: string[],
): Promise<JoinResult> {
  const code = normalizeCode(rawCode);
  if (!isValidCodeShape(code)) {
    throw new Error("Enter a valid 5-digit room code");
  }

  const username = normalizeUsername(rawUsername);
  const nameCheck = validateUsername(username);
  if (!nameCheck.ok) throw new Error(nameCheck.error);

  // Validate before the rate-limit spend and before seating: a bad selection
  // should cost the caller nothing and leave no half-joined player.
  const suggestionCheck = validateSuggestions(rawSuggestions);
  if (!suggestionCheck.ok) throw new Error(suggestionCheck.error);

  const supabase = getServiceClient();
  if (!(await checkSharedRateLimit(supabase, `join:${await callerIp()}`, JOIN_LIMIT, JOIN_WINDOW_MS))) {
    throw new Error("Too many attempts — please wait a moment.");
  }

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
      token_hash: hashToken(token),
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

  // Suggestions only mean something while the host can still act on them: once
  // the game is active the set is already generated (U8), so a mid-game joiner's
  // picks are silently dropped rather than recorded as noise the host can't use.
  const suggestions = game.status === "lobby" ? suggestionCheck.value : [];
  if (suggestions.length > 0) {
    const { error: suggestError } = await supabase.from("category_suggestions").insert(
      suggestions.map((category) => ({
        game_id: game.id,
        player_id: player.id,
        category,
      })),
    );
    if (suggestError) {
      // Non-fatal: the player is seated and the game is fully playable without
      // their suggestions. Log so a persistent failure is detectable.
      console.error(`[joinGame] suggestion insert failed for ${player.id}: ${suggestError.message}`);
    }
  }

  await broadcastToRoom(code, ROOM_EVENTS.playerJoined, {
    id: player.id,
    username,
    isSpectator: seat.isSpectator,
    suggestions,
  });

  return {
    playerId: player.id,
    token,
    username,
    code,
    isSpectator: seat.isSpectator,
  };
}
