-- Disposable database only. All fixture writes roll back.
\set ON_ERROR_STOP on
begin;
set local search_path = public, extensions;
do $$
declare
  g uuid; p uuid; q uuid; c uuid; payload jsonb; mode_name text; window_ms integer;
  configured integer; game_mode text; sig text;
begin
  assert exists(select 1 from pg_constraint where conname='games_answer_mode_check');
  assert exists(select 1 from pg_constraint where conname='questions_mode_check');
  assert exists(select 1 from pg_constraint where conname='question_bank_mode_check');
  -- Legacy homogeneous games and mixed games use the same per-question windows.
  foreach game_mode in array array['multiple_choice','type_answer','mixed','true_false'] loop
    foreach mode_name in array array['multiple_choice','type_answer','true_false'] loop
      if game_mode not in ('mixed',mode_name) then continue; end if;
      foreach configured in array array[null::integer,60000] loop
        window_ms := coalesce(configured, case mode_name when 'multiple_choice' then 20000 when 'type_answer' then 35000 else 15000 end);
        insert into games(code,host_token_hash,display_token_hash,categories,question_count,answer_mode,difficulty,status,current_index,reveal_at,answer_timer_ms,double_points_finale)
          values ('92424',encode(digest('mixed-host','sha256'),'hex'),encode(digest('mixed-display','sha256'),'hex'),array['Science'],1,game_mode,'easy','active',0,clock_timestamp(),configured,true) returning id into g;
        insert into players(game_id,username,token_hash) values(g,'Ada',encode(digest('mixed-player','sha256'),'hex')) returning id into p;
        insert into questions(game_id,index,prompt,mode,difficulty,options,correct_option,accepted_variants,explanation)
          values(g,0,'A factual statement.',mode_name,'easy',case when mode_name <> 'type_answer' then array['True','False'] end,case when mode_name <> 'type_answer' then 0 end,case when mode_name = 'type_answer' then array['yes'] end,'A clear explanation.') returning id into q;
        assert hydrate_game_state('mixed-player')->'current_question'->>'mode'=mode_name;
        assert not (hydrate_game_state('mixed-display')->'current_question' ? 'correct_option');
        assert answer_distribution('mixed-player') is null;
        assert game_recap('mixed-player') is null;
        update games set reveal_at=clock_timestamp()-(window_ms-1000)*interval '1 millisecond' where id=g;
        assert not close_question('mixed-host','92424',0,false), 'closed before question deadline';
        update games set reveal_at=clock_timestamp()-(window_ms+1000)*interval '1 millisecond' where id=g;
        begin
          perform close_question('mixed-display','92424',0,false);
          raise exception 'Display mutation allowed';
        exception when raise_exception then if sqlerrm <> 'Not authorized' then raise; end if; end;
        assert close_question('mixed-host','92424',0,false), 'failed to close due question';
        assert reveal_answer('mixed-display')->>'explanation'='A clear explanation.';
        -- Force review back to answering for the atomic answer/cap test.
        update games set reviewing=false, reveal_at=clock_timestamp() where id=g;
        begin
          perform commit_answer(g,q,p,0,'0',true,2001,clock_timestamp());
          raise exception 'Accepted excess finale points';
        exception when raise_exception then if sqlerrm <> 'Invalid awarded points' then raise; end if; end;
        assert commit_answer(g,q,p,0,case when mode_name='type_answer' then 'yes' else '0' end,false,0,(select reveal_at from games where id=g)+(window_ms+1000)/2.0*interval '1 millisecond');
        payload := answer_distribution('mixed-player');
        if mode_name='type_answer' then assert payload->'counts'='null'::jsonb;
        else assert payload->'counts'='[1,0]'::jsonb; end if;
        insert into challenges(question_id,player_id,type) values(q,p,'answer') returning id into c;
        update games set paused=true where id=g;
        perform resolve_challenge(g,c,true,null);
        assert (select awarded_points=1500 and is_correct from answers where question_id=q), 'challenge did not use question window/finale';
        assert (select score=1500 from players where id=p);
        update games set status='ended' where id=g;
        payload := game_recap('mixed-player');
        assert payload->'personal'->'questions'->0->>'answer'=case when mode_name='type_answer' then 'yes' else 'True' end;
        assert payload->'personal'->'questions'->0->>'correct_answer'=case when mode_name='type_answer' then 'yes' else 'True' end;
        assert game_recap('mixed-display')->'personal'='null'::jsonb;
        assert (create_rematch('92424','mixed-host',g::text)->>'code') is not null;
        assert (select dst.answer_mode=game_mode from games src join games dst on dst.id=src.rematch_game_id where src.id=g);
        delete from games where id=(select rematch_game_id from games where id=g);
        delete from games where id=g;
      end loop;
    end loop;
  end loop;
  insert into question_bank(prompt,prompt_norm,mode,options,correct_option,difficulty,categories)
    values('A binary fact.','a binary fact','true_false',array['True','False'],1,'easy',array['Science']);
  foreach sig in array array['close_question(text,text,integer,boolean)','resolve_challenge(uuid,uuid,boolean,text)'] loop
    assert not has_function_privilege('anon',sig,'EXECUTE');
    assert not has_function_privilege('authenticated',sig,'EXECUTE');
    assert has_function_privilege('service_role',sig,'EXECUTE');
  end loop;
  foreach sig in array array['answer_distribution(text)','game_recap(text)'] loop
    assert has_function_privilege('anon',sig,'EXECUTE');
    assert has_function_privilege('authenticated',sig,'EXECUTE');
    assert has_function_privilege('service_role',sig,'EXECUTE');
  end loop;
end;
$$;
rollback;
