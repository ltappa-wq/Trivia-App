import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
const directory = resolve("supabase/migrations");
const migrations = readdirSync(directory).filter(f => f.endsWith(".sql")).sort();
const definitions = new Map<string, string>();
for (const file of migrations) {
  const sql = readFileSync(resolve(directory, file), "utf8");
  for (const match of sql.matchAll(/create or replace function public\.(\w+)\([\s\S]*?\$\$;/gi)) definitions.set(match[1], match[0]);
}
const display = readFileSync(resolve(directory, "0023_tv_display.sql"), "utf8");
describe("R21 SQL role audit across every latest resolve_token caller", () => {
  it("stores only a nullable hash and resolves display without a player identity", () => {
    expect(display).toContain("add column if not exists display_token_hash text;");
    expect(definitions.get("resolve_token")).toContain("select g.id, 'display', null::uuid");
    expect(definitions.get("resolve_token")).toContain("g.display_token_hash = encode(digest(p_token, 'sha256'), 'hex')");
    expect(display).toContain("revoke execute on function public.resolve_token(text) from public, anon, authenticated");
  });
  it("has an explicit audit entry for every resolver consumer (new callers fail closed in this audit)", () => {
    expect([...definitions].filter(([, body]) => body.includes("public.resolve_token(p_token)")).map(([name]) => name).sort()).toEqual([
      "answer_distribution", "answer_progress", "auto_advance_question", "close_question", "hydrate_game_state",
      "list_category_suggestions", "list_open_challenges", "reveal_answer", "set_review_auto_advance",
    ]);
  });
  for (const name of ["close_question", "auto_advance_question"]) it(`${name} rejects display and unknown roles before any mutation`, () => {
    const body = definitions.get(name)!;
    const gate = "v_role is null or v_role not in ('host', 'player', 'spectator')";
    expect(body).toContain(gate);
    expect(body.indexOf(gate)).toBeLessThan(body.indexOf("update public.games"));
    const signature = name === "close_question" ? "text,text,integer,boolean" : "text,text,integer";
    expect(display).toContain(`revoke execute on function public.${name}(${signature}) from public, anon, authenticated;`);
    expect(display).toContain(`grant execute on function public.${name}(${signature}) to service_role;`);
    // Preserve every line of the previous behavior apart from the new role gate.
    const previous = readFileSync(resolve(directory, "0019_game_options.sql"), "utf8").match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`))![0];
    expect(body.replace("if v_game_id is null or v_role is null or v_role not in ('host', 'player', 'spectator') then\n    raise exception 'Not authorized';\n  end if;", "if v_game_id is null then raise exception 'Not authorized'; end if;")).toBe(previous);
  });
  it("keeps host-only reads and schedule mutation inaccessible to display", () => {
    for (const name of ["list_open_challenges", "list_category_suggestions", "set_review_auto_advance"])
      expect(definitions.get(name)).toContain("v_role is distinct from 'host'");
  });
  it("keeps every answer key phase-gated and progress identities host-only", () => {
    for (const name of ["reveal_answer", "answer_distribution"]) {
      expect(definitions.get(name)).toContain("g.reviewing = true or g.status = 'ended'");
      expect(definitions.get(name)).toContain("if v_game_id is null then");
    }
    expect(definitions.get("answer_progress")).toContain("case when v_role = 'host'");
    const hydrate = definitions.get("hydrate_game_state")!;
    expect(hydrate).not.toContain("correct_option");
    expect(hydrate).not.toContain("accepted_variants");
    expect(hydrate).not.toContain("display_token_hash");
    expect(hydrate).toContain("a.player_id = v_pid");
  });
  it("keeps UUID-based mutation RPCs service-only (no display caller can invoke them)", () => {
    const sql = migrations.map(f => readFileSync(resolve(directory, f), "utf8")).join("\n");
    for (const name of ["commit_answer", "create_challenge_and_pause", "resolve_challenge", "adjust_player_score", "end_game", "cleanup_stale_data"]) {
      for (const role of ["public", "anon", "authenticated"]) {
        expect(sql).toMatch(new RegExp(`revoke execute on function public\\.${name}\\([^;]*?from [^;]*?\\b${role}\\b`, "i"));
      }
    }
  });
});
