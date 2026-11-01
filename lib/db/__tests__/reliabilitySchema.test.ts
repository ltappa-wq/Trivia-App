import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const sql = readFileSync(new URL("../../../supabase/migrations/0015_room_reliability.sql", import.meta.url), "utf8");
const close = sql.slice(sql.indexOf("create or replace function public.close_question"), sql.indexOf("create or replace function public.answer_progress"));
const progress = sql.slice(sql.indexOf("create or replace function public.answer_progress"), sql.indexOf("create or replace function public.end_game"));
const end = sql.slice(sql.indexOf("create or replace function public.end_game"));
describe("0015 reliability contract", () => {
  it("does not replace hydration or alter earlier migrations", () => {
    expect(sql).not.toMatch(/create or replace function public\.hydrate_game_state/);
  });
  it("keeps privileged writes service-role-only and pins search paths", () => {
    for (const [name, signature] of [["close_question", "text, text, integer, boolean"], ["end_game", "uuid"]]) {
      expect(sql).toContain(`revoke execute on function public.${name}(${signature}) from public, anon, authenticated`);
      expect(sql).toContain(`grant execute on function public.${name}(${signature}) to service_role`);
    }
    for (const fn of [close, progress, end]) {
      expect(fn).toContain("security definer");
      expect(fn).toContain("set search_path = public");
    }
  });
  it("authorizes close by token and room, gates early close to hosts, bounds player calls", () => {
    expect(close).toContain("from public.resolve_token(p_token)");
    expect(close).toContain("if v_game_id is null then raise exception 'Not authorized'");
    expect(close).toContain("p_force is true and v_role is distinct from 'host'");
    expect(close).toContain("code = upper(btrim(p_code)) for update");
    expect(close).toMatch(/check_rate_limit\([^;]*6, 10000\)/);
  });
  it("checks DB time after locking and retains phase + expected-index CAS", () => {
    expect(close.indexOf("for update")).toBeLessThan(close.indexOf("clock_timestamp()"));
    expect(close).toContain("when 'multiple_choice' then 20000 else 35000 end");
    expect(close).toContain("p_force is not true and clock_timestamp() < v_game.reveal_at + (v_timer + 750) * interval '1 millisecond'");
    expect(close).toMatch(/if p_force is not true[\s\S]*?return false;/);
    expect(close).toContain("v_game.current_index < 0");
    expect(close).toContain("v_game.reveal_at is null");
    expect(close).toMatch(/where id = v_game_id and status = 'active' and current_index = p_expected_index\s+and reviewing = false and paused = false/);
  });
  it("progress is token-scoped, counts only active players, and hides IDs from players", () => {
    expect(progress).toContain("from public.resolve_token(p_token)");
    expect(progress).toContain("where g.id = v_game_id");
    expect(progress).toContain("p.is_spectator = false");
    expect(progress).toContain("q.index = g.current_index");
    expect(progress).toContain("case when v_role = 'host'");
    expect(progress).toContain("else '[]'::jsonb end");
    expect(progress).toContain("'answered_count', count(a.player_id)");
    expect(progress).not.toMatch(/raw_answer|is_correct|correct_option|accepted_variants|awarded_points/);
    expect(sql).toContain("revoke execute on function public.answer_progress(text) from public");
    expect(sql).toContain("grant execute on function public.answer_progress(text) to anon, authenticated");
  });
  it("ends atomically under the game lock and returns safely for an ended game", () => {
    expect(end.indexOf("for update")).toBeLessThan(end.indexOf("update public.challenges"));
    expect(end).toContain("if v_status = 'ended' then return false");
    expect(end).toMatch(/update public.challenges[\s\S]*q.game_id = p_game_id and c.status = 'open'/);
    expect(end).toContain("set status = 'ended', paused = false, reviewing = false");
  });
});
