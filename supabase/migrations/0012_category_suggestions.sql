-- U9 / U10 / R7 / R8 / KTD7. Player category suggestions.
--
-- Players pick categories on the join screen and they travel with the join, in
-- one round trip. That shape is deliberate: a pre-join lookup RPC (fetch a
-- room's catalog before joining) would be a new unauthenticated endpoint that
-- confirms whether a room code exists, which is exactly the enumeration surface
-- the join rate limit exists to close. The catalog is a client-side constant
-- (lib/gameConfig.ts), so the join form needs no server call to render.
--
-- These are advisory. Nothing here changes a game's categories — the host reads
-- them and decides (R8), and their decision travels to startGame.
--
-- Security posture matches 0001/0005: default-deny RLS with no permissive
-- policies. Writes come only from the service-role join action; reads come only
-- through the host-gated RPC below.

create table if not exists public.category_suggestions (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.games(id) on delete cascade,
  player_id  uuid not null references public.players(id) on delete cascade,
  category   text not null,
  created_at timestamptz not null default now(),
  -- One player suggesting the same category twice is the same suggestion, not
  -- two votes. Enforced here so a retried join can't inflate a category's count.
  unique (game_id, player_id, category)
);

create index if not exists idx_category_suggestions_game
  on public.category_suggestions (game_id);

alter table public.category_suggestions enable row level security;

-- U10. Host-gated read of this room's suggestions.
--
-- Follows list_open_challenges (migration 0003): security definer, executable by
-- anon, but rejects any token that is not this game's host. Suggestions name the
-- players who made them, so this is not public data — a player must not be able
-- to enumerate what everyone else asked for.
create or replace function public.list_category_suggestions(p_token text)
returns jsonb
language plpgsql
security definer
-- `extensions` on the path so the nested resolve_token digest() resolves.
set search_path = public, extensions
as $$
declare
  v_game_id uuid;
  v_role    text;
  v_result  jsonb;
begin
  select game_id, role into v_game_id, v_role
  from public.resolve_token(p_token);

  if v_game_id is null then
    return '[]'::jsonb;
  end if;
  -- Host-only: players and spectators get nothing, not an error, so this never
  -- becomes an oracle for whether a token is a host token.
  if v_role is distinct from 'host' then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('category', s.category, 'username', p.username)
      order by s.created_at
    ),
    '[]'::jsonb
  )
  into v_result
  from public.category_suggestions s
  join public.players p on p.id = s.player_id
  where s.game_id = v_game_id;

  return v_result;
end;
$$;

grant execute on function public.list_category_suggestions(text) to anon;
