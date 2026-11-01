-- Participant-assisted timer close, private live progress, and atomic game end.
-- No hydration replacement: these RPCs are independent of hydrate_game_state.
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
  if v_game_id is null then raise exception 'Not authorized'; end if;
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
  v_timer := case v_game.answer_mode when 'multiple_choice' then 20000 else 35000 end;
  if clock_timestamp() < v_game.reveal_at then return false; end if;
  if p_force is not true and clock_timestamp() < v_game.reveal_at + (v_timer + 750) * interval '1 millisecond' then
    return false;
  end if;
  update public.games set reviewing = true
   where id = v_game_id and status = 'active' and current_index = p_expected_index
     and reviewing = false and paused = false;
  return found;
end;
$$;

create or replace function public.answer_progress(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_game_id uuid;
  v_role text;
begin
  select game_id, role into v_game_id, v_role from public.resolve_token(p_token);
  if v_game_id is null then return null; end if;
  return (
    select jsonb_build_object(
      'answered_count', count(a.player_id),
      'active_count', count(p.id),
      -- Only the host needs identities. Players receive counts alone.
      'answered_player_ids', case when v_role = 'host'
        then coalesce(jsonb_agg(p.id order by p.id) filter (where a.player_id is not null), '[]'::jsonb)
        else '[]'::jsonb end
    )
    from public.games g
    join public.questions q on q.game_id = g.id and q.index = g.current_index
    left join public.players p on p.game_id = g.id and p.is_spectator = false
    left join public.answers a on a.question_id = q.id and a.player_id = p.id
    where g.id = v_game_id and g.status = 'active' and g.reviewing = false
      and g.current_index >= 0
    group by g.id, q.id
  );
end;
$$;

create or replace function public.end_game(p_game_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  -- Same lock order as commit_answer/create_challenge_and_pause/resolve_challenge.
  select status into v_status from public.games where id = p_game_id for update;
  if not found then raise exception 'Game not found'; end if;
  if v_status = 'ended' then return false; end if;
  update public.challenges c set status = 'rejected', resolution = 'Game ended'
   from public.questions q
   where c.question_id = q.id and q.game_id = p_game_id and c.status = 'open';
  update public.games set status = 'ended', paused = false, reviewing = false
   where id = p_game_id;
  return true;
end;
$$;

revoke execute on function public.close_question(text, text, integer, boolean) from public, anon, authenticated;
grant execute on function public.close_question(text, text, integer, boolean) to service_role;
revoke execute on function public.end_game(uuid) from public, anon, authenticated;
grant execute on function public.end_game(uuid) to service_role;
revoke execute on function public.answer_progress(text) from public;
grant execute on function public.answer_progress(text) to anon, authenticated;
