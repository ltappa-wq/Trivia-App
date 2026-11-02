"use server";

import { getServiceClient } from "@/lib/supabase/server";
import { authorizeHostByCode } from "@/lib/serverAuth";

/** Count only; rejected content is never stored or returned. */
export async function getFamilySafetySummary(code: string, token: string) {
  const game = await authorizeHostByCode(getServiceClient(), code, token);
  return { enabled: game.family_friendly ?? false, replaced: game.family_replaced_count ?? 0 };
}
