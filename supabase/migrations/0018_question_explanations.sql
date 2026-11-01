-- R23. Additive, nullable enrichment; safe before deploying the new app.
alter table public.questions add column if not exists explanation text;
alter table public.question_bank add column if not exists explanation text;

-- Keep the existing signature, token authorization and phase gate unchanged.
create or replace function public.reveal_answer(p_token text)
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

  -- Answer key is exposed only when the current question is no longer answerable:
  -- the room is in review, or the game has ended. Otherwise return null.
  return (
    select jsonb_build_object(
      'index', q.index,
      'mode', q.mode,
      'options', q.options,
      'correct_option', q.correct_option,
      'accepted_variants', q.accepted_variants,
      'correction', q.correction,
      'explanation', q.explanation
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

revoke execute on function public.reveal_answer(text) from public, anon, authenticated;
grant execute on function public.reveal_answer(text) to anon, authenticated;
