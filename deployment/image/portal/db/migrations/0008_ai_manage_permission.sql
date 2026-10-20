-- M5.6: who may manage the organisation's AI connection (the customer's own LLM key). Admin holds every permission already.
insert into permissions (code, module, action, label, description, sort, enforced) values
  ('ai.manage', 'AI connection', 'manage', 'Manage the AI connection', 'Add or replace the organisation''s AI provider key, test it, and see usage limits.', 50, true)
on conflict (code) do nothing;
