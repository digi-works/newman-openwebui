-- Digi can look up campus events (the events and class times imported into Digi). Anyone who can use Digi may ask, Faculty and Students included.
insert into capabilities (id, kind, name, description, risk, permission, owui_tool_id) values
  ('events.search', 'tool', 'Find campus events', 'Looks up events on campus by date or name. Read only.', 'read', 'chat.use', 'digi_events')
on conflict (id) do nothing;
