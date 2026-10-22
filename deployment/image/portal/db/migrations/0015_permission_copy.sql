-- The Permissions page described "Tool connections" as something done there, but no screen manages tool servers: they are set up through
-- Digi's admin API (QA DEF-59). Say so, so nobody goes looking for a page that does not exist.
update permissions
   set description = 'Manage the tool servers Digi can call. There is no screen for this; your platform team sets them up through Digi''s admin API.'
 where code = 'mcp.manage';
