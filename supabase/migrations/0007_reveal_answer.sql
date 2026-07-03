-- U6 / R5 / R1. Review-phase answer reveal.
-- During the answer window the grading columns (correct_option / accepted_variants)
-- are withheld from every client shape (KTD4) — hydrate_game_state never returns
-- them, and that invariant stays test-enforced. This RPC is the single sanctioned
-- exception: it returns the current question's answer key to any participant, but
-- ONLY once the room is reviewing or the game has ended (answering is locked), so
-- it can never help a player who could still submit. Mirrors the gated key
-- exposure of list_open_challenges (0003), but gated on phase rather than role.

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
      'correction', q.correction
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

grant execute on function public.reveal_answer(text) to anon, authenticated;
