-- R25: additive, compatible with the deployed answer writer. Historical timing
-- is unknown: do not infer it from speed scores or the last question's clock.
alter table public.answers add column elapsed_ms double precision check (elapsed_ms >= 0);

create function public.capture_answer_elapsed()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  select greatest(0, extract(epoch from (new.submitted_at - g.reveal_at)) * 1000)
    into new.elapsed_ms
    from public.questions q join public.games g on g.id = q.game_id
    where q.id = new.question_id and q.index = g.current_index and g.reveal_at is not null;
  return new;
end;
$$;
revoke execute on function public.capture_answer_elapsed() from public, anon, authenticated;
create trigger capture_answer_elapsed before insert on public.answers
for each row execute function public.capture_answer_elapsed();

create function public.game_recap(p_token text)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_game_id uuid;
  v_pid uuid;
  v_role text;
  v_result jsonb;
begin
  select t.game_id, t.player_id, t.role into v_game_id, v_pid, v_role
    from public.resolve_token(p_token) t;
  if v_game_id is null then return null; end if;
  if not exists (select 1 from public.games where id = v_game_id and status = 'ended') then
    return null;
  end if;
  -- Spectators and host-only callers receive aggregates, never personal rows.
  if v_role <> 'player' then v_pid := null; end if;
  with room_questions as (
    select q.* from public.questions q where q.game_id = v_game_id
  ), answer_counts as (
    select a.question_id, count(*) filter (where a.is_correct) as correct_count
    from public.answers a join room_questions q on q.id = a.question_id
    group by a.question_id
  ), challenge_counts as (
    select c.question_id, count(*) as challenges
    from public.challenges c join room_questions q on q.id = c.question_id
    group by c.question_id
  ), question_stats as (
    select q.id, q.index, q.prompt, q.voided,
      coalesce(a.correct_count, 0) as correct_count,
      coalesce(c.challenges, 0) as challenges
    from room_questions q
    left join answer_counts a on a.question_id = q.id
    left join challenge_counts c on c.question_id = q.id
  ), fastest as (
    select p.id, p.username, min(a.elapsed_ms) as elapsed_ms
    from public.answers a join room_questions q on q.id = a.question_id
    join public.players p on p.id = a.player_id
    where not q.voided and a.is_correct and a.elapsed_ms is not null and not p.is_spectator
    group by p.id, p.username
  )
  select jsonb_build_object(
    'personal', case when v_pid is null then null else jsonb_build_object(
      'total_points', (select score from public.players where id = v_pid),
      'questions', coalesce((select jsonb_agg(jsonb_build_object(
        'index', q.index, 'prompt', q.prompt, 'voided', q.voided,
        'correct_answer', coalesce(nullif(q.correction, ''), q.options[q.correct_option + 1], q.accepted_variants[1], 'Unavailable'),
        'answer', case when q.mode = 'multiple_choice' and a.raw_answer ~ '^[0-9]{1,3}$'
          then coalesce(q.options[a.raw_answer::integer + 1], a.raw_answer) else a.raw_answer end,
        'is_correct', coalesce(a.is_correct, false),
        'points', case when q.voided then 0 else coalesce(a.awarded_points, 0) end,
        'elapsed_ms', a.elapsed_ms,
        'finale', g.double_points_finale is true and q.index = g.question_count - 1
      ) order by q.index)
      from room_questions q join public.games g on g.id = q.game_id
      left join public.answers a on a.question_id = q.id and a.player_id = v_pid), '[]'::jsonb)
    ) end,
    'room', jsonb_build_object(
      'questions', coalesce((select jsonb_agg(jsonb_build_object(
        'index', s.index, 'prompt', s.prompt, 'voided', s.voided,
        'correct_count', s.correct_count, 'challenges', s.challenges
      ) order by s.index) from question_stats s), '[]'::jsonb),
      'player_count', (select count(*) from public.players where game_id = v_game_id and not is_spectator),
      'fastest', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'username', f.username, 'elapsed_ms', f.elapsed_ms) order by f.id)
        from fastest f where f.elapsed_ms = (select min(elapsed_ms) from fastest)), '[]'::jsonb)
    )
  ) into v_result;
  return v_result;
end;
$$;
revoke execute on function public.game_recap(text) from public, anon, authenticated;
grant execute on function public.game_recap(text) to anon, authenticated;
