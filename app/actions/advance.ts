"use server";
// U6. Host-authoritative pacing (KTD3, KTD7, KTD8, KTD9).
// Start and advance are the same operation: reveal the next question. The action
// is host-token-gated and idempotent on current_index via a compare-and-set, so
// a double-fire (or a retried broadcast) can't skip a question. It stamps
// reveal_at server-side (never trusting the client clock) and broadcasts the
// question as a delta; Postgres stays the source of truth (clients hydrate).

import { getServiceClient } from "@/lib/supabase/server";
import { authorizeHostByCode } from "@/lib/serverAuth";
import { computeNextIndex } from "@/lib/gameFlow";
import { broadcastToRoom } from "@/lib/realtime/broadcast";
import { ROOM_EVENTS } from "@/lib/realtime/events";
import { ANSWER_TIMER_MS } from "@/lib/gameConfig";

export type AdvanceResult =
  | { status: "advanced"; index: number; revealAt: string; timerMs: number }
  | { status: "noop"; index: number }
  | { status: "ended" };

/**
 * Reveal the question after `expectedIndex`. `expectedIndex` is the caller's
 * last-known current_index (-1 before start); the compare-and-set only advances
 * when the game is still there, making a double-fire a safe no-op.
 */
export async function advance(
  code: string,
  hostToken: string,
  expectedIndex: number,
): Promise<AdvanceResult> {
  const supabase = getServiceClient();
  const game = await authorizeHostByCode(supabase, code, hostToken);

  const next = computeNextIndex(expectedIndex, game.question_count);
  if (next === null) {
    return { status: "ended" };
  }

  const revealAt = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("games")
    .update({
      current_index: next,
      reveal_at: revealAt,
      paused: false,
      status: "active",
    })
    .eq("id", game.id)
    .eq("current_index", expectedIndex) // CAS: only if still at expected index
    .select("current_index")
    .maybeSingle();
  if (error) throw new Error(`Advance failed: ${error.message}`);

  if (!updated) {
    // Stale expectation or a concurrent advance won the race — no-op, report the
    // authoritative current index so the caller reconciles.
    return { status: "noop", index: game.current_index };
  }

  // Promote any mid-game spectators to full players now that a fresh question is
  // starting — they "play from the next question" (U5 mid-game join rule) and
  // become eligible for the leaderboard.
  await supabase
    .from("players")
    .update({ is_spectator: false })
    .eq("game_id", game.id)
    .eq("is_spectator", true);

  const timerMs = ANSWER_TIMER_MS[game.answer_mode];

  // Client-safe question shape — answer keys stay server-side (KTD4).
  const { data: question } = await supabase
    .from("questions")
    .select("index, prompt, mode, options, voided")
    .eq("game_id", game.id)
    .eq("index", next)
    .maybeSingle();

  await broadcastToRoom(code, ROOM_EVENTS.question, {
    index: next,
    revealAt,
    timerMs,
    question: question ?? null,
  });

  return { status: "advanced", index: next, revealAt, timerMs };
}
