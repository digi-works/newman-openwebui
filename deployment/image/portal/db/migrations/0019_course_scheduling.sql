-- Course scheduling: who may see the Scheduling pages (the checker's findings and suggested fixes for a term's timetable).
-- The Admin role holds every permission already; other roles get it when an Admin ticks it on the Permissions page.
insert into permissions (code, module, action, label, description, sort, enforced) values
  ('scheduling.view', 'Scheduling', 'view', 'See course scheduling', 'See the term''s timetable checks: clashes, missing information and suggested fixes.', 60, true)
on conflict (code) do nothing;
