-- R21. Read-only presenter credential. Additive and safe before app deployment.
alter table public.games add column if not exists display_token_hash text;
create unique index if not exists games_display_token_hash_idx
  on public.games (display_token_hash) where display_token_hash is not null;

create or replace function public.resolve_token(p_token text)
returns table (game_id uuid, role text, player_id uuid)
language sql
security definer
set search_path = public, extensions
as $$
  select p.game_id,
         case when p.is_spectator then 'spectator' else 'player' end as role,
         p.id as player_id
  from public.players p
  where p.token_hash = encode(digest(p_token, 'sha256'), 'hex')
  union all
  select g.id, 'host', null::uuid
  from public.games g
  where g.host_token_hash = encode(digest(p_token, 'sha256'), 'hex')
  union all
  select g.id, 'display', null::uuid
  from public.games g
  where g.display_token_hash = encode(digest(p_token, 'sha256'), 'hex')
  limit 1;
$$;
revoke execute on function public.resolve_token(text) from public, anon, authenticated;
grant execute on function public.resolve_token(text) to service_role;

-- Explicit participant allowlists: new read-only and future roles cannot pace.
create or replace function public.close_question(
  p_token text, p_code text, p_expected_index integer, p_force boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_game_id uuid;
  v_role text;
  v_game public.games%rowtype;
  v_timer integer;
begin
  select game_id, role into v_game_id, v_role from public.resolve_token(p_token);
  if v_game_id is null or v_role is null or v_role not in ('host', 'player', 'spectator') then
    raise exception 'Not authorized';
  end if;
  if p_force is true and v_role is distinct from 'host' then
    raise exception 'Host token required';
  end if;
  if v_role <> 'host' then
    if not public.check_rate_limit('close:' || encode(digest(p_token, 'sha256'), 'hex'), 6, 10000) then
      return false;
    end if;
  end if;

  select * into v_game from public.games
   where id = v_game_id and code = upper(btrim(p_code)) for update;
  if not found then raise exception 'Not authorized'; end if;
  if v_game.status <> 'active' or v_game.current_index < 0
     or v_game.current_index <> p_expected_index or v_game.reviewing
     or v_game.paused or v_game.reveal_at is null then return false; end if;
  -- Keep in sync with ANSWER_TIMER_MS and AUTO_CLOSE_GRACE_MS.
  v_timer := coalesce(v_game.answer_timer_ms, case v_game.answer_mode when 'multiple_choice' then 20000 else 35000 end);
  if clock_timestamp() < v_game.reveal_at then return false; end if;
  if p_force is not true and clock_timestamp() < v_game.reveal_at + (v_timer + 750) * interval '1 millisecond' then
    return false;
  end if;
  update public.games set reviewing = true,
    auto_advance_at = case when auto_advance_ms is not null and current_index < question_count - 1 then clock_timestamp() + auto_advance_ms * interval '1 millisecond' else null end
   where id = v_game_id and status = 'active' and current_index = p_expected_index
     and reviewing = false and paused = false;
  return found;
end;
$$;
revoke execute on function public.close_question(text,text,integer,boolean) from public, anon, authenticated;
grant execute on function public.close_question(text,text,integer,boolean) to service_role;

create or replace function public.auto_advance_question(
  p_token text, p_code text, p_expected_index integer
)
returns boolean
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_game_id uuid;
  v_role text;
  v_game public.games%rowtype;
begin
  select game_id, role into v_game_id, v_role from public.resolve_token(p_token);
  if v_game_id is null or v_role is null or v_role not in ('host', 'player', 'spectator') then
    raise exception 'Not authorized';
  end if;
  if v_role <> 'host' and not public.check_rate_limit(
    'advance:' || encode(digest(p_token, 'sha256'), 'hex'), 6, 10000
  ) then return false; end if;
  select * into v_game from public.games
   where id = v_game_id and code = upper(btrim(p_code)) for update;
  if not found then raise exception 'Not authorized'; end if;
  if v_game.status <> 'active' or not v_game.reviewing or v_game.paused
    or v_game.current_index <> p_expected_index or p_expected_index < 0
    or v_game.current_index >= v_game.question_count - 1
    or v_game.auto_advance_ms is null or v_game.auto_advance_at is null
    or clock_timestamp() < v_game.auto_advance_at then return false; end if;
  if exists (select 1 from public.challenges c join public.questions q on q.id = c.question_id
    where q.game_id = v_game_id and c.status = 'open') then return false; end if;
  if not exists (select 1 from public.questions where game_id = v_game_id and index = p_expected_index + 1)
    then return false; end if;
  update public.games set current_index = p_expected_index + 1,
    reveal_at = clock_timestamp() + interval '3 seconds', reviewing = false,
    auto_advance_at = null
   where id = v_game_id and current_index = p_expected_index and reviewing and not paused and status = 'active';
  if not found then return false; end if;
  update public.players set is_spectator = false where game_id = v_game_id and is_spectator;
  return true;
end;
$$;
revoke execute on function public.auto_advance_question(text,text,integer) from public, anon, authenticated;
grant execute on function public.auto_advance_question(text,text,integer) to service_role;

