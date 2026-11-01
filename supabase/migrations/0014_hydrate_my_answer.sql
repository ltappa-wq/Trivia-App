-- Restore only the token-resolved player's own current answer. No answer keys.
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

grant execute on function public.hydrate_game_state(text) to anon, authenticated;
