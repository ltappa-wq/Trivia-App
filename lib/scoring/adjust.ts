import "server-only";
// Atomic leaderboard updates via adjust_player_score (migration 0009).
// Avoids read-modify-write races between submitAnswer and adjudicate.

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Apply per-player score deltas with SQL `score = greatest(0, score + delta)`.
 * Zero deltas are skipped. Throws if any RPC fails.
 */
export async function applyScoreDeltas(
  supabase: SupabaseClient,
  deltas: Map<string, number>,
): Promise<void> {
  const entries = [...deltas.entries()].filter(([, d]) => d !== 0);
  if (entries.length === 0) return;

  const results = await Promise.all(
    entries.map(([playerId, delta]) =>
      supabase.rpc("adjust_player_score", {
        p_player_id: playerId,
        p_delta: delta,
      }),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    throw new Error(`Failed to update score: ${failed.error.message}`);
  }
}

/** Add points to one player (submit path). No-op when points <= 0. */
export async function addPlayerPoints(
  supabase: SupabaseClient,
  playerId: string,
  points: number,
): Promise<void> {
  if (points <= 0) return;
  const { error } = await supabase.rpc("adjust_player_score", {
    p_player_id: playerId,
    p_delta: points,
  });
  if (error) throw new Error(`Failed to record score: ${error.message}`);
}
