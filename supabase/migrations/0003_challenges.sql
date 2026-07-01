-- U8. Host adjudication read path (KTD7, KTD8).
-- The pause Broadcast is best-effort, so the host reads the authoritative open
-- challenges from Postgres. Security-definer + host-role check: only the game's
-- host token yields the challenge detail — and, because the host is the
-- adjudicator, this is the one client-facing read allowed to return answer keys
-- (correct_option / accepted_variants) so the host can rule.

create or replace function public.list_open_challenges(p_token text)
returns jsonb
language plpgsql
security definer
-- `extensions` on the path so the nested resolve_token digest() resolves.
set search_path = public, extensions
as $$
declare
  v_game_id uuid;
  v_role    text;
begin
  select game_id, role into v_game_id, v_role
    from public.resolve_token(p_token);

  -- Only the host of the room may see challenge detail with answer keys.
  if v_game_id is null or v_role is distinct from 'host' then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'type', c.type,
        'submitted_text', c.submitted_text,
        'challenger', p.username,
        'question', jsonb_build_object(
          'index', q.index,
          'prompt', q.prompt,
          'mode', q.mode,
          'options', q.options,
          'correct_option', q.correct_option,
          'accepted_variants', q.accepted_variants
        )
      ) order by c.created_at asc
    )
    from public.challenges c
    join public.players p on p.id = c.player_id
    join public.questions q on q.id = c.question_id
    where q.game_id = v_game_id and c.status = 'open'
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.list_open_challenges(text) to anon, authenticated;
