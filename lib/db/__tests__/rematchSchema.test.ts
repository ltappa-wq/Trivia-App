import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const sql = readFileSync(new URL("../../../supabase/migrations/0021_rematch.sql", import.meta.url), "utf8");
const old = readFileSync(new URL("../../../supabase/migrations/0019_game_options.sql", import.meta.url), "utf8");
const body = (s: string) => s.split("create or replace function public.hydrate_game_state(")[1].split("$$;")[0];
describe("rematch schema", () => {
  it("preserves the hydrate contract except the new code, with no credentials", () => {
    expect(body(sql).replace("        'rematch_code', (select code from public.games where id = g.rematch_game_id),\n", "")).toBe(body(old));
    expect(body(sql)).not.toContain("host_token");
  });
  it("makes mutations service-only with explicit token authorization and locks", () => {
    for (const signature of ["create_rematch(text,text,text)", "join_rematch(text,text)"]) {
      expect(sql).toContain(`revoke execute on function public.${signature} from public, anon, authenticated;`);
      expect(sql).toContain(`grant execute on function public.${signature} to service_role;`);
    }
    expect(sql).toContain("host_token_hash = encode(digest(p_token, 'sha256'), 'hex')");
    expect(sql).toContain("p.token_hash = encode(digest(p_token, 'sha256'), 'hex')");
    expect(sql).toContain("where id = src.rematch_game_id for update");
    expect(sql).toContain("public.check_rate_limit(p_rate_key, 5, 60000)");
  });
});
