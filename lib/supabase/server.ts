import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Privileged server Supabase client (service-role key). Server-only — the
 * `server-only` import makes a client-bundle import a build error. All
 * privileged writes (createGame, advance, submitAnswer, challenge, adjudicate)
 * use this client; service-role bypasses RLS, so each server action authorizes
 * its own caller (KTD7).
 */
let client: SupabaseClient | undefined;

export function getServiceClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
