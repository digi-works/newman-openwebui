-- Admins asked to approve their own room requests instead of signing in as someone else to do it. A separate permission, so it stays a
-- choice: the Admin role holds every permission and gets it at once; other roles get it only when an Admin ticks it on the Permissions page.
insert into permissions (code, module, action, label, description, sort, enforced) values
  ('bookings.approve_own', 'Bookings', 'approve_own', 'Approve own requests', 'Approve or decline room requests this person made. Needs "Approve or decline requests" too.', 26, true)
on conflict (code) do nothing;

update permissions
   set description = 'Decide room requests. Their own requests too only with "Approve own requests".'
 where code = 'bookings.approve';
