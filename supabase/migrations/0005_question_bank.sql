-- U4 / R7 / KTD4. Durable cross-game question bank.
-- Unlike public.questions (which is game-scoped and cascade-deleted with its
-- game), this table persists every validated question ever generated so future
-- generations can skip repeats (R7.1). Dedup is by normalized prompt text
-- (lib/generation/dedup.ts), enforced by a unique index on prompt_norm (R7.2).
-- Full question columns are stored (not just the norm) so the bank can later
-- serve a reusable question without a fresh xAI call (deferred).
--
-- Security posture matches 0001: default-deny RLS for anon; only the service-role
-- server action reads/writes it (generation runs server-side, never client-side).

create table if not exists public.question_bank (
  id                uuid primary key default gen_random_uuid(),
  prompt            text not null,
  -- Normalized prompt (lowercase, punctuation-stripped, whitespace-collapsed).
  -- The dedup key; unique so an identical prompt can't be banked twice.
  prompt_norm       text not null,
  mode              text not null check (mode in ('multiple_choice', 'type_answer')),
  options           text[],
  correct_option    integer,
  accepted_variants text[],
  difficulty        text not null check (difficulty in ('easy', 'medium', 'hard')),
  categories        text[] not null default '{}',
  created_at        timestamptz not null default now()
);

create unique index if not exists uniq_question_bank_prompt_norm
  on public.question_bank (prompt_norm);

-- Default-deny RLS: no permissive policies for anon/authenticated; the
-- service-role client bypasses RLS and is the only accessor.
alter table public.question_bank enable row level security;
