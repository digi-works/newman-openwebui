# Backup and restore runbook (M6.4)

Status: rehearsed on the pilot machine (7 Oct 2026). Real hosting is still to come; until then the laptop plus tunnel is a pilot only
(no live term, no real student data).

## What is backed up
Digi's Postgres database `digi` (people, roles, conversations, bookings, memory, jobs, audit, encrypted secrets). Open WebUI keeps its own
data in its own stack and holds no Digi history, so Digi's database is what matters.

**Not in the dump, store separately and safely:** `DIGI_SECRET_KEY` (without it saved secrets such as the AI key cannot be read after a
restore; the admin would re-enter them), `PORTAL_INTERNAL_KEY`, and the `.env` passwords.

## Take a backup
```
python scripts/backup-digi.py            # writes backups/digi-YYYYMMDD-HHMMSS.dump and a .sha256, keeps the newest 14
```
Run it at least daily and copy the `backups/` folder off the machine (a backup on the same disk is not a backup). The files contain
personal data: keep them private and encrypted at rest wherever they are copied.

## Rehearse a restore (do this after any schema change and every month)
```
python scripts/restore-rehearsal.py      # restores the newest backup into a scratch database, checks it, drops it
```
It checks: checksum, restore without errors, every table present, row counts, all migrations recorded, row-level security still forced on
the same tables, the app role still sees nothing without a tenant and only its own tenant with one, secrets still encrypted.

Measured on 7 Oct 2026: 9/9 checks, restore in 2.9 s for a 221 KB dump (12 MB database). Expect minutes, not seconds, at real size:
re-measure when the data grows. Recovery targets proposed for the pilot: RPO 24 hours (daily backup), RTO 1 hour.

## Restore for real (disaster)
1. New host: start Postgres and run `db/init` so the roles `digi_owner` and `digi_app` exist (the dump keeps ownership and grants).
2. `createdb digi`, then `pg_restore -U postgres -d digi backups/<file>.dump`.
3. Put the saved `.env` (including `DIGI_SECRET_KEY`) in place, start the portal. Migrations are recorded, so it reports "up to date".
4. Sign in as an Admin, open Settings > AI connection and press Test; re-install the Open WebUI tools with `python scripts/install-digi-tools.py`.

## Rehearsal found (and fixed)
The first rehearsal failed: the dump had been made with `--no-owner`, so the restore could not recreate the `btree_gist` extension and
tables lost their owner. The dump now keeps ownership and the restore runs as the superuser.

## Still to do before real data
Automatic daily schedule on the real host, off-machine copy, monitoring that alerts when a backup is missing, and a second rehearsal on the
real host. Scheduling on this laptop was not done: it changes the machine's own settings.
