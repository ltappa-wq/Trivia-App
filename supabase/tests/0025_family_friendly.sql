-- Disposable local Supabase only; all fixtures roll back.
begin;
do $$
declare
  source_id uuid := gen_random_uuid();
  legacy_id uuid := gen_random_uuid();
  created jsonb;
  denied boolean := false;
begin
  insert into public.games(id,code,host_token_hash,status,categories,question_count,answer_mode,difficulty,family_friendly)
  values(source_id,'92501',encode(digest('family-host','sha256'),'hex'),'ended',array['History'],3,'mixed','medium',true);
  insert into public.games(id,code,host_token_hash,status,categories,question_count,answer_mode,difficulty)
  values(legacy_id,'92502',encode(digest('legacy-host','sha256'),'hex'),'ended',array['Science'],3,'multiple_choice','easy');
  assert (select not family_friendly and family_replaced_count = 0 from public.games where id = legacy_id), 'legacy defaults off';
  begin
    perform public.create_rematch('92501','wrong','family-test');
  exception when others then denied := true;
  end;
  assert denied, 'authorization preserved';
  created := public.create_rematch('92501','family-host','family-test');
  assert created = public.create_rematch('92501','family-host','family-test'), 'idempotence preserved';
  assert (select family_friendly and family_replaced_count = 0 and answer_mode = 'mixed'
    from public.games where id = (created->>'gameId')::uuid), 'family flag copied, counter reset';
  created := public.create_rematch('92502','legacy-host','legacy-family-test');
  assert (select not family_friendly from public.games where id = (created->>'gameId')::uuid), 'off preserved';
  assert not has_function_privilege('anon','public.create_rematch(text,text,text)','execute'), 'anon denied';
  assert not has_function_privilege('authenticated','public.create_rematch(text,text,text)','execute'), 'authenticated denied';
  assert has_function_privilege('service_role','public.create_rematch(text,text,text)','execute'), 'service allowed';
end;
$$;
rollback;
