-- Owner/developer only: psql -v ON_ERROR_STOP=1 against an ISOLATED test DB.
-- Never production. Requires 0001–0017; fixtures and changes roll back.
begin;
-- Dedicated empty database required; avoid mixing with unrelated fixtures.
do $$ begin
  if exists(select 1 from public.games) or exists(select 1 from public.rate_limit_hits) then
    raise exception 'Requires empty isolated test database';
  end if;
end $$;
insert into public.games(code, host_token_hash, categories, question_count, answer_mode, difficulty)
select lpad(n::text, 5, '0'), 'host', array['Science'], 1, 'multiple_choice', 'easy'
from generate_series(1, 108) n;
update public.games set status = 'active' where code = '00106';
update public.games set status = 'ended' where code in ('00107', '00108');
insert into public.players(game_id, username, token_hash)
select id, 'Tester', 'unique-token-hash' from public.games where code = '00001';
insert into public.questions(game_id, index, prompt, mode, difficulty)
select id, 0, 'Fixture?', 'multiple_choice', 'easy' from public.games where code = '00001';
insert into public.answers(question_id, player_id, raw_answer)
select q.id, p.id, 'Fixture' from public.questions q join public.players p using(game_id);
insert into public.challenges(question_id, player_id, type)
select q.id, p.id, 'question' from public.questions q join public.players p using(game_id);
insert into public.category_suggestions(game_id, player_id, category)
select game_id, id, 'Science' from public.players;
insert into public.question_bank(prompt, prompt_norm, mode, difficulty)
values('Durable fixture?', 'durable fixture', 'multiple_choice', 'easy');
-- Simulate elapsed wall-clock time without changing production trigger logic.
alter table public.games disable trigger track_game_activity;
update public.games set last_activity_at = now() - interval '2 days', created_at = now() - interval '30 days';
update public.games set last_activity_at = now() - interval '3 days' where code = '00001';
update public.games set ended_at = now() - interval '8 days' where code = '00107';
alter table public.games enable trigger track_game_activity;
-- Join/suggestion/question writes refresh an otherwise stale lobby.
insert into public.players(game_id, username, token_hash)
select id, 'Recent join', 'recent-token-hash' from public.games where code = '00105';
insert into public.rate_limit_hits(key, hit_at)
select 'old-' || n, now() - interval '2 days' from generate_series(1, 1005) n;
insert into public.rate_limit_hits(key) values('fresh');
do $$
declare counts jsonb;
begin
  counts := public.cleanup_stale_data();
  assert (counts->>'dry_run')::boolean;
  assert (counts->>'games')::integer = 100;
  assert (counts->>'rate_limit_hits')::integer = 1000;
  assert (counts->>'questions')::integer = 1;
  assert (counts->>'answers')::integer = 1;
  assert (counts->>'challenges')::integer = 1;
  assert (counts->>'category_suggestions')::integer = 1;
  assert (select count(*) from public.games) = 108, 'Dry run changed games';
  assert (select count(*) from public.rate_limit_hits) = 1006, 'Dry run changed hits';
  counts := public.cleanup_stale_data(false);
  assert (counts->>'games')::integer = 100;
  assert (select count(*) from public.games) = 8, 'Game batch exceeded';
  assert (select count(*) from public.rate_limit_hits) = 6, 'Rate batch exceeded';
  assert not exists(select 1 from public.questions), 'Question cascade failed';
  assert not exists(select 1 from public.answers), 'Answer cascade failed';
  assert not exists(select 1 from public.challenges), 'Challenge cascade failed';
  assert not exists(select 1 from public.category_suggestions), 'Suggestion cascade failed';
  perform public.cleanup_stale_data(false);
  assert (select count(*) from public.games) = 3, 'Expected active, fresh-ended and recently joined lobby';
  assert exists(select 1 from public.games where code = '00106' and status = 'active'), 'Deleted active game';
  assert exists(select 1 from public.games where code = '00108'), 'Used creation instead of end time';
  assert exists(select 1 from public.games where code = '00105'), 'Ignored join activity';
  assert (select count(*) from public.players) = 1, 'Player cascade failed';
  assert (select count(*) from public.question_bank where prompt_norm = 'durable fixture') = 1, 'Deleted durable memory';
  assert (select count(*) from public.rate_limit_hits) = 1, 'Deleted fresh hit';
  assert not has_function_privilege('anon', 'public.cleanup_stale_data(boolean)', 'execute');
  assert not has_function_privilege('authenticated', 'public.cleanup_stale_data(boolean)', 'execute');
  assert has_function_privilege('service_role', 'public.cleanup_stale_data(boolean)', 'execute');
  assert (select count(*) from cron.job where jobname = 'buzzr-stale-data-cleanup' and username = current_user) = 1;
  raise notice 'PASS: cleanup dry run, activity/end retention, active guard, cascades, bank preservation, caps, grants and cron job';
end $$;
rollback;
