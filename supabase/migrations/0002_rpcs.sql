-- U2. Token-validated read RPCs (KTD8).
-- Anonymous clients carry no Supabase Auth identity, so RLS cannot scope by
-- auth.jwt(). Instead these security-definer functions take a room-scoped token
-- as a parameter and validate it server-side. They are the only path by which a
-- client reads game state; the underlying tables stay default-deny (0001).
--
-- Answer keys (correct_option, accepted_variants) are never returned to clients
-- here — judging happens server-side in the service-role action (U7), so the
-- client never needs them and leaking them would let players self-grade.

-- Resolve a token to (game_id, role, player_id). Host tokens are matched by
-- hashing the presented token and comparing to games.host_token_hash.
create or replace function public.resolve_token(p_token text)
returns table (game_id uuid, role text, player_id uuid)
language sql
security definer
set search_path = public
as $$
  select p.game_id,
         case when p.is_spectator then 'spectator' else 'player' end as role,
         p.id as player_id
  from public.players p
  where p.token = p_token
  union all
  select g.id, 'host', null::uuid
  from public.games g
  where g.host_token_hash = encode(digest(p_token, 'sha256'), 'hex')
  limit 1;
$$;

-- Current authoritative state for the room the token belongs to. Clients call
-- this on subscribe and on reconnect, then treat Broadcast events as deltas on
-- top (KTD8) — so a dropped reveal/pause/resume/void self-heals on next hydrate.
create or replace function public.hydrate_game_state(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
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
    -- Unknown/foreign token: reveal nothing.
    return null;
  end if;

  select jsonb_build_object(
    'role', v_role,
    'game', (
      select jsonb_build_object(
        'id', g.id,
        'code', g.code,
        'status', g.status,
        'answer_mode', g.answer_mode,
        'difficulty', g.difficulty,
        'question_count', g.question_count,
        'current_index', g.current_index,
        'reveal_at', g.reveal_at,
        'paused', g.paused
      )
      from public.games g where g.id = v_game_id
    ),
    'player', (
      select jsonb_build_object('id', p.id, 'username', p.username, 'score', p.score)
      from public.players p where p.id = v_pid
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
      select jsonb_agg(row order by row->>'score' desc)
      from (
        select jsonb_build_object('username', p.username, 'score', p.score, 'id', p.id) as row
        from public.players p
        where p.game_id = v_game_id and p.is_spectator = false
        order by p.score desc, p.joined_at asc
      ) ranked
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- Anonymous clients may execute the RPCs but nothing else.
grant execute on function public.hydrate_game_state(text) to anon, authenticated;
revoke execute on function public.resolve_token(text) from anon, authenticated;
