import { test as base, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/** Cleanup is deliberately limited to an explicitly local database, even when
 * a developer has production credentials in their shell. No hosted targets. */
export function localDatabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) {
    throw new Error("E2E requires loopback Supabase URL and its local service-role key");
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const test = base.extend<{ trackGame: (gameId: string) => void }>({
  trackGame: async ({}, runFixture) => {
    const db = localDatabase();
    const gameIds = new Set<string>();
    try {
      await runFixture(gameId => { gameIds.add(gameId); });
    } finally {
      if (gameIds.size) {
        // All game-owned rows cascade; no other games are touched.
        const { error } = await db.from("games").delete().in("id", [...gameIds]);
        if (error) throw new Error(`E2E cleanup failed: ${error.message}`);
      }
    }
  },
});
export { expect };
