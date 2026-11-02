-- R32: additive, compatible with currently deployed callers and existing games.
alter table public.games add column family_friendly boolean not null default false;
alter table public.games add column family_replaced_count integer not null default 0
  check (family_replaced_count >= 0);

create or replace function public.create_rematch(p_code text, p_token text, p_rate_key text)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  src public.games%rowtype;
  dst public.games%rowtype;
  new_id uuid;
  new_token text;
  candidate text;
  attempt integer;
begin
  select * into src from public.games
    where code = p_code and host_token_hash = encode(digest(p_token, 'sha256'), 'hex')
      and status = 'ended' for update;
  if not found then raise exception 'Host token required for ended game'; end if;
  if src.rematch_game_id is null then
    if not public.check_rate_limit(p_rate_key, 5, 60000) then
      raise exception 'Too many games created — please wait a moment.';
    end if;
    new_id := gen_random_uuid();
    new_token := encode(digest('rematch-host:' || p_token || ':' || new_id::text, 'sha256'), 'hex');
    for attempt in 1..20 loop
      candidate := lpad(floor(random() * 100000)::integer::text, 5, '0');
      if candidate = src.code then continue; end if;
      begin
        insert into public.games(id, code, host_token_hash, categories, question_count,
          answer_mode, difficulty, answer_timer_ms, auto_advance_ms, double_points_finale, family_friendly)
        values (new_id, candidate, encode(digest(new_token, 'sha256'), 'hex'), src.categories,
          src.question_count, src.answer_mode, src.difficulty, src.answer_timer_ms,
          src.auto_advance_ms, src.double_points_finale, src.family_friendly) returning * into dst;
        exit;
      exception when unique_violation then null;
      end;
    end loop;
    if dst.id is null then raise exception 'Could not allocate room code'; end if;
    update public.games set rematch_game_id = dst.id where id = src.id;
  else
    select * into dst from public.games where id = src.rematch_game_id;
    new_token := encode(digest('rematch-host:' || p_token || ':' || dst.id::text, 'sha256'), 'hex');
  end if;
  return jsonb_build_object('gameId', dst.id, 'code', dst.code, 'hostToken', new_token);
end;
$$;

revoke execute on function public.create_rematch(text,text,text) from public, anon, authenticated;
grant execute on function public.create_rematch(text,text,text) to service_role;
