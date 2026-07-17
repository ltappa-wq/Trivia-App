-- U6 / R5 / R1. Review-phase answer distribution.
-- Per-option answer counts for the current multiple-choice question, so the host
-- review screen can show how the room voted (which options drew players, with the
-- correct one highlighted). Like reveal_answer (0007), this is gated on PHASE, not
-- role: it returns data only once the room is reviewing or the game has ended, so
-- it can never leak the popular answer to someone who could still submit. It
-- exposes correct_option too, but reveal_answer already does that during review,
-- so this adds no new answer-key exposure. Counts come straight from the durable
-- answers table (KTD2); raw_answer for multiple choice is the option index string.

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
        when q.mode = 'multiple_choice' then (
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

grant execute on function public.answer_distribution(text) to anon, authenticated;
