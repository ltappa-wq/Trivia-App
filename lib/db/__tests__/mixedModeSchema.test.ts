import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const read = (file: string) => readFileSync(new URL(`../../../supabase/migrations/${file}`, import.meta.url), "utf8");
const sql = read("0024_mixed_mode.sql");
const body = (text: string, name: string) => text.match(new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\$\\$;`))![0].replace("create function", "create or replace function");
it("extends all three mode constraints without changing historical migrations", () => {
  for (const constraint of ["games_answer_mode_check", "questions_mode_check", "question_bank_mode_check"]) expect(sql).toContain(`drop constraint ${constraint}`);
  expect(sql).toContain("'mixed', 'true_false'");
});
it("preserves close behavior byte-for-byte apart from its timer expression, including role allowlist", () => {
  const before = body(read("0023_tv_display.sql"), "close_question");
  const after = body(sql, "close_question");
  expect(after.replace(/v_timer := .*?;/, before.match(/v_timer := .*?;/)![0])).toBe(before);
  expect(after).toContain("v_role not in ('host', 'player', 'spectator')");
});
it("preserves challenge behavior apart from the question-mode fallback", () => {
  const before = body(read("0019_game_options.sql"), "resolve_challenge");
  const after = body(sql, "resolve_challenge");
  expect(after.replace(/v_timer := .*?;/, before.match(/v_timer := .*?;/)![0])).toBe(before);
  expect(after).toContain("case v_question.mode when 'multiple_choice' then 20000 when 'true_false' then 15000 else 35000 end");
});
it.each([["answer_distribution", "0008_answer_distribution.sql"], ["game_recap", "0022_game_recap.sql"]])("preserves %s gating and shape apart from binary option handling", (name, file) => {
  expect(body(sql, name).replaceAll("q.mode in ('multiple_choice', 'true_false')", "q.mode = 'multiple_choice'")).toBe(body(read(file), name));
});
it("restates original mutation and client grants", () => {
  for (const signature of ["close_question(text,text,integer,boolean)", "resolve_challenge(uuid,uuid,boolean,text)"]) {
    expect(sql).toContain(`revoke execute on function public.${signature} from public, anon, authenticated;`);
    expect(sql).toContain(`grant execute on function public.${signature} to service_role;`);
  }
  for (const name of ["answer_distribution", "game_recap"]) expect(sql).toContain(`grant execute on function public.${name}(text) to anon, authenticated;`);
});
