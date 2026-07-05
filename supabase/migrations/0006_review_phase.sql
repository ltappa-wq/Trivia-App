-- U5 / R5 / KTD3. Per-question review phase.
-- After all active players answer, or the host closes the question at timer-zero,
-- the room enters a "review" state: answering is locked and everyone looks at the
-- leaderboard until the host advances (R5). Because clients render off hydrated
-- state (hydrate-then-delta, KTD8), the flag lives on the game row and is surfaced
-- by hydrate_game_state so every view can react to it; the `review` broadcast just
-- triggers a re-hydrate. `advance` clears it when the next question is revealed.

alter table public.games
  add column if not exists reviewing boolean not null default false;

-- Re-declare hydrate_game_state to include `reviewing` in the client game object.
-- Body is identical to 0002_rpcs.sql except for the added field.
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
        'paused', g.paused,
        'reviewing', g.reviewing
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

grant execute on function public.hydrate_game_state(text) to anon, authenticated;
