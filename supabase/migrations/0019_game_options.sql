-- R19/R31. Apply before deploying the app. NULL preserves legacy mode timers.
alter table public.games
  add column answer_timer_ms integer check (answer_timer_ms in (10000,20000,30000,40000,50000,60000)),
  add column auto_advance_ms integer check (auto_advance_ms in (5000,8000,10000,15000)),
  add column auto_advance_at timestamptz,
  add column double_points_finale boolean default false;

create or replace function public.commit_answer(
  p_game_id uuid,
  p_question_id uuid,
  p_player_id uuid,
  p_expected_index integer,
  p_raw_answer text,
  p_is_correct boolean,
  p_points integer,
  p_submitted_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
  v_cap integer;
  v_active_count integer;
  v_answered_count integer;
  v_entered_review boolean := false;
begin

  -- Lock the game row so concurrent final submissions serialize before checking
  -- phase and determining whether all active players have answered.
  select * into v_game from public.games
   where id = p_game_id and status = 'active' and paused = false
     and reviewing = false and current_index = p_expected_index
   for update;
  if not found then
    raise exception 'Answering is locked';
  end if;

  v_cap := case when v_game.double_points_finale is true
    and p_expected_index = v_game.question_count - 1 then 2000 else 1000 end;
  if p_points is null or p_points < 0 or p_points > v_cap then
    raise exception 'Invalid awarded points';
  end if;

  if not exists (
    select 1 from public.questions
     where id = p_question_id and game_id = p_game_id
       and index = p_expected_index and voided = false
  ) then
    raise exception 'Question is no longer active';
  end if;
  if not exists (
    select 1 from public.players
     where id = p_player_id and game_id = p_game_id and is_spectator = false
  ) then
    raise exception 'Player is not eligible to answer';
  end if;

  insert into public.answers
    (question_id, player_id, raw_answer, is_correct, awarded_points, submitted_at)
  values
    (p_question_id, p_player_id, p_raw_answer, p_is_correct, p_points, p_submitted_at);

  if p_points > 0 then
    update public.players set score = score + p_points where id = p_player_id;
  end if;

  select count(*) into v_active_count
    from public.players where game_id = p_game_id and is_spectator = false;
  select count(*) into v_answered_count
    from public.answers where question_id = p_question_id;
  if v_active_count > 0 and v_answered_count >= v_active_count then
    update public.games set reviewing = true,
      auto_advance_at = case when auto_advance_ms is not null and current_index < question_count - 1 then clock_timestamp() + auto_advance_ms * interval '1 millisecond' else null end
     where id = p_game_id and current_index = p_expected_index
       and status = 'active' and paused = false and reviewing = false;
    v_entered_review := found;
  end if;
  return v_entered_review;
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
    v_timer := coalesce(v_game.answer_timer_ms, case v_game.answer_mode when 'multiple_choice' then 20000 else 35000 end);
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

-- Participant-assisted review advance. Only a due, unpaused review may move;
-- the row lock and expected index are shared with challenge creation and answers.
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
  if v_game_id is null then raise exception 'Not authorized'; end if;
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

-- Host may pause/cancel the schedule for this review only, or restart its full delay.
create or replace function public.set_review_auto_advance(
  p_token text, p_code text, p_expected_index integer, p_enabled boolean
)
returns boolean
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_game_id uuid;
  v_role text;
begin
  select game_id, role into v_game_id, v_role from public.resolve_token(p_token);
  if v_game_id is null or v_role is distinct from 'host' then raise exception 'Host token required'; end if;
  perform 1 from public.games where id = v_game_id and code = upper(btrim(p_code)) for update;
  if not found then raise exception 'Not authorized'; end if;
  update public.games set auto_advance_at = case when p_enabled then
    clock_timestamp() + auto_advance_ms * interval '1 millisecond' else null end
   where id = v_game_id and status = 'active' and reviewing and not paused
    and current_index = p_expected_index and current_index < question_count - 1
    and auto_advance_ms is not null;
  return found;
end;
$$;

-- Existing grants are preserved by CREATE OR REPLACE; restate them explicitly.
revoke execute on function public.close_question(text,text,integer,boolean) from public, anon, authenticated;
revoke execute on function public.commit_answer(uuid,uuid,uuid,integer,text,boolean,integer,timestamptz) from public, anon, authenticated;
revoke execute on function public.resolve_challenge(uuid,uuid,boolean,text) from public, anon, authenticated;
grant execute on function public.close_question(text,text,integer,boolean) to service_role;
grant execute on function public.commit_answer(uuid,uuid,uuid,integer,text,boolean,integer,timestamptz) to service_role;
grant execute on function public.resolve_challenge(uuid,uuid,boolean,text) to service_role;
grant execute on function public.hydrate_game_state(text) to anon, authenticated;
revoke execute on function public.auto_advance_question(text,text,integer) from public, anon, authenticated;
revoke execute on function public.set_review_auto_advance(text,text,integer,boolean) from public, anon, authenticated;
grant execute on function public.auto_advance_question(text,text,integer) to service_role;
grant execute on function public.set_review_auto_advance(text,text,integer,boolean) to service_role;
