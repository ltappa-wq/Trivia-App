import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) {
  throw new Error("E2E preflight requires local Supabase credentials");
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { error: schemaError } = await db.from("games")
  .select("generation_progress,generation_started_at,generation_error").limit(0);
if (schemaError) throw new Error(`Local generation schema is unavailable: ${schemaError.code}: ${schemaError.message}`);
const startedAt = new Date().toISOString();
const staleBefore = new Date(Date.now() - 310_000).toISOString();
// No rows match: verify the real PostgREST lease-write contract without a game.
const { error } = await db.from("games")
  .update({ generation_started_at: startedAt, generation_progress: 0, generation_error: null })
  .eq("id", "00000000-0000-0000-0000-000000000000")
  .or(`generation_started_at.is.null,generation_started_at.lt.${staleBefore}`)
  .select("id");
if (error) throw new Error(`Local generation lease write failed: ${error.code}: ${error.message}`);
console.log("Local Supabase generation schema and lease-write contract are ready.");
