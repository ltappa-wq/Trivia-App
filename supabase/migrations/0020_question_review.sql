-- Additive: existing callers and player-readable RPCs are unchanged.
alter table public.games add column if not exists review_lease uuid;
alter table public.games add column if not exists review_lease_until timestamptz;
alter table public.games add column if not exists regeneration_count integer not null default 0 check (regeneration_count between 0 and 20);

-- Protect direct advances too, including old deployed server actions.
create or replace function public.guard_question_review() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if old.current_index = -1 and new.current_index >= 0 and
     (old.review_lease_until > clock_timestamp() or old.generation_started_at > clock_timestamp() - interval '310 seconds') then
    raise exception 'Questions are being prepared. Please wait.';
  end if;
  if new.categories is distinct from old.categories and exists (select 1 from public.questions where game_id = old.id) then
    raise exception 'Questions are ready; category suggestions can no longer change this set.';
  end if;
  if new.generation_started_at is not null and new.generation_started_at is distinct from old.generation_started_at
     and exists (select 1 from public.questions where game_id = old.id) then
    raise exception 'Questions already exist. Use the reviewed set.';
  end if;
  return new;
end; $$;
revoke execute on function public.guard_question_review() from public, anon, authenticated;
create trigger guard_question_review before update on public.games for each row execute function public.guard_question_review();

-- Service-only, also token validated. Row locking serializes edits with Start.
create or replace function public.edit_review_question(p_game_id uuid, p_host_token text, p_operation text, p_question_id uuid default null, p_lease uuid default null, p_question jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare g public.games%rowtype; q public.questions%rowtype; item record; lease_id uuid;
begin
  select * into g from public.games where id = p_game_id and host_token_hash = encode(digest(p_host_token, 'sha256'), 'hex') for update;
  if not found then raise exception 'Not authorized'; end if;
  if g.status <> 'lobby' or g.current_index <> -1 then raise exception 'Question review is available only before Start.'; end if;
  if p_operation = 'release' then
    update public.games set review_lease = null, review_lease_until = null where id = g.id and review_lease = p_lease;
    return '{}'::jsonb;
  end if;
  if p_operation = 'replace' then
    if g.review_lease is distinct from p_lease or p_lease is null or g.review_lease_until <= clock_timestamp() then raise exception 'Review changed. Reload and retry.'; end if;
  elsif g.review_lease_until > clock_timestamp() or g.generation_started_at > clock_timestamp() - interval '310 seconds' then
    raise exception 'Questions are being prepared in another tab. Please wait.';
  end if;
  select * into q from public.questions where id = p_question_id and game_id = g.id;
  if not found then raise exception 'Question no longer exists. Reload and retry.'; end if;
  if p_operation = 'claim' then
    if g.regeneration_count >= 20 then raise exception 'This room has reached its limit of 20 regenerations.'; end if;
    lease_id := gen_random_uuid();
    update public.games set review_lease = lease_id, review_lease_until = clock_timestamp() + interval '310 seconds', regeneration_count = regeneration_count + 1 where id = g.id;
    return jsonb_build_object('lease', lease_id, 'attempt', g.regeneration_count + 1);
  elsif p_operation = 'remove' then
    if (select count(*) from public.questions where game_id = g.id) <= 1 then raise exception 'At least one question must remain.'; end if;
    delete from public.questions where id = q.id;
    -- Ascending updates avoid collisions with the nondeferrable unique index.
    for item in select id, index from public.questions where game_id = g.id and index > q.index order by index loop
      update public.questions set index = item.index - 1 where id = item.id;
    end loop;
    update public.games set question_count = (select count(*) from public.questions where game_id = g.id) where id = g.id;
  elsif p_operation = 'replace' then
    update public.questions set prompt = p_question->>'prompt', options = case when jsonb_typeof(p_question->'options') = 'array' then array(select jsonb_array_elements_text(p_question->'options')) end,
      correct_option = (p_question->>'correct_option')::integer,
      accepted_variants = case when jsonb_typeof(p_question->'accepted_variants') = 'array' then array(select jsonb_array_elements_text(p_question->'accepted_variants')) end,
      explanation = p_question->>'explanation' where id = q.id;
    update public.games set review_lease = null, review_lease_until = null where id = g.id;
  else raise exception 'Invalid review operation'; end if;
  return '{}'::jsonb;
end; $$;
revoke execute on function public.edit_review_question(uuid,text,text,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.edit_review_question(uuid,text,text,uuid,uuid,jsonb) to service_role;
