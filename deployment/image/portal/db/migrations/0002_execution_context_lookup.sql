-- The tool gateway receives only a chat id, so it must find the tenant and user from that id before any tenant is known.
-- A SECURITY DEFINER function does exactly that lookup and nothing else, which keeps row-level security on for everything else.
-- execution_contexts therefore stops forcing RLS on its owner (the function owner); the runtime role is still bound by the policy.

alter table execution_contexts no force row level security;

create function resolve_execution_context(p_hash text)
returns table (tenant_id uuid, user_id uuid, conversation_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.tenant_id, e.user_id, e.conversation_id
    from execution_contexts e
   where e.id_hash = p_hash and e.expires_at > now()
$$;

revoke all on function resolve_execution_context(text) from public;
grant execute on function resolve_execution_context(text) to digi_app;
