-- Which AI runtime this stack runs on (decided per stack by its Admin; Open WebUI stays the default until Strands has passed the same tests),
-- and the runtime-neutral definition an installed Worker was compiled to for runtimes that do not keep agents of their own.
alter table stack_identity add column runtime text not null default 'owui' check (runtime in ('owui', 'strands'));
alter table stack_identity add column runtime_changed_at timestamptz;
alter table installed_workers add column runtime_def jsonb;
