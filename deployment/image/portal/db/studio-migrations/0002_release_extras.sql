-- ST.6/ST.7: the root-signed entry that revoked a signing key is kept verbatim, so stacks can verify it themselves.
alter table studio_revocations add column entry jsonb;
-- installation requests are logged without any customer data (the stack sends only its id, release, version and runtime capabilities)
create table studio_pull_log (
  id              bigint generated always as identity primary key,
  installation_id text not null,
  what            text not null,
  status          integer not null,
  at              timestamptz not null default now()
);
create index studio_pull_log_recent_idx on studio_pull_log (at desc);
revoke update, delete on studio_pull_log from studio_app;
