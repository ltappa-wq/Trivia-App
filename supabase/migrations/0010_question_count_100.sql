-- Raise games.question_count ceiling from 50 to 100 (host setup allows 1–100).
-- Drop the old check by name if present; Postgres auto-names table_column_check.

alter table public.games
  drop constraint if exists games_question_count_check;

alter table public.games
  add constraint games_question_count_check
  check (question_count between 1 and 100);
