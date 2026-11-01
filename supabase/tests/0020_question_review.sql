-- Disposable local database only. Everything rolls back.
begin;
do $$
declare gid uuid; qid uuid; lease_id uuid; result jsonb; i integer; n integer;
begin
  insert into public.games(code,host_token_hash,categories,question_count,answer_mode,difficulty)
    values ('22000',encode(extensions.digest('review-host','sha256'),'hex'),array['Geography'],3,'type_answer','easy') returning id into gid;
  for i in 0..2 loop
    insert into public.questions(game_id,index,prompt,mode,accepted_variants,difficulty)
      values(gid,i,'Question ' || i,'type_answer',array['Paris'],'easy');
  end loop;
  select id into qid from public.questions where game_id=gid and index=1;
  begin
    perform public.edit_review_question(gid,'player-token','remove',qid);
    raise exception 'Unauthorized edit succeeded';
  exception when others then if sqlerrm <> 'Not authorized' then raise; end if; end;
  perform public.edit_review_question(gid,'review-host','remove',qid);
  select count(*) into n from public.questions where game_id=gid and index in (0,1);
  if n <> 2 or (select question_count from public.games where id=gid) <> 2 then raise exception 'Removal count/index mismatch'; end if;
  select id into qid from public.questions where game_id=gid and index=0;
  result := public.edit_review_question(gid,'review-host','claim',qid);
  lease_id := (result->>'lease')::uuid;
  begin
    update public.games set status='active',current_index=0 where id=gid;
    raise exception 'Start bypassed lease';
  exception when others then if sqlerrm <> 'Questions are being prepared. Please wait.' then raise; end if; end;
  begin
    perform public.edit_review_question(gid,'review-host','remove',qid);
    raise exception 'Remove bypassed lease';
  exception when others then if sqlerrm <> 'Questions are being prepared in another tab. Please wait.' then raise; end if; end;
  begin
    perform public.edit_review_question(gid,'review-host','claim',qid);
    raise exception 'Second tab claimed lease';
  exception when others then if sqlerrm <> 'Questions are being prepared in another tab. Please wait.' then raise; end if; end;
  begin
    perform public.edit_review_question(gid,'review-host','replace',qid,gen_random_uuid(),'{"prompt":"Bad"}');
    raise exception 'Stale lease replaced';
  exception when others then if sqlerrm <> 'Review changed. Reload and retry.' then raise; end if; end;
  perform public.edit_review_question(gid,'review-host','replace',qid,lease_id,'{"prompt":"Fresh","accepted_variants":["Tokyo"],"explanation":"A fact."}');
  if (select prompt from public.questions where id=qid) <> 'Fresh' then raise exception 'Replacement missing'; end if;
  begin
    update public.games set categories=array['Music'] where id=gid;
    raise exception 'Categories changed after generation';
  exception when others then if sqlerrm <> 'Questions are ready; category suggestions can no longer change this set.' then raise; end if; end;
  update public.games set regeneration_count=20 where id=gid;
  begin
    perform public.edit_review_question(gid,'review-host','claim',qid);
    raise exception 'Regeneration exceeded cap';
  exception when others then if sqlerrm <> 'This room has reached its limit of 20 regenerations.' then raise; end if; end;
  perform public.edit_review_question(gid,'review-host','remove',qid);
  select id into qid from public.questions where game_id=gid;
  begin
    perform public.edit_review_question(gid,'review-host','remove',qid);
    raise exception 'Last question removed';
  exception when others then if sqlerrm <> 'At least one question must remain.' then raise; end if; end;
  update public.games set regeneration_count=0 where id=gid;
  result := public.edit_review_question(gid,'review-host','claim',qid);
  lease_id := (result->>'lease')::uuid;
  update public.games set review_lease_until=clock_timestamp() - interval '1 second' where id=gid;
  update public.games set status='active',current_index=0 where id=gid;
  begin
    perform public.edit_review_question(gid,'review-host','replace',qid,lease_id,'{"prompt":"Too late"}');
    raise exception 'Replacement after Start succeeded';
  exception when others then if sqlerrm <> 'Question review is available only before Start.' then raise; end if; end;
  if has_function_privilege('anon','public.edit_review_question(uuid,text,text,uuid,uuid,jsonb)','execute') or
     has_function_privilege('authenticated','public.edit_review_question(uuid,text,text,uuid,uuid,jsonb)','execute') or
     not has_function_privilege('service_role','public.edit_review_question(uuid,text,text,uuid,uuid,jsonb)','execute') then
    raise exception 'Incorrect review RPC privileges';
  end if;
end; $$;
rollback;
