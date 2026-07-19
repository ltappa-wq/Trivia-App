-- U2. Data model & migrations (KTD7, KTD8).
-- Durable source of truth for the live game. Broadcast is a delta layer over
-- these tables; scoring and recompute read from here (KTD2).
--
-- Security posture: every table is default-deny under RLS for the anon role.
-- Anonymous clients never read these tables directly — they read through the
-- security-definer RPCs in 0002_rpcs.sql, which validate a room-scoped token.
-- All writes go through service-role server actions (KTD6, KTD7), which bypass
-- RLS and authorize their own caller.

create extension if not exists "pgcrypto";

-- games ----------------------------------------------------------------------
create table if not exists public.games (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  -- Host credential is stored hashed; the plaintext is returned once to the
  -- host at creation and presented on every host-only action (KTD7).
  host_token_hash text not null,
  status          text not null default 'lobby'
                    check (status in ('lobby', 'active', 'ended')),
  categories      text[] not null,
  question_count  integer not null check (question_count between 1 and 50),
  answer_mode     text not null check (answer_mode in ('multiple_choice', 'type_answer')),
  difficulty      text not null check (difficulty in ('easy', 'medium', 'hard')),
  -- -1 means "not yet started"; 0-based index into questions once live.
  current_index   integer not null default -1,
  reveal_at       timestamptz,
  paused          boolean not null default false,
  created_at      timestamptz not null default now()
);

-- questions ------------------------------------------------------------------
create table if not exists public.questions (
  id                uuid primary key default gen_random_uuid(),
  game_id           uuid not null references public.games(id) on delete cascade,
  index             integer not null,
  prompt            text not null,
  mode              text not null check (mode in ('multiple_choice', 'type_answer')),
  -- multiple_choice: options is the ordered option list, correct_option its index.
  options           text[],
  correct_option    integer,
  -- type_answer: accepted answer variants for fuzzy judging (R4).
  accepted_variants text[],
  difficulty        text not null check (difficulty in ('easy', 'medium', 'hard')),
  voided            boolean not null default false,
  correction        text,
  unique (game_id, index)
);

-- players --------------------------------------------------------------------
create table if not exists public.players (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.games(id) on delete cascade,
  username     text not null,
  -- SHA-256 hash of the player's high-entropy server-issued token (KTD7). The
  -- plaintext is returned once to the client at join; only the hash is stored,
  -- so a DB read can't recover a credential that could impersonate the player.
  token_hash   text not null unique,
  score        integer not null default 0,
  -- Seated after the game started: plays from the next question, not scored
  -- retroactively (U5 mid-game join rule).
  is_spectator boolean not null default false,
  joined_at    timestamptz not null default now(),
  unique (game_id, username)
);

-- answers --------------------------------------------------------------------
create table if not exists public.answers (
  id             uuid primary key default gen_random_uuid(),
  question_id    uuid not null references public.questions(id) on delete cascade,
  player_id      uuid not null references public.players(id) on delete cascade,
  submitted_at   timestamptz not null default now(),
  raw_answer     text not null,
  is_correct     boolean not null default false,
  awarded_points integer not null default 0,
  -- One answer per player per question; the dup-submit guard relies on this (U7).
  unique (question_id, player_id)
);

-- challenges -----------------------------------------------------------------
create table if not exists public.challenges (
  id             uuid primary key default gen_random_uuid(),
  question_id    uuid not null references public.questions(id) on delete cascade,
  player_id      uuid not null references public.players(id) on delete cascade,
  type           text not null check (type in ('question', 'answer')),
  status         text not null default 'open'
                    check (status in ('open', 'upheld', 'rejected')),
  -- For a disputed-answer challenge, the player's submitted text the host reviews.
  submitted_text text,
  resolution     text,
  created_at     timestamptz not null default now()
);

-- FK-lookup index. The composite unique constraints already cover the
-- (game_id,index), (game_id,username), and (question_id,player_id) prefixes, so
-- only challenges needs a dedicated index here.
create index if not exists idx_challenges_question on public.challenges(question_id);

-- At most one OPEN challenge per player per question: closes the rapid-fire
-- duplicate-open race and complements the per-player challenge cap (R13, KTD7).
create unique index if not exists uniq_open_challenge_per_player_question
  on public.challenges(question_id, player_id)
  where status = 'open';

-- Default-deny RLS: enable RLS with no permissive policies for anon/authenticated.
-- Service-role bypasses RLS entirely; client reads go through RPCs (0002).
alter table public.games enable row level security;
alter table public.questions enable row level security;
alter table public.players enable row level security;
alter table public.answers enable row level security;
alter table public.challenges enable row level security;
