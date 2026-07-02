"use server";
// U6 / R5.1. Host-driven timer-expiry close.
// When the answer window elapses without every player answering, the room still
// moves to the review phase (R5.1). There is no serverless background timer, so
// the host client — the pacing authority (KTD3) — fires this when its countdown
// hits zero. Host-token-gated and idempotent: a double-fire, or a race with the
// all-answered path in submitAnswer, is a safe no-op via the compare-and-set.

import { getServiceClient } from "@/lib/supabase/server";
import { authorizeHostByCode } from "@/lib/serverAuth";
import { broadcastToRoom } from "@/lib/realtime/broadcast";
import { ROOM_EVENTS } from "@/lib/realtime/events";

export type CloseQuestionResult =
  | { status: "reviewing"; index: number }
  | { status: "noop" };

/**
 * Enter the review phase for the question at `expectedIndex`. No-ops if the game
 * isn't active on that question, is paused (a challenge must be resolved first),
 * or is already reviewing.
 */
export async function closeQuestion(
  code: string,
  hostToken: string,
  expectedIndex: number,
): Promise<CloseQuestionResult> {
  const supabase = getServiceClient();
  const game = await authorizeHostByCode(supabase, code, hostToken);

  // Don't force review over an open challenge — the host adjudicates first, and
  // resume/advance drives the next transition (R5.3).
  if (game.paused) return { status: "noop" };

  const { data: flipped } = await supabase
    .from("games")
    .update({ reviewing: true })
    .eq("id", game.id)
    .eq("status", "active")
    .eq("current_index", expectedIndex)
    .eq("reviewing", false)
    .select("current_index")
    .maybeSingle();

  if (!flipped) return { status: "noop" };

  await broadcastToRoom(code, ROOM_EVENTS.review, { index: expectedIndex });
  return { status: "reviewing", index: expectedIndex };
}
