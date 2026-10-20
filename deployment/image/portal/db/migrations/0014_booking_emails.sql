-- Room booking emails and calendar invites, sent through Microsoft Graph from one mailbox (MAIL_FROM).
-- The organisation switches them on in Settings > Notifications; until then nothing is emailed and the bell works as before.

create table notification_settings (
  tenant_id              uuid primary key references tenants (id),
  -- "Room booking email notifications": the room manager is asked to approve or reject, the requester hears every change
  booking_emails_enabled boolean not null default false,
  -- comma-separated inboxes that receive new requests with Approve / Reject links
  booking_manager_emails text not null default '',
  -- calendar invites Digi sends when a person asks it to schedule an event (they confirm first)
  event_invites_enabled  boolean not null default false,
  updated_by             uuid,
  updated_at             timestamptz not null default now()
);
alter table notification_settings enable row level security;
alter table notification_settings force row level security;
create policy tenant_isolation on notification_settings
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
grant select, insert, update, delete on notification_settings to digi_app;

insert into capabilities (id, kind, name, description, risk, permission, owui_tool_id) values
  ('events.invite', 'tool', 'Send a calendar invite', 'Prepares a calendar invite for an event. The person confirms it in the Digi UI; it is then emailed to the attendees.', 'write', 'bookings.create', 'digi_events');
