import "server-only";
// Server-side Realtime Broadcast emitter (KTD2, KTD8). Vercel functions are
// stateless and short-lived, so instead of holding a socket we POST to the
// Supabase Realtime broadcast REST endpoint. Broadcast is a best-effort delta
// layer over the Postgres source of truth — a dropped emit self-heals when the
// client next calls hydrate_game_state (KTD8) — so a failed send is logged, not
// thrown: it must never fail the authoritative DB write that preceded it.

import { roomChannel, type RoomEvent } from "./events";

export interface BroadcastConfig {
  url?: string;
  serviceKey?: string;
  fetchImpl?: typeof fetch;
}

export async function broadcastToRoom(
  code: string,
  event: RoomEvent,
  payload: Record<string, unknown>,
  config: BroadcastConfig = {},
): Promise<boolean> {
  const url = config.url ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = config.serviceKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const fetchImpl = config.fetchImpl ?? fetch;
  if (!url || !serviceKey) {
    console.warn(`[broadcast] skipped ${event} for ${code}: missing Supabase URL/service key`);
    return false;
  }

  try {
    const res = await fetchImpl(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        messages: [{ topic: roomChannel(code), event, payload }],
      }),
    });
    // Log a persistent failure so a rotated key / dead endpoint is diagnosable —
    // a single dropped delta still self-heals on the next hydrate (KTD8).
    if (!res.ok) console.warn(`[broadcast] ${event} for ${code} returned ${res.status}`);
    return res.ok;
  } catch (err) {
    // Delta lost; the next hydrate reconciles it (KTD8).
    console.warn(`[broadcast] ${event} for ${code} failed:`, err);
    return false;
  }
}
