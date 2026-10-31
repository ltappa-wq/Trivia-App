-- Host-only generation metadata. Existing default-deny games RLS remains in
-- force; reads/writes go through token-authorized server actions, never anon.
alter table public.games
  add column if not exists generation_progress integer not null default 0
    check (generation_progress >= 0),
  add column if not exists generation_started_at timestamptz,
  add column if not exists generation_error text;
