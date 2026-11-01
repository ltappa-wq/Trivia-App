-- Disposable local database only, after all migrations. Fixtures roll back.
\set ON_ERROR_STOP on
begin;
set local search_path = public, extensions;
do $$
declare
  g uuid; q uuid; qlast uuid; p uuid; c uuid; result boolean; payload jsonb;
  t timestamptz := clock_timestamp();
begin
  insert into games(code,host_token_hash,categories,question_count,answer_mode,difficulty,status,current_index,reveal_at)
    values ('91919',encode(digest('options-host','sha256'),'hex'),array['History'],2,'type_answer','medium','active',0,t)
    returning id into g;
  insert into questions(game_id,index,prompt,mode,difficulty,accepted_variants)
    values(g,0,'First?','type_answer','medium',array['yes']) returning id into q;
  insert into questions(game_id,index,prompt,mode,difficulty,accepted_variants)
    values(g,1,'Last?','type_answer','medium',array['yes']) returning id into qlast;
  insert into players(game_id,username,token_hash)
    values(g,'Tester',encode(digest('options-player','sha256'),'hex')) returning id into p;

  -- Old deployed callers, unchanged signatures and omitted settings.
  update games set reveal_at = t - interval '25 seconds' where id = g;
  assert not close_question('options-player','91919',0), 'Legacy type timer must still be 35s';
  update games set reveal_at = t - interval '36 seconds' where id = g;
  assert close_question('options-player','91919',0), 'Legacy type timer must close';
  assert (select auto_advance_at is null from games where id=g), 'Legacy automation stays off';
  payload := hydrate_game_state('options-player');
  assert payload->'game'->'answer_timer_ms' = 'null'::jsonb;
  assert payload->'current_question'->>'prompt' = 'First?';
  assert not (payload->'current_question' ? 'accepted_variants'), 'No answer key leak';
  assert not close_question('options-player','91919',0), 'Close is idempotent';

  -- Constraints reject unsupported timer/delay values.
  begin
    update games set answer_timer_ms = 35000 where id=g;
    raise exception 'Unsupported timer accepted';
  exception when check_violation then null; end;
  begin
    update games set auto_advance_ms = 1000 where id=g;
    raise exception 'Unsupported delay accepted';
  exception when check_violation then null; end;

  -- Custom close deadlines and a full server-stamped review delay.
  update games set reviewing=false, answer_timer_ms=60000, auto_advance_ms=8000,
    reveal_at=clock_timestamp()-interval '36 seconds' where id=g;
  assert not close_question('options-player','91919',0), 'Custom timer must stay open';
  update games set reveal_at=clock_timestamp()-interval '61 seconds' where id=g;
  assert close_question('options-host','91919',0), 'Custom timer must close';
  assert (select auto_advance_at > clock_timestamp()+interval '7 seconds' from games where id=g);
  assert not auto_advance_question('options-player','91919',0), 'Cannot advance before deadline';
  begin
    perform set_review_auto_advance('options-player','91919',0,false);
    raise exception 'Player cancelled host schedule';
  exception when raise_exception then
    if sqlerrm <> 'Host token required' then raise; end if;
  end;
  assert set_review_auto_advance('options-host','91919',0,false);
  assert (select auto_advance_at is null from games where id=g);
  assert not auto_advance_question('options-host','91919',0);
  assert set_review_auto_advance('options-host','91919',0,true);

  -- Open challenges block even a due request; resolution restarts full delay.
  update games set auto_advance_at=clock_timestamp()-interval '1 second' where id=g;
  c := create_challenge_and_pause(g,q,p,'question',null);
  assert not auto_advance_question('options-host','91919',0), 'Pause blocks advancement';
  update games set paused=false where id=g;
  assert not auto_advance_question('options-host','91919',0), 'Open challenge independently blocks';
  update games set paused=true where id=g;
  perform resolve_challenge(g,c,false,null);
  assert (select auto_advance_at > clock_timestamp()+interval '7 seconds' from games where id=g);
  update games set auto_advance_at=clock_timestamp()-interval '1 second' where id=g;
  assert not auto_advance_question('options-host','91919',1), 'Stale index cannot skip';
  assert auto_advance_question('options-player','91919',0), 'Participant may advance due review';
  assert not auto_advance_question('options-host','91919',0), 'CAS prevents duplicate advance';
  assert (select current_index=1 and not reviewing and auto_advance_at is null and reveal_at>clock_timestamp() from games where id=g);

  -- Only enabled final questions may commit >1000 points.
  update games set reveal_at=t, double_points_finale=false where id=g;
  begin
    perform commit_answer(g,qlast,p,1,'yes',true,2000,t+interval '1 second');
    raise exception 'Non-finale cap bypassed';
  exception when raise_exception then
    if sqlerrm <> 'Invalid awarded points' then raise; end if;
  end;
  update games set double_points_finale=true, current_index=0 where id=g;
  begin
    perform commit_answer(g,q,p,0,'yes',true,2000,t+interval '1 second');
    raise exception 'Nonfinal cap bypassed';
  exception when raise_exception then
    if sqlerrm <> 'Invalid awarded points' then raise; end if;
  end;
  update games set current_index=1 where id=g;
  assert commit_answer(g,qlast,p,1,'yes',true,2000,t+interval '1 second');
  assert (select score=2000 from players where id=p);
  assert (select auto_advance_at is null from games where id=g), 'Last question never schedules finish';
  update games set auto_advance_at=clock_timestamp()-interval '1 second' where id=g;
  assert not auto_advance_question('options-host','91919',1), 'Last question never auto-finishes';

  -- Upheld answer uses the custom deadline and applies 2x after rounding.
  update answers set is_correct=false, awarded_points=0, submitted_at=t+interval '60 seconds' where question_id=qlast;
  update players set score=0 where id=p;
  c := create_challenge_and_pause(g,qlast,p,'answer','yes');
  perform resolve_challenge(g,c,true,null);
  assert (select score=1000 from players where id=p), '60s finale deadline awards 2x500';
  assert (select awarded_points=1000 and is_correct from answers where question_id=qlast);

  -- All-answered close also stamps auto deadline on nonfinal questions.
  update games set current_index=0, reviewing=false, auto_advance_at=null, reveal_at=t where id=g;
  assert commit_answer(g,q,p,0,'yes',true,1000,t+interval '1 second');
  assert (select auto_advance_at>clock_timestamp()+interval '7 seconds' from games where id=g);
  assert not has_function_privilege('anon','public.auto_advance_question(text,text,integer)','execute');
  assert not has_function_privilege('authenticated','public.set_review_auto_advance(text,text,integer,boolean)','execute');
end;
$$;
rollback;
