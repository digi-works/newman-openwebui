# Ask Digi: customer frontend, AWS deployment

What you are deploying: the Digi portal (sign-in, roles, chat, room booking, approvals, memory), its own Postgres, and Caddy for HTTPS. **Not included:** Studio, Strands, and Open WebUI itself. Digi connects to an Open WebUI that already exists.

```
people ──https──> Caddy ──> Digi portal ──> Postgres (this server)
                              │   ▲
          signs in as 3 shared│   │ tool calls (key + IP allow-list)
          runtime accounts    ▼   │
                         Open WebUI (separate instance) ──> model provider
```

## 0. What you need
- An AWS account, one **EC2** instance: Ubuntu 24.04, 2 vCPU / 4 GB RAM (t3.medium), 30 GB gp3 disk. Attach an **Elastic IP**.
- Security group: inbound **80** and **443** from anywhere, **22** from your admin IP only. Nothing else (Postgres is private inside Docker).
- A DNS name (`DIGI_DOMAIN`) with an **A record to the Elastic IP**. Caddy needs it to get the certificate.
- The Open WebUI instance: its https URL, an **admin API key**, its **public IP**, and at least one model already working in it.
- Open WebUI must be able to reach `https://DIGI_DOMAIN` (it calls Digi's tools there), and this server must be able to reach `OWUI_URL`.

## 1. Prepare the server (once)
```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 python3 git
sudo usermod -aG docker $USER      # log out and back in
```

## 2. Get the package and load the image
On the server (the repository is private: sign in with a GitHub account that has access, using a personal access token as the password):
```bash
git clone https://github.com/digi-works/newman-openwebui.git && cd newman-openwebui/deployment
docker load -i image/digiworks-portal.tar.gz        # prints: Loaded image: digiworks-portal:release
cd aws && cp .env.example .env && chmod 600 .env
```
(Using ECR instead: push the image, set `PORTAL_IMAGE` in `.env` to its URI and `aws ecr get-login-password | docker login ...`; skip `docker load`.)

## 3. Fill in `.env`
Open `.env` and set every value (comments explain each), including the Open WebUI ones: `OWUI_URL`, `OWUI_ADMIN_TOKEN` (an admin API key from Open WebUI > Settings > Account > API keys), `OWUI_ALLOWED_IP` and `OWUI_BASE_MODEL`. Step 4 will not start without them. Leave only the `OWUI_RUNTIME_*` lines empty; step 5 fills those in. Generate each secret with `openssl rand -base64 32` (one per line, all different). Keep a copy of **`DIGI_SECRET_KEY`** and the file somewhere safe that is not this server.

## 4. Start Digi and create the first Admin
```bash
docker compose up -d
docker compose run --rm portal node db/bootstrap-tenant.mjs
docker compose run --rm portal cat /data/first-admin.txt    # temporary password: copy it, then:
docker compose run --rm portal rm /data/first-admin.txt
```
Wait about a minute, then open `https://DIGI_DOMAIN` and sign in with `ADMIN_EMAIL` and that password (you must change it). The page loads now; chat will say the AI is not connected until step 5.

## 5. Connect to the new Open WebUI
1. Check the Open WebUI values you set in step 3: `OWUI_ADMIN_TOKEN`, `OWUI_URL`, `OWUI_ALLOWED_IP` (Open WebUI's public IP) and `OWUI_BASE_MODEL` (an id from its model list).
2. Make sure Open WebUI has a working model connection of its own (or save the provider key in Digi under Settings > AI connection, step 5).
3. Run, in this folder:
   ```bash
   python3 connect-owui.py
   ```
   It checks the token and the model, creates 3 shared runtime accounts (written into `.env` as `OWUI_RUNTIME_POOL`, with the first one also as `OWUI_RUNTIME_EMAIL`/`OWUI_RUNTIME_PASSWORD`), installs the five Digi tool modules in Open WebUI pointing at `https://DIGI_DOMAIN`, and creates the **Digi** model.
   Safe to re-run: Digi, its tools and their settings are left as they are in Open WebUI, so changes made there are kept (only the tools' portal address and key are corrected). To overwrite them with the versions in this repo, run `python3 connect-owui.py --reset`. For a normal update you do not need this step at all.
4. Apply it and reload Caddy's allow-list:
   ```bash
   docker compose up -d
   ```
5. In Digi: **Settings > AI connection**. Check Open WebUI shows healthy with 3 accounts; save the customer's AI key there if the provider needs one.
6. Test: sign in, open **New chat**, ask "Book me a study room tomorrow at 2pm". You should get the room form.

If something fails:
| Symptom | Cause / fix |
|---|---|
| `connect-owui.py`: "token rejected" | Use an admin's API key; check `OWUI_URL` has no `/api` suffix |
| "model ... is not in that Open WebUI" | Set `OWUI_BASE_MODEL` to an id it prints |
| Chat answers but never calls tools | Open WebUI cannot reach `https://DIGI_DOMAIN/api/internal/...`: check DNS/firewall and that `OWUI_ALLOWED_IP` is the IP Open WebUI calls *from* (`docker compose logs caddy` shows 403s) |
| "AI connection" unhealthy | Server cannot reach `OWUI_URL`, or an account was deleted: re-run `connect-owui.py` |
| Digi needs a newer version of a tool module from this repo (e.g. after `git pull`) | `python3 connect-owui.py --update digi_rooms` replaces just that module's code and keeps its name, access and settings in Open WebUI. Add Digi's matching prompt lines from `scripts/create-digi.py` in Open WebUI by hand |
| Nobody can sign in to reset a password (e.g. the only Admin is locked out) | Reset it from the server, keeping the single quotes: `docker compose run --rm -v "$PWD/scripts:/import:ro" -e EMAIL=admin@example.edu -e PASSWORD='new password' portal node /import/reset-password.mjs`. Leave out `PASSWORD` to get a random temporary one instead (see the script's header). It also clears a sign-in lockout and signs the account out everywhere |

## Optional: copy rooms, events, classes and bookings from Supabase
Copies buildings, rooms, events, the class schedule (courses become events so rooms show as busy during classes) and room bookings from the Supabase pilot database (schema `newmann`) into Digi. Supabase is only read. Safe to re-run: rows already copied are skipped. Run it in this folder after step 4, using the Supabase **Session pooler** connection string (Supabase > Connect > Session pooler; the direct connection is IPv6 only and most AWS servers cannot reach it):
```bash
# 1. dry run: prints what it would copy and every row it would skip, writes nothing
docker compose run --rm -v "$PWD/scripts:/import:ro" -e SUPABASE_DB_URL='postgresql://...' portal node /import/import-supabase.mjs --dry-run
# 2. if the report looks right, the real copy (all or nothing)
docker compose run --rm -v "$PWD/scripts:/import:ro" -e SUPABASE_DB_URL='postgresql://...' portal node /import/import-supabase.mjs
```
Skipped rows are listed with the reason: a room whose building is missing, an occurrence without times, an archived event, or a booking that overlaps one already holding that room (approved bookings are copied first, so they win). Booking times are read as the university's local time.

## 6. Running it
- Logs: `docker compose logs -f portal`. Update: load the new image, `docker compose up -d portal` (migrations run at start).
- Backup (daily, from cron): `docker compose exec -T postgres pg_dump -U postgres -Fc digi > digi-$(date +%F).dump`, then copy it off the server (S3). Also keep `.env`. Restore: `pg_restore -U postgres -d digi --clean`.
- Add users: Admin > Users in the portal. Rooms and roles are managed there too.

## Updating later
Copy the new zip, `docker load` its image, then `docker compose up -d portal` from the `aws` folder. Migrations run automatically at start; `.env` and the data volumes are untouched.

## Before real students use it
Enable snapshots of the EBS volume, put the daily dump in S3, and ask for Studio/MFA when you want operator access; none of that is in this package.
