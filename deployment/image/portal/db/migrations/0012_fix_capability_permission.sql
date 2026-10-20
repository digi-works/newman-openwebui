-- 0011's register_capability_permission used a variable named like the column it conflicts on; renamed so the upsert is unambiguous.
create or replace function register_capability_permission(p_worker text, p_label text, p_description text)
returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_code text := 'capability.' || p_worker || '.use';
begin
  if p_worker !~ '^[a-z0-9][a-z0-9-]{1,40}$' then raise exception 'invalid capability id'; end if;
  insert into permissions as p (code, module, action, label, description, sort, enforced, scope)
  values (v_code, 'AI Capabilities', 'use', left(p_label, 80), left(p_description, 240), 900, true, 'customer')
  on conflict on constraint permissions_pkey do update set label = excluded.label, description = excluded.description;
  return v_code;
end $$;
