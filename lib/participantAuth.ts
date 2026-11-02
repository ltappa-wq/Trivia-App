import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Defense in depth before service-role pacing RPCs; SQL rechecks atomically. */
export async function authorizePacingToken(supabase: SupabaseClient, token: string, hostOnly = false) {
  const { data, error } = await supabase.rpc("resolve_token", { p_token: token });
  const role = data?.[0]?.role;
  if (error || !(hostOnly ? role === "host" : ["host", "player", "spectator"].includes(role))) {
    throw new Error("Not authorized");
  }
}
