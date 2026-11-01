-- Backward-compatible retention bookkeeping. Historical end/activity times are
-- unknown: start their retention clock at migration time rather than guessing.
alter table public.games
  add column if not exists last_activity_at timestamptz not null default now(),
  add column if not exists ended_at timestamptz;
update public.games set ended_at = now() where status = 'ended' and ended_at is null;

create or replace function public.track_game_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.last_activity_at := clock_timestamp();
  if new.status = 'ended' and (tg_op = 'INSERT' or old.status is distinct from 'ended') then
    new.ended_at := clock_timestamp();
  end if;
  return new;
end;
$$;
drop trigger if exists track_game_activity on public.games;
create trigger track_game_activity before insert or update on public.games
  for each row execute function public.track_game_activity();

-- Lobby activity includes joins, roster changes, suggestions and generation.
-- Updating the parent serializes these writes with cleanup's FOR UPDATE lock.
create or replace function public.touch_lobby_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op <> 'INSERT' then
    update public.games set last_activity_at = clock_timestamp()
      where id = old.game_id and status = 'lobby';
  end if;
  if tg_op <> 'DELETE' then
    update public.games set last_activity_at = clock_timestamp()
      where id = new.game_id and status = 'lobby';
  end if;
  return null;
end;
$$;
drop trigger if exists touch_lobby_activity on public.players;
create trigger touch_lobby_activity after insert or update or delete on public.players
  for each row execute function public.touch_lobby_activity();
drop trigger if exists touch_lobby_activity on public.category_suggestions;
create trigger touch_lobby_activity after insert or update or delete on public.category_suggestions
  for each row execute function public.touch_lobby_activity();
drop trigger if exists touch_lobby_activity on public.questions;
create trigger touch_lobby_activity after insert or update or delete on public.questions
  for each row execute function public.touch_lobby_activity();

create index if not exists games_cleanup_lobby_idx on public.games(last_activity_at, id) where status = 'lobby';
create index if not exists games_cleanup_ended_idx on public.games(ended_at, id) where status = 'ended';
create index if not exists rate_limit_hits_cleanup_idx on public.rate_limit_hits(hit_at, id);

create or replace function public.cleanup_stale_data(p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  -- Owner-adjustable policy; change through a reviewed follow-up migration.
  c_lobby_retention constant interval := interval '24 hours';
  c_ended_retention constant interval := interval '7 days';
  c_rate_retention constant interval := interval '24 hours';
  c_game_batch_size constant integer := 100;
  c_rate_batch_size constant integer := 1000;
  v_games uuid[];
  v_hits bigint[];
  v_counts jsonb;
begin
  if p_dry_run is null then raise exception 'p_dry_run must be true or false'; end if;
  select coalesce(array_agg(id), '{}'::uuid[]) into v_games from (
    select id from public.games
    where (status = 'lobby' and last_activity_at < now() - c_lobby_retention)
       or (status = 'ended' and ended_at < now() - c_ended_retention)
    order by coalesce(ended_at, last_activity_at), id
    limit c_game_batch_size for update skip locked
  ) candidates;
  select coalesce(array_agg(id), '{}'::bigint[]) into v_hits from (
    select id from public.rate_limit_hits where hit_at < now() - c_rate_retention
    order by hit_at, id limit c_rate_batch_size for update skip locked
  ) candidates;
  -- Every FK in 0001 and 0012 uses ON DELETE CASCADE (no other FKs in 0001–0016).
  -- Count children once, including either FK path for answers/challenges.
  select jsonb_build_object(
    'dry_run', p_dry_run,
    'games', cardinality(v_games),
    'lobbies', (select count(*) from public.games where id = any(v_games) and status = 'lobby'),
    'ended_games', (select count(*) from public.games where id = any(v_games) and status = 'ended'),
    'players', (select count(*) from public.players where game_id = any(v_games)),
    'questions', (select count(*) from public.questions where game_id = any(v_games)),
    'answers', (select count(*) from public.answers where question_id in (select id from public.questions where game_id = any(v_games)) or player_id in (select id from public.players where game_id = any(v_games))),
    'challenges', (select count(*) from public.challenges where question_id in (select id from public.questions where game_id = any(v_games)) or player_id in (select id from public.players where game_id = any(v_games))),
    'category_suggestions', (select count(*) from public.category_suggestions where game_id = any(v_games) or player_id in (select id from public.players where game_id = any(v_games))),
    'rate_limit_hits', cardinality(v_hits)
  ) into v_counts;
  if not p_dry_run then
    -- Recheck the status at the destructive boundary as defense in depth.
    delete from public.games where id = any(v_games) and status in ('lobby', 'ended');
    delete from public.rate_limit_hits where id = any(v_hits);
  end if;
  return v_counts;
end;
$$;
revoke execute on function public.track_game_activity() from public, anon, authenticated;
revoke execute on function public.touch_lobby_activity() from public, anon, authenticated;
revoke execute on function public.cleanup_stale_data(boolean) from public, anon, authenticated;
grant execute on function public.cleanup_stale_data(boolean) to service_role;

create extension if not exists pg_cron;
-- Unschedule only an existing matching job: unschedule(name) errors if absent.
-- Scope to the owner: named jobs are unique per scheduling user.
do $$
begin
  perform cron.unschedule(jobid) from cron.job
    where jobname = 'buzzr-stale-data-cleanup' and username = current_user;
  perform cron.schedule('buzzr-stale-data-cleanup', '*/15 * * * *',
    'select public.cleanup_stale_data(false);');
end;
$$;
