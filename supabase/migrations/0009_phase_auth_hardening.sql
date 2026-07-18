-- Phase / auth hardening (review-phase submit lock companions, player token
-- hashing, shared rate limits, atomic score adjust).
-- Complements write-side guards in app/actions/* and lib/phaseGuards.ts.

-- ---------------------------------------------------------------------------
-- 1. Player credentials: store only SHA-256 hex (mirror host_token_hash).
--    Existing plaintext tokens are hashed in place; plaintext column dropped.
-- ---------------------------------------------------------------------------
alter table public.players
  add column if not exists token_hash text;

-- Hash any rows that still hold plaintext (pre-migration installs).
-- digest() lives in extensions on Supabase (same as resolve_token).
update public.players
set token_hash = encode(extensions.digest(token, 'sha256'), 'hex')
where token_hash is null
  and token is not null;

-- Fresh installs that already ran a later init path: if token still exists and
-- token_hash is filled, drop the plaintext column.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'players' and column_name = 'token'
  ) then
    -- Ensure every row has a hash before drop (empty table is fine).
    if exists (select 1 from public.players where token_hash is null) then
      raise exception 'players.token_hash backfill incomplete';
    end if;
    alter table public.players drop column token;
  end if;
end $$;

alter table public.players
  alter column token_hash set not null;

create unique index if not exists players_token_hash_key
  on public.players (token_hash);

-- resolve_token: match player by hash, same as host.
create or replace function public.resolve_token(p_token text)
returns table (game_id uuid, role text, player_id uuid)
language sql
security definer
set search_path = public, extensions
as $$
  select p.game_id,
         case when p.is_spectator then 'spectator' else 'player' end as role,
         p.id as player_id
  from public.players p
  where p.token_hash = encode(digest(p_token, 'sha256'), 'hex')
  union all
  select g.id, 'host', null::uuid
  from public.games g
  where g.host_token_hash = encode(digest(p_token, 'sha256'), 'hex')
  limit 1;
$$;

revoke execute on function public.resolve_token(text) from public;
revoke execute on function public.resolve_token(text) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Atomic score adjust (avoids read-modify-write races on leaderboard).
--    Service-role only — not granted to anon/authenticated.
-- ---------------------------------------------------------------------------
create or replace function public.adjust_player_score(p_player_id uuid, p_delta integer)
returns void
language sql
security definer
set search_path = public
as $$
  update public.players
  set score = greatest(0, score + p_delta)
  where id = p_player_id
    and p_delta is not null
    and p_delta <> 0;
$$;

revoke execute on function public.adjust_player_score(uuid, integer) from public;
revoke execute on function public.adjust_player_score(uuid, integer) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Shared sliding-window rate limit (createGame / joinGame across instances).
-- ---------------------------------------------------------------------------
create table if not exists public.rate_limit_hits (
  id     bigserial primary key,
  key    text not null,
  hit_at timestamptz not null default now()
);

create index if not exists idx_rate_limit_hits_key_at
  on public.rate_limit_hits (key, hit_at);

alter table public.rate_limit_hits enable row level security;

-- Insert-then-count: concurrent callers cannot all pass under the limit.
-- Returns true when the attempt is allowed.
create or replace function public.check_rate_limit(
  p_key text,
  p_limit integer,
  p_window_ms integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff timestamptz;
  v_count integer;
begin
  if p_key is null or length(p_key) = 0 then
    return false;
  end if;
  if p_limit is null or p_limit < 1 or p_window_ms is null or p_window_ms < 1 then
    return false;
  end if;

  v_cutoff := now() - (p_window_ms::text || ' milliseconds')::interval;

  -- Best-effort prune for this key so the table does not grow without bound.
  delete from public.rate_limit_hits
  where key = p_key and hit_at < v_cutoff;

  insert into public.rate_limit_hits (key) values (p_key);

  select count(*)::integer into v_count
  from public.rate_limit_hits
  where key = p_key and hit_at > v_cutoff;

  if v_count > p_limit then
    return false;
  end if;
  return true;
end;
$$;

-- Callable only via service role (server actions); revoke from clients.
revoke execute on function public.check_rate_limit(text, integer, integer) from public;
revoke execute on function public.check_rate_limit(text, integer, integer) from anon, authenticated;
