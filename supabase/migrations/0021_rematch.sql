-- R26: additive rematch links; old deployed callers remain compatible.
alter table public.games add column rematch_game_id uuid references public.games(id) on delete set null;

-- Lock the ended source game to serialize double taps and host tabs. Tokens
-- are derived from the caller's secret and destination UUID, domain separated;
-- only hashes are persisted, and retries recover the same new credential.
create or replace function public.create_rematch(p_code text, p_token text, p_rate_key text)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  src public.games%rowtype;
  dst public.games%rowtype;
  new_id uuid;
  new_token text;
  candidate text;
  attempt integer;
begin
  select * into src from public.games
    where code = p_code and host_token_hash = encode(digest(p_token, 'sha256'), 'hex')
      and status = 'ended' for update;
  if not found then raise exception 'Host token required for ended game'; end if;
  if src.rematch_game_id is null then
    if not public.check_rate_limit(p_rate_key, 5, 60000) then
      raise exception 'Too many games created — please wait a moment.';
    end if;
    new_id := gen_random_uuid();
    new_token := encode(digest('rematch-host:' || p_token || ':' || new_id::text, 'sha256'), 'hex');
    for attempt in 1..20 loop
      candidate := lpad(floor(random() * 100000)::integer::text, 5, '0');
      if candidate = src.code then continue; end if;
      begin
        insert into public.games(id, code, host_token_hash, categories, question_count,
          answer_mode, difficulty, answer_timer_ms, auto_advance_ms, double_points_finale)
        values (new_id, candidate, encode(digest(new_token, 'sha256'), 'hex'), src.categories,
          src.question_count, src.answer_mode, src.difficulty, src.answer_timer_ms,
          src.auto_advance_ms, src.double_points_finale) returning * into dst;
        exit;
      exception when unique_violation then null;
      end;
    end loop;
    if dst.id is null then raise exception 'Could not allocate room code'; end if;
    update public.games set rematch_game_id = dst.id where id = src.id;
  else
    select * into dst from public.games where id = src.rematch_game_id;
    new_token := encode(digest('rematch-host:' || p_token || ':' || dst.id::text, 'sha256'), 'hex');
  end if;
  return jsonb_build_object('gameId', dst.id, 'code', dst.code, 'hostToken', new_token);
end;
$$;

create or replace function public.join_rematch(p_code text, p_token text)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  src public.games%rowtype;
  dst public.games%rowtype;
  old_player public.players%rowtype;
  seated public.players%rowtype;
  new_token text;
  chosen text;
  suffix text;
  attempt integer := 1;
begin
  select g.* into src from public.games g join public.players p on p.game_id = g.id
    where g.code = p_code and g.status = 'ended'
      and p.token_hash = encode(digest(p_token, 'sha256'), 'hex');
  if not found or src.rematch_game_id is null then raise exception 'No authorized rematch'; end if;
  select * into old_player from public.players
    where game_id = src.id and token_hash = encode(digest(p_token, 'sha256'), 'hex');
  -- Serialize transfers and normal start/advance operations on the new game.
  select * into dst from public.games where id = src.rematch_game_id for update;
  if not found then raise exception 'Rematch unavailable'; end if;
  new_token := encode(digest('rematch-player:' || p_token || ':' || dst.id::text, 'sha256'), 'hex');
  select * into seated from public.players
    where game_id = dst.id and token_hash = encode(digest(new_token, 'sha256'), 'hex');
  if not found then
    if dst.status = 'ended' then raise exception 'Rematch has ended'; end if;
    chosen := old_player.username;
    loop
      begin
        insert into public.players(game_id, username, token_hash, is_spectator)
          values (dst.id, chosen, encode(digest(new_token, 'sha256'), 'hex'), dst.status <> 'lobby')
          returning * into seated;
        exit;
      exception when unique_violation then
        attempt := attempt + 1;
        suffix := ' (' || attempt::text || ')';
        chosen := left(old_player.username, 20 - length(suffix)) || suffix;
      end;
    end loop;
  end if;
  return jsonb_build_object('playerId', seated.id, 'token', new_token,
    'username', seated.username, 'code', dst.code, 'isSpectator', seated.is_spectator);
end;
$$;
revoke execute on function public.create_rematch(text,text,text) from public, anon, authenticated;
revoke execute on function public.join_rematch(text,text) from public, anon, authenticated;
grant execute on function public.create_rematch(text,text,text) to service_role;
grant execute on function public.join_rematch(text,text) to service_role;

create or replace function public.hydrate_game_state(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_game_id uuid;
  v_role    text;
  v_pid     uuid;
  v_result  jsonb;
begin
  select game_id, role, player_id
    into v_game_id, v_role, v_pid
    from public.resolve_token(p_token);

  if v_game_id is null then
    return null;
  end if;

  select jsonb_build_object(
    'role', v_role,
    'game', (
      select jsonb_build_object(
        'id', g.id,
        'code', g.code,
        'rematch_code', (select code from public.games where id = g.rematch_game_id),
        'status', g.status,
        'answer_mode', g.answer_mode,
        'answer_timer_ms', g.answer_timer_ms,
        'auto_advance_ms', g.auto_advance_ms,
        'auto_advance_at', g.auto_advance_at,
        'double_points_finale', g.double_points_finale,
        'difficulty', g.difficulty,
        'question_count', g.question_count,
        'current_index', g.current_index,
        'reveal_at', g.reveal_at,
        'paused', g.paused,
        'reviewing', g.reviewing
      )
      from public.games g where g.id = v_game_id
    ),
    'player', (
      select jsonb_build_object('id', p.id, 'username', p.username, 'score', p.score)
      from public.players p where p.id = v_pid
    ),
    'my_answer', (
      select jsonb_build_object(
        'raw_answer', a.raw_answer,
        'is_correct', a.is_correct,
        'points', a.awarded_points,
        'streak', (
          select count(*) from public.answers history
          join public.questions hq on hq.id = history.question_id
          where history.player_id = v_pid and hq.game_id = v_game_id
            and hq.index <= g.current_index and history.is_correct
            and hq.index > coalesce((
              select max(wq.index) from public.answers wrong
              join public.questions wq on wq.id = wrong.question_id
              where wrong.player_id = v_pid and wq.game_id = v_game_id
                and wq.index <= g.current_index and not wrong.is_correct
            ), -1)
        )
      )
      from public.games g
      join public.questions q on q.game_id = g.id and q.index = g.current_index
      join public.answers a on a.question_id = q.id and a.player_id = v_pid
      where g.id = v_game_id and g.current_index >= 0
    ),
    'current_question', (
      -- Answer key columns are deliberately omitted.
      select jsonb_build_object(
        'index', q.index,
        'prompt', q.prompt,
        'mode', q.mode,
        'options', q.options,
        'voided', q.voided
      )
      from public.games g
      join public.questions q
        on q.game_id = g.id and q.index = g.current_index
      where g.id = v_game_id and g.current_index >= 0
    ),
    'leaderboard', coalesce((
      select jsonb_agg(row order by sort_score desc, sort_joined asc)
      from (
        select jsonb_build_object('username', p.username, 'score', p.score, 'id', p.id) as row,
               p.score as sort_score,
               p.joined_at as sort_joined
        from public.players p
        where p.game_id = v_game_id and p.is_spectator = false
      ) ranked
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;
revoke execute on function public.hydrate_game_state(text) from public;
grant execute on function public.hydrate_game_state(text) to anon, authenticated;
