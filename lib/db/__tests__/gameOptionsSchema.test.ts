import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const sql = readFileSync(new URL("../../../supabase/migrations/0019_game_options.sql", import.meta.url), "utf8");
const oldHydrate = readFileSync(new URL("../../../supabase/migrations/0014_hydrate_my_answer.sql", import.meta.url), "utf8");
const body = (name: string) => sql.split(`create or replace function public.${name}(`)[1].split("$$;")[0];

describe("0019 game options contract", () => {
  it("adds nullable constrained settings with legacy defaults", () => {
    expect(sql).toContain("answer_timer_ms integer check (answer_timer_ms in (10000,20000,30000,40000,50000,60000))");
    expect(sql).toContain("auto_advance_ms integer check (auto_advance_ms in (5000,8000,10000,15000))");
    expect(sql).toContain("double_points_finale boolean default false");
    expect(sql.split("create or replace")[0]).not.toContain("not null");
  });
  it("preserves hydration exactly apart from additive settings", () => {
    let hydrate = body("hydrate_game_state");
    for (const field of ["answer_timer_ms", "auto_advance_ms", "auto_advance_at", "double_points_finale"]) {
      hydrate = hydrate.replace(`        '${field}', g.${field},\n`, "");
    }
    expect(hydrate).toBe(oldHydrate.split("create or replace function public.hydrate_game_state(")[1].split("$$;")[0]);
  });
  it("uses custom timers with legacy fallback for close and rescoring", () => {
    for (const name of ["close_question", "resolve_challenge"]) expect(body(name)).toContain("coalesce(v_game.answer_timer_ms, case v_game.answer_mode when 'multiple_choice' then 20000 else 35000 end)");
    expect(body("commit_answer")).toContain("p_expected_index = v_game.question_count - 1 then 2000 else 1000 end");
    expect(body("resolve_challenge")).toContain("v_question.index = v_game.question_count - 1");
    for (const name of ["commit_answer", "close_question"]) expect(body(name)).toContain("auto_advance_at = case when auto_advance_ms is not null");
  });
  it("locks token-resolved games and checks due deadline, open challenges, phase, and final index", () => {
    const advance = body("auto_advance_question");
    for (const guard of ["resolve_token(p_token)", "for update", "clock_timestamp() < v_game.auto_advance_at", "v_game.paused", "c.status = 'open'", "v_game.current_index >= v_game.question_count - 1", "current_index = p_expected_index and reviewing and not paused"]) expect(advance).toContain(guard);
    expect(body("set_review_auto_advance")).toContain("v_role is distinct from 'host'");
    expect(body("resolve_challenge")).toContain("when reviewing and auto_advance_at is not null then clock_timestamp()");
  });
  it("keeps mutations service-only and hydration client callable", () => {
    for (const name of ["commit_answer", "close_question", "resolve_challenge", "auto_advance_question", "set_review_auto_advance"]) {
      expect(body(name)).toContain("security definer");
      expect(sql).toMatch(new RegExp(`revoke execute on function public\\.${name}\\([^;]+from public, anon, authenticated;`));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^;]+to service_role;`));
    }
    expect(sql).toContain("grant execute on function public.hydrate_game_state(text) to anon, authenticated;");
  });
});
