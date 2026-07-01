// U6. Client-side realtime: hydrate-then-delta (KTD8).
// A client hydrates authoritative state from Postgres through the token-validated
// security-definer RPC (never a direct table read — anon is default-deny, U2),
// then subscribes to the per-room Broadcast channel and treats each event as a
// signal to reconcile. Because Broadcast is best-effort, a dropped event simply
// means the next hydrate corrects it.

import { getBrowserClient } from "@/lib/supabase/browser";
import { roomChannel, type RoomEvent } from "./events";
import type { HydratedState } from "@/lib/db/types";

export async function hydrate(token: string): Promise<HydratedState | null> {
  const { data, error } = await getBrowserClient().rpc("hydrate_game_state", {
    p_token: token,
  });
  if (error) throw new Error(error.message);
  return (data as HydratedState | null) ?? null;
}

export type RoomHandlers = Partial<
  Record<RoomEvent, (payload: Record<string, unknown>) => void>
>;

/** Subscribe to a room's Broadcast channel. Returns an unsubscribe function. */
export function subscribeToRoom(code: string, handlers: RoomHandlers): () => void {
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
  channel.subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
