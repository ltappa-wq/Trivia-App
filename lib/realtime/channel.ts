// U6. Client-side realtime: hydrate-then-delta (KTD8).
// A client hydrates authoritative state from Postgres through the token-validated
// security-definer RPC (never a direct table read — anon is default-deny, U2),
// then subscribes to the per-room Broadcast channel and treats each event as a
// signal to reconcile. Because Broadcast is best-effort, a dropped event simply
// means the next hydrate corrects it.

import { getBrowserClient } from "@/lib/supabase/browser";
import { roomChannel, type RoomEvent } from "./events";
import type { HydratedState, OpenChallenge, RevealedAnswer } from "@/lib/db/types";

export async function hydrate(token: string): Promise<HydratedState | null> {
  const { data, error } = await getBrowserClient().rpc("hydrate_game_state", {
    p_token: token,
  });
  if (error) throw new Error(error.message);
  return (data as HydratedState | null) ?? null;
}

/** Host-only: authoritative open challenges for the adjudication panel (U8). */
export async function listOpenChallenges(token: string): Promise<OpenChallenge[]> {
  const { data, error } = await getBrowserClient().rpc("list_open_challenges", {
    p_token: token,
  });
  if (error) throw new Error(error.message);
  return (data as OpenChallenge[] | null) ?? [];
}

/**
 * R1. Current question's answer key, returned only when the room is reviewing or
 * the game has ended (the RPC gates on phase). Null while a question is still
 * answerable, so this can never help a player who could still submit.
 */
export async function revealAnswer(token: string): Promise<RevealedAnswer | null> {
  const { data, error } = await getBrowserClient().rpc("reveal_answer", {
    p_token: token,
  });
  if (error) throw new Error(error.message);
  return (data as RevealedAnswer | null) ?? null;
}

export type RoomHandlers = Partial<
  Record<RoomEvent, (payload: Record<string, unknown>) => void>
>;

/**
 * Subscribe to a room's Broadcast channel. `onSubscribed` fires on every
 * SUBSCRIBED transition — including after a dropped connection reconnects — so
 * the caller re-hydrates authoritative state and recovers any deltas missed
 * while offline (KTD8; plan DoD: hydrate on subscribe/reconnect). Returns an
 * unsubscribe function.
 */
export function subscribeToRoom(
  code: string,
  handlers: RoomHandlers,
  onSubscribed?: () => void,
): () => void {
  const supabase = getBrowserClient();
  const channel = supabase.channel(roomChannel(code));
  for (const [event, handler] of Object.entries(handlers)) {
    if (!handler) continue;
    channel.on(
      "broadcast",
      { event },
      (message: { payload: Record<string, unknown> }) => handler(message.payload),
    );
  }
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") onSubscribed?.();
  });
  return () => {
    void supabase.removeChannel(channel);
  };
}
