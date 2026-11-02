-- Disposable local database only; all fixtures roll back.
\set ON_ERROR_STOP on
begin;
set local search_path = public, extensions;
do $$
declare
  g uuid; p uuid; q uuid; payload jsonb; signature text; role_name text;
begin
  insert into games(code,host_token_hash,display_token_hash,categories,question_count,answer_mode,difficulty,status,current_index,reveal_at)
    values ('92323',encode(digest('tv-host','sha256'),'hex'),encode(digest('tv-display','sha256'),'hex'),array['History'],2,'multiple_choice','medium','active',0,clock_timestamp()-interval '30 seconds') returning id into g;
  insert into players(game_id,username,token_hash) values(g,'Viewer',encode(digest('tv-player','sha256'),'hex')) returning id into p;
  insert into questions(game_id,index,prompt,mode,difficulty,options,correct_option,explanation)
    values(g,0,'First?','multiple_choice','medium',array['Yes','No'],0,'A public explanation.') returning id into q;
  insert into questions(game_id,index,prompt,mode,difficulty,options,correct_option)
    values(g,1,'Next?','multiple_choice','medium',array['Yes','No'],0);
  insert into answers(question_id,player_id,raw_answer,is_correct,awarded_points)
    values(q,p,'0',true,100);

  assert (select role='display' and player_id is null from resolve_token('tv-display'));
  payload := hydrate_game_state('tv-display');
  assert payload->>'role' = 'display';
  assert payload->'player' = 'null'::jsonb and payload->'my_answer' = 'null'::jsonb;
  assert not (payload->'current_question' ? 'correct_option');
  assert not (payload->'game' ? 'display_token_hash');
  assert reveal_answer('tv-display') is null;
  assert answer_distribution('tv-display') is null;
  assert list_open_challenges('tv-display') = '[]'::jsonb;
  assert list_category_suggestions('tv-display') = '[]'::jsonb;
  payload := answer_progress('tv-display');
  assert payload->>'answered_count' = '1';
  assert payload->'answered_player_ids' = '[]'::jsonb;

  -- Due close is denied even with a valid room and expired timer.
  begin
    perform close_question('tv-display','92323',0,false);
    raise exception 'Display closed question';
  exception when raise_exception then
    if sqlerrm <> 'Not authorized' then raise; end if;
  end;
  begin
    perform close_question('tv-display','92323',0,true);
    raise exception 'Display forced close';
  exception when raise_exception then
    if sqlerrm <> 'Not authorized' then raise; end if;
  end;
  assert close_question('tv-host','92323',0,false);
  assert reveal_answer('tv-display')->>'explanation' = 'A public explanation.';
  assert answer_distribution('tv-display')->>'correct_option' = '0';
  update games set auto_advance_ms=8000, auto_advance_at=clock_timestamp()-interval '1 second' where id=g;
  begin
    perform auto_advance_question('tv-display','92323',0);
    raise exception 'Display advanced';
  exception when raise_exception then
    if sqlerrm <> 'Not authorized' then raise; end if;
  end;
  begin
    perform set_review_auto_advance('tv-display','92323',0,false);
    raise exception 'Display changed schedule';
  exception when raise_exception then
    if sqlerrm <> 'Host token required' then raise; end if;
  end;
  assert (select current_index=0 and reviewing from games where id=g);

  -- All remaining mutation RPCs accept trusted UUIDs, not tokens, and cannot
  -- be invoked by a browser carrying a display credential (anon/authenticated).
  foreach signature in array array[
    'close_question(text,text,integer,boolean)', 'auto_advance_question(text,text,integer)',
    'set_review_auto_advance(text,text,integer,boolean)',
    'commit_answer(uuid,uuid,uuid,integer,text,boolean,integer,timestamp with time zone)',
    'create_challenge_and_pause(uuid,uuid,uuid,text,text)', 'resolve_challenge(uuid,uuid,boolean,text)',
    'end_game(uuid)', 'adjust_player_score(uuid,integer)', 'cleanup_stale_data(boolean)', 'resolve_token(text)'
  ] loop
    foreach role_name in array array['anon','authenticated'] loop
      assert not has_function_privilege(role_name, 'public.'||signature, 'EXECUTE'), signature||' exposed to '||role_name;
    end loop;
    assert has_function_privilege('service_role', 'public.'||signature, 'EXECUTE');
  end loop;
  update games set display_token_hash=encode(digest('tv-replacement','sha256'),'hex') where id=g;
  assert hydrate_game_state('tv-display') is null;
  assert hydrate_game_state('tv-replacement')->>'role' = 'display';
  update games set display_token_hash=null where id=g;
  assert hydrate_game_state('tv-replacement') is null;
end;
$$;
rollback;
