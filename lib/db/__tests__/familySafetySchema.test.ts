import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const sql = readFileSync(new URL("../../../supabase/migrations/0025_family_friendly.sql", import.meta.url), "utf8");
const old = readFileSync(new URL("../../../supabase/migrations/0021_rematch.sql", import.meta.url), "utf8");
it("adds defaulted fields and preserves the rematch function except the copied flag", () => {
  expect(sql).toContain("family_friendly boolean not null default false");
  expect(sql).toContain("family_replaced_count integer not null default 0");
  const body = (s: string) => s.split("create or replace function public.create_rematch")[1].split("$$;")[0];
  expect(body(sql).replace(", family_friendly)", ")").replace(", src.family_friendly)", ")")).toBe(body(old));
  expect(sql).toContain("revoke execute on function public.create_rematch(text,text,text) from public, anon, authenticated;");
  expect(sql).toContain("grant execute on function public.create_rematch(text,text,text) to service_role;");
  expect(sql).not.toContain("hydrate_game_state");
});
