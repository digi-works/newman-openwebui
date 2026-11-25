-- Course scheduling: who may make drafts (run the solver). A draft is a new version; nothing that exists is changed.
-- The Admin role holds every permission already; other roles get it when an Admin ticks it on the Permissions page.
insert into permissions (code, module, action, label, description, sort, enforced) values
  ('scheduling.manage', 'Scheduling', 'manage', 'Make timetable drafts', 'Generate a draft timetable with the scheduler. Needs "See course scheduling" too.', 61, true)
on conflict (code) do nothing;
