import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const directory = new URL('../../../supabase/migrations/', import.meta.url);
const sql = readFileSync(new URL('0017_stale_data_cleanup.sql', directory), 'utf8');
const body = sql.slice(sql.indexOf('create or replace function public.cleanup_stale_data'), sql.indexOf('revoke execute'));
describe('cleanup SQL contract', () => {
  it('only selects expired lobby or ended games and rechecks status before deleting', () => {
    expect(body).toContain("status = 'lobby' and last_activity_at < now() - c_lobby_retention");
    expect(body).toContain("status = 'ended' and ended_at < now() - c_ended_retention");
    expect(body).toContain("delete from public.games where id = any(v_games) and status in ('lobby', 'ended')");
    expect(body).not.toMatch(/status\s*(?:<>|!=)/);
  });
  it('never references durable dedup memory', () => expect(sql).not.toMatch(/question_bank/i));
  it('defaults to dry run and gates all deletion', () => {
    expect(body).toContain('p_dry_run boolean default true');
    expect(body).toContain("if p_dry_run is null then raise exception");
    expect(body.slice(0, body.indexOf('if not p_dry_run then'))).not.toMatch(/delete from/);
  });
  it('uses locked bounded batches with named policy constants', () => {
    expect(body).toContain("c_lobby_retention constant interval := interval '24 hours'");
    expect(body).toContain("c_ended_retention constant interval := interval '7 days'");
    expect(body).toContain("c_rate_retention constant interval := interval '24 hours'");
    expect(body).toContain('c_game_batch_size constant integer := 100');
    expect(body).toContain('c_rate_batch_size constant integer := 1000');
    expect(body).toContain('limit c_game_batch_size for update skip locked');
    expect(body).toContain('limit c_rate_batch_size for update skip locked');
  });
  it('is security definer with pinned search path and service-only execution', () => {
    expect(body).toContain('security definer set search_path = public');
    expect(sql).toContain('revoke execute on function public.cleanup_stale_data(boolean) from public, anon, authenticated');
    expect(sql).toContain('grant execute on function public.cleanup_stale_data(boolean) to service_role');
  });
  it('verifies every historical FK cascades, including both answer/challenge paths', () => {
    const history = readdirSync(directory).filter(f => /^00(?:0\d|1[0-6])_/.test(f)).map(f => readFileSync(new URL(f, directory), 'utf8')).join('\n');
    const references = [...history.matchAll(/references\s+public\.\w+\s*\(\w+\)([^,;\n]*)/gi)];
    expect(references).toHaveLength(8);
    for (const reference of references) expect(reference[1]).toContain('on delete cascade');
  });
  it('tracks lobby writes and end transitions without resetting historical clocks on rerun', () => {
    expect(sql).toContain("old.status is distinct from 'ended'");
    expect(sql).toContain("where status = 'ended' and ended_at is null");
    for (const table of ['players', 'questions', 'category_suggestions']) expect(sql).toContain(`after insert or update or delete on public.${table}`);
  });
  it('schedules a named job after conditionally unscheduling the same owner job', () => {
    expect(sql).toContain('create extension if not exists pg_cron');
    expect(sql).toContain('perform cron.unschedule(jobid) from cron.job');
    expect(sql).toContain("jobname = 'buzzr-stale-data-cleanup' and username = current_user");
    expect(sql).toContain("cron.schedule('buzzr-stale-data-cleanup', '*/15 * * * *'");
    expect(sql).toContain('select public.cleanup_stale_data(false);');
  });
});
