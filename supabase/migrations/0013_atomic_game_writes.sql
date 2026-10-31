-- Atomic gameplay writes. These functions are only called by server actions
-- through the service-role client; anonymous clients cannot execute them.

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
  v_active_count integer;
  v_answered_count integer;
  v_entered_review boolean := false;
begin
  if p_points < 0 or p_points > 1000 then
    raise exception 'Invalid awarded points';
  end if;

  -- Lock the game row so concurrent final submissions serialize before checking
  -- phase and determining whether all active players have answered.
  perform 1 from public.games
   where id = p_game_id and status = 'active' and paused = false
     and reviewing = false and current_index = p_expected_index
   for update;
  if not found then
    raise exception 'Answering is locked';
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
    update public.games set reviewing = true
     where id = p_game_id and current_index = p_expected_index
       and status = 'active' and paused = false and reviewing = false;
    v_entered_review := found;
  end if;
  return v_entered_review;
end;
$$;

create or replace function public.create_challenge_and_pause(
  p_game_id uuid,
  p_question_id uuid,
  p_player_id uuid,
  p_type text,
  p_submitted_text text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge_id uuid;
begin
  -- Serialize challenge creation with advancement/end-game and other challenges.
  perform 1 from public.games g
   join public.questions q on q.game_id = g.id
   where g.id = p_game_id and q.id = p_question_id
     and q.index = g.current_index and g.status = 'active'
   for update of g;
  if not found then
    raise exception 'No active question to challenge';
  end if;
  if p_type not in ('question', 'answer') then
    raise exception 'Invalid challenge type';
  end if;
  if not exists (
    select 1 from public.players
     where id = p_player_id and game_id = p_game_id and is_spectator = false
  ) then
    raise exception 'Player is not eligible to challenge';
  end if;
  if p_type = 'answer' and not exists (
    select 1 from public.answers
     where question_id = p_question_id and player_id = p_player_id
  ) then
    raise exception 'No answer to dispute';
  end if;
  if (select count(*) from public.challenges where player_id = p_player_id) >= 3 then
    raise exception 'Challenge limit reached';
  end if;

  insert into public.challenges(question_id, player_id, type, submitted_text)
  values (p_question_id, p_player_id, p_type, p_submitted_text)
  returning id into v_challenge_id;
  update public.games set paused = true where id = p_game_id;
  return v_challenge_id;
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
    v_timer := case v_game.answer_mode when 'multiple_choice' then 20000 else 35000 end;
    v_elapsed := greatest(0, extract(epoch from (v_answer.submitted_at - v_game.reveal_at)) * 1000);
    if v_elapsed > v_timer then
      v_new_points := 0;
    elsif v_elapsed <= 1000 then
      v_new_points := 1000;
    else
      v_new_points := 1000 - round(500 * least(1, (v_elapsed - 1000) / (v_timer - 1000)))::integer;
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
  if v_resumed then update public.games set paused = false where id = p_game_id; end if;
  return jsonb_build_object('resumed', v_resumed);
end;
$$;

revoke execute on function public.commit_answer(uuid, uuid, uuid, integer, text, boolean, integer, timestamptz) from public, anon, authenticated;
revoke execute on function public.create_challenge_and_pause(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.resolve_challenge(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.commit_answer(uuid, uuid, uuid, integer, text, boolean, integer, timestamptz) to service_role;
grant execute on function public.create_challenge_and_pause(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.resolve_challenge(uuid, uuid, boolean, text) to service_role;
