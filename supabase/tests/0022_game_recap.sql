-- Disposable local database only; all fixtures roll back.
\set ON_ERROR_STOP on
begin;
set local search_path = public, extensions;
do $$
declare
  g uuid; foreign_g uuid; q uuid; last_q uuid; p uuid; other_p uuid;
  payload jsonb; t timestamptz := clock_timestamp();
begin
  insert into games(code,host_token_hash,categories,question_count,answer_mode,difficulty,status,current_index,reveal_at,double_points_finale)
    values ('92222',encode(digest('recap-host','sha256'),'hex'),array['History'],2,'multiple_choice','medium','active',0,t,true) returning id into g;
  insert into players(game_id,username,token_hash,score) values
    (g,'Ada',encode(digest('recap-player','sha256'),'hex'),2000) returning id into p;
  insert into players(game_id,username,token_hash) values
    (g,'Other',encode(digest('recap-other','sha256'),'hex')) returning id into other_p;
  insert into players(game_id,username,token_hash,is_spectator) values
    (g,'Spectator',encode(digest('recap-spectator','sha256'),'hex'),true);
  insert into questions(game_id,index,prompt,mode,difficulty,options,correct_option,correction)
    values(g,0,'First?','multiple_choice','medium',array['yes','no'],0,'Corrected yes') returning id into q;
  insert into questions(game_id,index,prompt,mode,difficulty,accepted_variants)
    values(g,1,'Final?','type_answer','medium',array['yes']) returning id into last_q;
  insert into answers(question_id,player_id,raw_answer,is_correct,awarded_points,submitted_at) values
    (q,p,'0',true,1000,t + interval '0.5 seconds'),
    (q,other_p,'OTHER PRIVATE ANSWER',false,0,t + interval '1 second');
  assert (select elapsed_ms = 500 from answers where question_id=q and player_id=p), 'Trigger records exact elapsed time';
  assert game_recap('recap-player') is null, 'Active gate';
  assert game_recap('recap-host') is null, 'Host cannot bypass active gate';
  assert game_recap('invalid-token') is null, 'Invalid token gate';
  update games set status='lobby' where id=g;
  assert game_recap('recap-player') is null, 'Lobby gate';
  update games set status='ended' where id=g;
  payload := game_recap('recap-player');
  assert jsonb_array_length(payload->'personal'->'questions') = 2, 'Includes unanswered questions';
  assert payload->'personal'->'questions'->0->>'answer' = 'yes', 'MC answer label';
  assert payload->'personal'->'questions'->0->>'correct_answer' = 'Corrected yes', 'Correction takes precedence';
  assert payload->'personal'->'questions'->1->'answer' = 'null'::jsonb, 'No answer remains null';
  assert payload->'personal'->'questions'->1->>'finale' = 'true', 'Finale label';
  assert payload::text not like '%OTHER PRIVATE ANSWER%', 'Never leaks another raw answer';
  assert (payload->'room'->>'player_count')::integer = 2, 'Spectators excluded';
  assert (payload->'room'->'questions'->0->>'correct_count')::integer = 1, 'Aggregate correct count';
  assert payload->'room'->'fastest'->0->>'username' = 'Ada', 'Fastest correct player';
  assert game_recap('recap-host')->'personal' = 'null'::jsonb, 'Host-only has no personal answers';
  assert game_recap('recap-spectator')->'personal' = 'null'::jsonb, 'Spectator has no personal answers';
  assert game_recap('recap-host')->'room' = payload->'room', 'Host receives room aggregates';
  assert game_recap('recap-other')->'personal'->'questions'->0->>'answer' = 'OTHER PRIVATE ANSWER', 'Other caller sees own answer';
  -- Simulate the next question using the unchanged deployed writer contract.
  update games set status='active', current_index=1, reveal_at=t, reviewing=false where id=g;
  perform commit_answer(g,last_q,p,1,'yes',true,2000,t + interval '0.5 seconds');
  perform commit_answer(g,last_q,other_p,1,'yes',true,2000,t + interval '0.5 seconds');
  update games set status='ended' where id=g;
  payload := game_recap('recap-player');
  assert (payload->'personal'->'questions'->1->>'points')::integer = 2000, 'Stored finale points unchanged';
  assert jsonb_array_length(payload->'room'->'fastest') = 2, 'Includes all fastest ties';
  assert payload->'personal'->'questions'->1->>'is_correct' = 'true', 'Adjudicated correctness';
  insert into games(code,host_token_hash,categories,question_count,answer_mode,difficulty,status)
    values ('92223',encode(digest('foreign-host','sha256'),'hex'),array['History'],1,'type_answer','medium','ended') returning id into foreign_g;
  insert into questions(game_id,index,prompt,mode,difficulty,accepted_variants)
    values(foreign_g,0,'FOREIGN ROOM PROMPT','type_answer','medium',array['secret']);
  assert game_recap('recap-player')::text not like '%FOREIGN ROOM PROMPT%', 'Room scope';
  update questions set voided=true where id=q;
  assert (game_recap('recap-player')->'personal'->'questions'->0->>'points')::integer = 0, 'Voids award no points';
  update questions set voided=true where id=last_q;
  assert jsonb_array_length(game_recap('recap-player')->'room'->'fastest') = 0, 'Voids excluded from fastest';
  assert has_function_privilege('anon','public.game_recap(text)','EXECUTE');
  assert has_function_privilege('authenticated','public.game_recap(text)','EXECUTE');
  assert not has_function_privilege('anon','public.capture_answer_elapsed()','EXECUTE');
end;
$$;
set local role anon;
select public.game_recap('invalid-token');
reset role;
rollback;
