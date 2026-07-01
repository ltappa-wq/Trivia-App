import "server-only";
// KTD7 write-side authorization. Service-role server actions bypass RLS, so each
// privileged action must authorize its own caller — read-side RLS protects
// nothing here. "Host" and "player" are credentials (tokens), not "whoever
// opened the route": host-only actions require the host token; player actions
// resolve the acting player from their token and never trust a client-supplied
// player_id.

import { timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashToken } from "@/lib/codes";
import type { GameRow } from "@/lib/db/types";

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Authorize a host-only action by room code; throws if the token doesn't match
 * the stored hash. Returns the game row for the action to act on. */
export async function authorizeHostByCode(
  supabase: SupabaseClient,
  code: string,
  hostToken: string,
): Promise<GameRow> {
  const { data, error } = await supabase
    .from("games")
    .select("*")
    .eq("code", code.toUpperCase())
    .maybeSingle();
  if (error) throw new Error(`Lookup failed: ${error.message}`);
  if (!data) throw new Error("Game not found");
  if (!constantTimeEqualHex(data.host_token_hash, hashToken(hostToken))) {
    throw new Error("Not authorized");
  }
  return data as GameRow;
}

export interface ResolvedPlayer {
  playerId: string;
  gameId: string;
  isSpectator: boolean;
  score: number;
}

/** Resolve the acting player from their server-issued token (KTD7). Throws on an
 * unknown token so a forged/absent credential can never act. */
export async function resolvePlayerByToken(
  supabase: SupabaseClient,
  token: string,
): Promise<ResolvedPlayer> {
  const { data, error } = await supabase
    .from("players")
    .select("id, game_id, is_spectator, score")
    .eq("token", token)
    .maybeSingle();
  if (error) throw new Error(`Lookup failed: ${error.message}`);
  if (!data) throw new Error("Invalid player token");
  return {
    playerId: data.id as string,
    gameId: data.game_id as string,
    isSpectator: data.is_spectator as boolean,
    score: data.score as number,
  };
}
