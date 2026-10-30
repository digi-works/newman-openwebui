# newman-openwebui

Deployment package for **Ask Digi**, Newman University's AI assistant: the Digi portal (sign-in, roles, chat, room booking, approvals, memory, booking emails and calendar invites), its own Postgres database, and Caddy for HTTPS, run with Docker Compose on one AWS EC2 server.

Digi connects to a **separate, existing Open WebUI** instance for the AI. Open WebUI, Studio and Strands are not part of this package.

```
people ──https──> Caddy ──> Digi portal ──> Postgres (same server)
                              │   ▲
                              ▼   │ tool calls
                         Open WebUI (separate instance) ──> model provider

 Digi portal ──https──> Microsoft 365 (optional: booking emails and calendar invites)
```

The full guide, with every value explained and a troubleshooting table, is [deployment/aws/README.md](deployment/aws/README.md). This page gives the order to follow.

## What is in this repository

| Path | What it is |
|---|---|
| `deployment/image/digiworks-portal.tar.gz` | The Digi portal Docker image (arm64). The server loads it with `docker load`. |
| `deployment/image/portal/` | The portal's source code, which the image is built from. Only needed to change the portal ([Building the portal image](deployment/aws/README.md#building-the-portal-image)). |
| `deployment/aws/docker-compose.yml` | Runs the portal, Postgres and Caddy |
| `deployment/aws/.env.example` | Every setting the server needs; copied to `.env` and filled in |
| `deployment/aws/caddy/Caddyfile` | HTTPS, security headers, and the allow-list for Open WebUI's tool calls |
| `deployment/aws/connect-owui.py` | Connects Digi to Open WebUI: runtime accounts, Digi's tools and the **Digi** model |
| `deployment/aws/owui-tools/` | The Digi tool modules installed in Open WebUI |
| `deployment/aws/scripts/` | Helpers: Supabase import, password reset, tool and model setup |
| `deployment/aws/init/` | Creates the Postgres database and its users on first start |

## New deployment: in this order

Run everything on the server, from `deployment/aws` unless a step says otherwise.

| # | Step | What you do | Details |
|---|---|---|---|
| 0 | **Get what you need** | One EC2 instance (Ubuntu 24.04, t3.medium, 30 GB disk) with an Elastic IP; ports 80 and 443 open, 22 from your IP only; a DNS name pointing at the Elastic IP; the Open WebUI URL, an admin API key, its public IP and a working model | [Section 0](deployment/aws/README.md#0-what-you-need) |
| 1 | **Prepare the server** (once) | Install Docker, Docker Compose, Python 3 and git | [Section 1](deployment/aws/README.md#1-prepare-the-server-once) |
| 2 | **Get the package and load the image** | `git clone`, `docker load -i image/digiworks-portal.tar.gz`, copy `.env.example` to `.env` | [Section 2](deployment/aws/README.md#2-get-the-package-and-load-the-image) |
| 3 | **Fill in `.env`** | Every value, including the Open WebUI ones. Leave only `OWUI_RUNTIME_*` empty. Generate each secret with `openssl rand -base64 32` and keep a copy of `.env` off the server. | [Section 3](deployment/aws/README.md#3-fill-in-env) |
| 4 | **Start Digi and create the first Admin** | `docker compose up -d`, run `bootstrap-tenant.mjs`, read the temporary password, sign in and change it | [Section 4](deployment/aws/README.md#4-start-digi-and-create-the-first-admin) |
| 5 | **Connect Open WebUI** | `python3 connect-owui.py`, then `docker compose up -d` again. Check **Settings > AI connection** shows Open WebUI healthy with 3 accounts. | [Section 5](deployment/aws/README.md#5-connect-to-the-new-open-webui) |
| 6 | **Switch on emails** (optional) | Microsoft 365 admin creates an app registration with Mail.Send; put its values and the sending mailbox in `.env`, `docker compose up -d`; then in **Settings > Notifications** send a test email and switch on room booking emails and calendar invites | [Room booking emails and calendar invites](deployment/aws/README.md#room-booking-emails-and-calendar-invites-optional) |
| 7 | **Import data** (optional) | Copy rooms, events, classes and bookings from Supabase: a dry run first, then the real copy | [Supabase import](deployment/aws/README.md#optional-copy-rooms-events-classes-and-bookings-from-supabase) |
| 8 | **Check it works** | Sign in, open **New chat** and ask "Book me a study room tomorrow at 2pm". The room form should appear. | [Section 5, step 6](deployment/aws/README.md#5-connect-to-the-new-open-webui) |
| 9 | **Set up backups** | Daily `pg_dump` from cron, copied to S3; EBS snapshots | [Section 6](deployment/aws/README.md#6-running-it) and [Before real students use it](deployment/aws/README.md#before-real-students-use-it) |

The commands for steps 1 to 5, in order:

```bash
# 1. prepare the server (then log out and back in)
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 python3 git
sudo usermod -aG docker $USER

# 2. get the package and load the image
git clone https://github.com/digi-works/newman-openwebui.git && cd newman-openwebui/deployment
docker load -i image/digiworks-portal.tar.gz
cd aws && cp .env.example .env && chmod 600 .env

# 3. fill in .env (see the guide), then:

# 4. start Digi and create the first Admin
docker compose up -d
docker compose run --rm portal node db/bootstrap-tenant.mjs
docker compose run --rm portal cat /data/first-admin.txt    # copy the temporary password
docker compose run --rm portal rm /data/first-admin.txt

# 5. connect Open WebUI
python3 connect-owui.py
docker compose up -d
```

## Updating an existing deployment: in this order

Run from `deployment/aws`. `.env` and the data are never touched, and database changes run by themselves when the portal starts.

1. **Get the new version:** `git pull`
2. **Load the new image and restart:** `docker load -i ../image/digiworks-portal.tar.gz`, then `docker compose up -d`. If the update changed `caddy/Caddyfile`, also reload Caddy.
3. **Update Digi's tools in Open WebUI**, only the ones the update lists: `python3 connect-owui.py --update <tool names>`. Do not use `--reset` for an update.
4. **Update Digi's instructions**, if the update lists new lines: paste them in Open WebUI > Workspace > Models > Digi > System prompt.
5. **Check:** sign in, confirm **Settings > AI connection** shows Open WebUI connected, and ask Digi a question in **New chat**.

What each update changes, and the exact tool names and instruction lines, are under [Updating an existing deployment](deployment/aws/README.md#updating-an-existing-deployment) in the guide.

## Day to day

- **Logs:** `docker compose logs -f portal`
- **Users, roles and rooms:** managed in the portal under **Settings**
- **Emails on or off:** **Settings > Notifications** (Staff and Admin)
- **Admin locked out:** [Reset a password from the server](deployment/aws/README.md#reset-a-password-from-the-server)
- **Backups and restore:** [Section 6](deployment/aws/README.md#6-running-it)
