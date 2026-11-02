-- Isolated disposable database only. Never run against a live project.
begin;
do $$
declare
  old_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  created jsonb;
  repeated jsonb;
  joined jsonb;
  again jsonb;
  state jsonb;
  denied boolean := false;
begin
  insert into public.games(id,code,host_token_hash,status,categories,question_count,answer_mode,difficulty,
    answer_timer_ms,auto_advance_ms,double_points_finale)
  values(old_id,'92101',encode(digest('old-host','sha256'),'hex'),'ended',array['Science'],10,'multiple_choice','hard',30000,8000,true),
    (other_id,'92102',encode(digest('other-host','sha256'),'hex'),'ended',array['History'],5,'type_answer','easy',null,null,false);
  insert into public.players(game_id,username,token_hash) values
    (old_id,'Alex',encode(digest('old-player','sha256'),'hex')),
    (other_id,'Other',encode(digest('other-player','sha256'),'hex'));
  begin
    perform public.create_rematch('92101','old-player','create:rematch-test');
  exception when others then denied := true;
  end;
  assert denied, 'player cannot create rematch';
  created := public.create_rematch('92101','old-host','create:rematch-test');
  repeated := public.create_rematch('92101','old-host','create:rematch-test');
  assert created = repeated, 'host retries return same room and token';
  assert created->>'hostToken' <> 'old-host', 'new host token';
  assert created->>'code' <> '92101', 'new room code';
  assert (select categories = array['Science'] and question_count = 10 and answer_mode = 'multiple_choice'
    and difficulty = 'hard' and answer_timer_ms = 30000 and auto_advance_ms = 8000
    and double_points_finale and status = 'lobby' and current_index = -1
    from public.games where id = (created->>'gameId')::uuid), 'settings copied, new lobby';
  insert into public.players(game_id,username,token_hash) values
    ((created->>'gameId')::uuid,'Alex',encode(digest('taken','sha256'),'hex')),
    ((created->>'gameId')::uuid,'Alex (2)',encode(digest('taken2','sha256'),'hex'));
  denied := false;
  begin
    perform public.join_rematch('92101','other-player');
  exception when others then denied := true;
  end;
  assert denied, 'different-game player cannot transfer';
  joined := public.join_rematch('92101','old-player');
  again := public.join_rematch('92101','old-player');
  assert joined = again, 'transfer retries return same seat and credential';
  assert joined->>'username' = 'Alex (3)', 'deterministic collision suffix';
  assert joined->>'token' <> 'old-player', 'fresh player credential';
  assert (select count(*) = 1 from public.players where game_id = (created->>'gameId')::uuid
    and token_hash = encode(digest(joined->>'token','sha256'),'hex')), 'one rematch seat';
  state := public.hydrate_game_state('old-player');
  assert state->'game'->>'rematch_code' = created->>'code', 'reload discovers rematch';
  assert position(created->>'hostToken' in state::text) = 0, 'no host token leaks';
  assert public.hydrate_game_state(joined->>'token')->'game'->>'id' = created->>'gameId', 'new token resolves new room';
  assert public.hydrate_game_state('old-player')->'game'->>'id' = old_id::text, 'old token stays old';
  assert not has_function_privilege('anon','public.create_rematch(text,text,text)','execute'), 'create service only';
  assert not has_function_privilege('authenticated','public.join_rematch(text,text)','execute'), 'transfer service only';
end;
$$;
rollback;
