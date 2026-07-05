-- U3 / R6.2 / KTD2. Retire an ended game's join code and recycle the value.
-- The 5-digit numeric code space is small (100k), so codes must not be consumed
-- forever. Replacing the global unique constraint with a partial unique index
-- over live games only means:
--   * two live (lobby/active) games can never share a code, and
--   * once a game ends it drops out of the uniqueness set, so its 5-digit value
--     is free for a new game to reuse.
-- An ended game keeps its `code` value (its results UI still displays it) but is
-- no longer reachable by the join-by-code lookup (joinGame filters to live
-- status), so the code is effectively retired the moment the game ends (R6.2b).
-- R6.2a (only lobby/active are joinable) is already enforced by seatForStatus.

alter table public.games drop constraint if exists games_code_key;

create unique index if not exists games_code_live_unique
  on public.games (code)
  where status in ('lobby', 'active');

-- Dropping the unique constraint also dropped its implicit btree index on `code`.
-- authorizeHostByCode looks up by code with no status filter (it must match ended
-- rows to disambiguate a reused code by host-token hash) and runs on every host
-- action, so keep a plain index to avoid a growing sequential scan.
create index if not exists games_code_idx on public.games (code);
