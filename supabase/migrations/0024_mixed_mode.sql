-- R30: apply before deploying. Additive mode values; no existing signature changes.
-- Constraint names verified against a fresh replay (see supabase/tests/0024_mixed_mode.sql).
alter table public.games drop constraint games_answer_mode_check;
alter table public.games add constraint games_answer_mode_check
  check (answer_mode in ('multiple_choice', 'type_answer', 'mixed', 'true_false'));
alter table public.questions drop constraint questions_mode_check;
alter table public.questions add constraint questions_mode_check
  check (mode in ('multiple_choice', 'type_answer', 'true_false'));
alter table public.question_bank drop constraint question_bank_mode_check;
alter table public.question_bank add constraint question_bank_mode_check
  check (mode in ('multiple_choice', 'type_answer', 'true_false'));

-- TF uses canonical ['True','False'] options, index 0/1, with its own mode.
-- NULL timers follow the actual question: MC 20s, typed 35s, binary 15s.
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
  v_timer := coalesce(v_game.answer_timer_ms, (select case q.mode when 'multiple_choice' then 20000 when 'true_false' then 15000 else 35000 end from public.questions q where q.game_id = v_game_id and q.index = p_expected_index), case v_game.answer_mode when 'multiple_choice' then 20000 else 35000 end);
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

create or replace function public.resolve_challenge(
  p_game_id uuid,
  p_challenge_id uuid,
  p_uphold boolean,
  p_correction text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge public.challenges%rowtype;
  v_question public.questions%rowtype;
  v_game public.games%rowtype;
  v_answer public.answers%rowtype;
  v_new_points integer;
  v_elapsed numeric;
  v_timer integer;
  v_open_count integer;
  v_resumed boolean;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found or v_game.status = 'ended' then
    raise exception 'Game not found or ended';
  end if;
  select c.* into v_challenge from public.challenges c
   join public.questions q on q.id = c.question_id
   where c.id = p_challenge_id and q.game_id = p_game_id
   for update of c;
  if not found or v_challenge.status <> 'open' then
    raise exception 'Challenge already resolved or not found';
  end if;
  select * into v_question from public.questions where id = v_challenge.question_id for update;

  if p_uphold and v_challenge.type = 'answer' and v_question.voided then
    raise exception 'Cannot uphold an answer on a voided question';
  end if;

  if p_uphold and v_challenge.type = 'question' then
    update public.players p
       set score = greatest(0, p.score - scored.points)
      from (
        select player_id, sum(awarded_points)::integer as points
          from public.answers where question_id = v_question.id group by player_id
      ) scored
     where p.id = scored.player_id;
    update public.answers set awarded_points = 0, is_correct = false
     where question_id = v_question.id;
    update public.questions
       set voided = true, correction = coalesce(p_correction, 'Voided by host challenge')
     where id = v_question.id;
    update public.challenges
       set status = 'rejected', resolution = 'Question voided'
     where question_id = v_question.id and status = 'open' and id <> p_challenge_id;
    update public.challenges
       set status = 'upheld', resolution = 'Question voided' where id = p_challenge_id;
  elsif p_uphold then
    select * into v_answer from public.answers
     where question_id = v_question.id and player_id = v_challenge.player_id for update;
    if not found then raise exception 'Disputed answer no longer exists'; end if;
    if v_game.reveal_at is null then raise exception 'Question timing unavailable'; end if;
    v_timer := coalesce(v_game.answer_timer_ms, case v_question.mode when 'multiple_choice' then 20000 when 'true_false' then 15000 else 35000 end);
    v_elapsed := greatest(0, extract(epoch from (v_answer.submitted_at - v_game.reveal_at)) * 1000);
    if v_elapsed > v_timer then
      v_new_points := 0;
    elsif v_elapsed <= 1000 then
      v_new_points := 1000;
    else
      v_new_points := 1000 - round(500 * least(1, (v_elapsed - 1000) / (v_timer - 1000)))::integer;
    end if;
    if v_game.double_points_finale is true and v_question.index = v_game.question_count - 1 then
      v_new_points := v_new_points * 2;
    end if;
    update public.answers set is_correct = true, awarded_points = v_new_points where id = v_answer.id;
    update public.players set score = greatest(0, score + v_new_points - v_answer.awarded_points)
     where id = v_challenge.player_id;
    update public.challenges
       set status = 'upheld', resolution = 'Answer counted correct' where id = p_challenge_id;
  else
    update public.challenges
       set status = 'rejected', resolution = 'Rejected by host' where id = p_challenge_id;
  end if;

  select count(*) into v_open_count
    from public.challenges c join public.questions q on q.id = c.question_id
   where q.game_id = p_game_id and c.status = 'open';
  v_resumed := v_open_count = 0;
  if v_resumed then update public.games set paused = false,
    auto_advance_at = case when reviewing and auto_advance_at is not null then clock_timestamp() + auto_advance_ms * interval '1 millisecond' else null end
    where id = p_game_id; end if;
  return jsonb_build_object('resumed', v_resumed);
end;
$$;

create or replace function public.answer_distribution(p_token text)
returns jsonb
language plpgsql
security definer
-- `extensions` on the path so the nested resolve_token digest() resolves.
set search_path = public, extensions
as $$
declare
  v_game_id uuid;
begin
  select game_id into v_game_id
    from public.resolve_token(p_token);

  if v_game_id is null then
    return null;
  end if;

  return (
    select jsonb_build_object(
      'index', q.index,
      'mode', q.mode,
      'options', q.options,
      'correct_option', q.correct_option,
      'total', (select count(*) from public.answers a where a.question_id = q.id),
      -- Per-option counts only make sense for multiple choice; type-answer is free
      -- text, so counts is null there and the client renders nothing.
      'counts', case
        when q.mode in ('multiple_choice', 'true_false') then (
          select coalesce(jsonb_agg(per_option.cnt order by per_option.ord), '[]'::jsonb)
          from (
            select gs.ord,
                   (select count(*) from public.answers a
                     where a.question_id = q.id and a.raw_answer = gs.ord::text) as cnt
            from generate_series(0, coalesce(array_length(q.options, 1), 0) - 1) as gs(ord)
          ) per_option
        )
        else null
      end
    )
    from public.games g
    join public.questions q
      on q.game_id = g.id and q.index = g.current_index
    where g.id = v_game_id
      and g.current_index >= 0
      and (g.reviewing = true or g.status = 'ended')
  );
end;
$$;

create or replace function public.game_recap(p_token text)
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
        'answer', case when q.mode in ('multiple_choice', 'true_false') and a.raw_answer ~ '^[0-9]{1,3}$'
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

revoke execute on function public.close_question(text,text,integer,boolean) from public, anon, authenticated;
grant execute on function public.close_question(text,text,integer,boolean) to service_role;
revoke execute on function public.resolve_challenge(uuid,uuid,boolean,text) from public, anon, authenticated;
grant execute on function public.resolve_challenge(uuid,uuid,boolean,text) to service_role;
revoke execute on function public.answer_distribution(text) from public, anon, authenticated;
grant execute on function public.answer_distribution(text) to anon, authenticated;
revoke execute on function public.game_recap(text) from public, anon, authenticated;
grant execute on function public.game_recap(text) to anon, authenticated;
