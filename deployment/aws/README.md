# Ask Digi: customer frontend, AWS deployment

What you are deploying: the Digi portal (sign-in, roles, chat, room booking, approvals, memory, booking emails and calendar invites), its own Postgres, and Caddy for HTTPS. **Not included:** Studio, Strands, and Open WebUI itself. Digi connects to an Open WebUI that already exists.

```
people ──https──> Caddy ──> Digi portal ──> Postgres (this server)
                              │   ▲
          signs in as 3 shared│   │ tool calls (key + IP allow-list)
          runtime accounts    ▼   │
                         Open WebUI (separate instance) ──> model provider

 Digi portal ──https──> Microsoft Graph (optional: booking emails and calendar invites, sent from one mailbox)
```

## 0. What you need
- An AWS account, one **EC2** instance: Ubuntu 24.04, 2 vCPU / 4 GB RAM (t3.medium), 30 GB gp3 disk. Attach an **Elastic IP**.
- Security group: inbound **80** and **443** from anywhere, **22** from your admin IP only. Nothing else (Postgres is private inside Docker).
- A DNS name (`DIGI_DOMAIN`) with an **A record to the Elastic IP**. Caddy needs it to get the certificate.
- The Open WebUI instance: its https URL, an **admin API key**, its **public IP**, and at least one model already working in it.
- Open WebUI must be able to reach `https://DIGI_DOMAIN` (it calls Digi's tools there), and this server must be able to reach `OWUI_URL`.
- Optional, for emails: a Microsoft 365 mailbox to send from and an Entra app registration that may send as it (see **Room booking emails and calendar invites**). The server must reach `login.microsoftonline.com` and `graph.microsoft.com` (outbound https, allowed by default).

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
Open `.env` and set every value (comments explain each), including the Open WebUI ones: `OWUI_URL`, `OWUI_ADMIN_TOKEN` (an admin API key from Open WebUI > Settings > Account > API keys), `OWUI_ALLOWED_IP` and `OWUI_BASE_MODEL`. Step 4 will not start without them. Leave only the `OWUI_RUNTIME_*` lines empty; step 5 fills those in. The **Email** values are optional; leave them empty for now if you do not have them (see **Room booking emails and calendar invites**). Generate each secret with `openssl rand -base64 32` (one per line, all different). Keep a copy of **`DIGI_SECRET_KEY`** and the file somewhere safe that is not this server.

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
   It checks the token and the model, creates 3 shared runtime accounts (written into `.env` as `OWUI_RUNTIME_POOL`, with the first one also as `OWUI_RUNTIME_EMAIL`/`OWUI_RUNTIME_PASSWORD`), installs the six Digi tool modules in Open WebUI pointing at `https://DIGI_DOMAIN`, and creates the **Digi** model.
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
| Nobody can sign in (e.g. the only Admin is locked out) | Reset the password from the server: see **Reset a password from the server** under section 6 |

## Room booking emails and calendar invites (optional)
Digi can email people about room bookings and send calendar invites, from one Microsoft 365 mailbox (`MAIL_FROM`). Once the `MS_*` and `MAIL_FROM` values are set, room booking emails are **on** as long as `BOOKING_MANAGER_EMAIL` is set too, and can be switched off with the switch in **Settings > Notifications**; the notification bell in Digi works either way.

**What happens when it is on**
- **New room request:** the room manager inbox gets an email with **Approve** and **Reject** buttons, and the requester gets "request received".
- **Approve / Reject:** each button opens a page in Digi where the manager adds a note and presses **Confirm decision**. Opening the link alone changes nothing (mail scanners open links too). The link works for 14 days and only while the request is still waiting. The decision is saved as the **Digi account with the manager's email address**, so that account must exist and be able to approve room requests (role **Staff** or **Admin**), and the usual rule applies: nobody decides their own request. Managers can still decide on the Bookings page as before.
- **Approved, declined, cancelled by someone else, replaced by a priority request, or expired:** the requester gets an email.
- **Calendar invites (always on once email is set up, no switch):** when someone asks Digi to schedule an event and invite people, Digi shows a confirmation card; after **Confirm**, everyone listed (and the person who asked) gets a real calendar invite with Yes / Maybe / No. Nothing is sent without that Confirm, and the person can stop it there. Replies go to the `MAIL_FROM` mailbox. This does not reserve a room.
- Emails are sent in the background and retried for a few minutes if Microsoft is briefly unavailable; each email goes out once. The last few results (sent or the error) are listed in Settings > Notifications.

**1. Microsoft (once, by your Microsoft 365 admin).** In the Microsoft Entra admin center:
1. Confirm the mailbox that will send exists and has an Exchange Online licence (a shared mailbox also works).
2. **App registrations > New registration**, single tenant, no redirect URI.
3. **API permissions > Add a permission > Microsoft Graph > Application permissions > Mail.Send**, then **Grant admin consent**. Digi needs nothing else (no Mail.Read).
4. **Certificates & secrets > New client secret**. Copy the **Value** at once, and note the expiry date: emails stop when it expires, so put a reminder in a calendar to make a new one before then.
5. Recommended: limit the app to that one mailbox with an Exchange **application access policy** (`New-ApplicationAccessPolicy -AccessRight RestrictAccess`), otherwise Mail.Send lets it send as anyone in the organisation.

**2. The server.** In `.env` set `MS_TENANT_ID`, `MS_CLIENT_ID` (both on the app's Overview page), `MS_CLIENT_SECRET` (the secret's Value), `MAIL_FROM` (the sending mailbox) and `BOOKING_MANAGER_EMAIL` (who receives new requests), then:
```bash
docker compose up -d
```

**3. Digi.** Sign in as an Admin or Staff member and open **Settings > Notifications**:
1. **Send me a test email**: it goes to your own address. If it fails, the message says what Microsoft answered (see the table below).
2. Check the **Room manager email**, and that the **Room booking email notifications** switch is on (green).
3. Make sure each room manager address has a Digi account with the Staff (or Admin) role: Settings > Users.
4. Try it: as a Student account, request a room. The manager should get the email within a few seconds; use **Reject** with a note and check the student gets "declined".

| In Settings > Notifications | Cause / fix |
|---|---|
| "Email is not set up on this server yet" | One of the four `MS_*`/`MAIL_FROM` values is empty in `.env`, or `docker compose up -d` was not run after setting them |
| `invalid_client` / "MS_CLIENT_SECRET is wrong or expired" | Make a new client secret in Entra, put its Value in `.env`, `docker compose up -d` |
| `ErrorAccessDenied` | Mail.Send is missing, admin consent was not granted, or an application access policy does not include `MAIL_FROM` |
| `ErrorInvalidUser` / `MailboxNotEnabledForRESTAPI` | `MAIL_FROM` is not a mailbox in that Microsoft tenant, or it has no Exchange Online licence |
| "No room manager email is set" | Enter one in Settings > Notifications |
| The manager's decision page says the address "needs an active Digi account that can approve" | Create that user in Settings > Users with the Staff role (same email address) |
| Emails arrive in junk | Ask the mail admin to allow `MAIL_FROM` for internal recipients; Microsoft signs them, so this is usually only the first few |

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
- Logs: `docker compose logs -f portal`. Updates: see **Updating an existing deployment** below.
- Backup (daily, from cron): `docker compose exec -T postgres pg_dump -U postgres -Fc digi > digi-$(date +%F).dump`, then copy it off the server (S3). Also keep `.env`. Restore: `pg_restore -U postgres -d digi --clean`.
- Add users: Admin > Users in the portal. Rooms and roles are managed there too.

### Reset a password from the server
For when nobody can reset it in the portal, e.g. the only Admin is locked out (Staff cannot reset an Admin, and there is no forgot-password page). In this folder, keeping the **single quotes** around the password (otherwise the shell changes characters such as `$`):
```bash
docker compose run --rm -v "$PWD/scripts:/import:ro" -e EMAIL=admin@example.edu -e PASSWORD='the new password' portal node /import/reset-password.mjs
```
It prints `... now signs in with the password you set.` It also clears a "locked for 15 minutes" block, signs the account out everywhere and records the reset in the audit log. Leave out `PASSWORD` to set a random temporary one instead, which the person must change at first sign-in: it is written to the portal's data volume, read it with `docker compose run --rm portal sh -c 'cat /data/reset-password.txt && rm /data/reset-password.txt'`.

## Updating an existing deployment
Run from the `deployment/aws` folder. `.env` and the data volumes are never touched; database migrations run by themselves when the portal starts.

1. Get the new version:
   ```bash
   git pull
   ```
2. Load the new portal image and restart with it (this also applies any change to `docker-compose.yml`):
   ```bash
   docker load -i ../image/digiworks-portal.tar.gz
   docker compose up -d
   ```
   If the update changed `caddy/Caddyfile` (listed under **This update**), reload Caddy too; `up -d` does not notice a changed Caddyfile:
   ```bash
   docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
   ```
3. If the update changed Digi's tool modules (listed under **This update** below), update just those in Open WebUI. Their name, access and settings there are kept:
   ```bash
   python3 connect-owui.py --update digi_rooms,digi_bookings
   ```
   Do not use `--reset` for an update: it overwrites Digi and all its tools with this repo's versions, undoing anything changed in Open WebUI.
4. If the update changed Digi's instructions (listed under **This update**), add the new lines by hand in Open WebUI > Workspace > Models > Digi > System prompt. `connect-owui.py` never changes the prompt of an existing Digi.
5. Check: sign in, open **Settings > AI connection** (Open WebUI should show as connected), and ask Digi a question in **New chat**.

### This update: Admins approve their own requests, security headers
- Portal image: Admins can approve or decline their own room requests; other roles can once an Admin turns on **Approve own requests** for them in Settings > Permissions (migration `0017_approve_own_bookings.sql` runs by itself at start). The portal now sends `Strict-Transport-Security` and `Content-Security-Policy` itself (QA DEF-06) and no longer sends `X-Powered-By: Next.js` (QA DEF-08). It also answers `/robots.txt` itself in plain text (`User-agent: *` / `Disallow: /`) and `/sitemap.xml` with a plain 404, instead of the 12 KB HTML 404 page, the same answers as the Caddyfile (QA DEF-09).
- `Caddyfile`: drops Caddy's `Via: 1.1 Caddy` header and any `Server` header (QA DEF-08). It has moved to `caddy/Caddyfile`, and `docker-compose.yml` now mounts the `caddy` folder instead of the single file. With the old file mount, Caddy kept reading the Caddyfile from before `git pull` (git replaces the file, the mount stays on the old one), so a reload changed nothing and none of the earlier Caddyfile fixes (`/robots.txt`, `/sitemap.xml`, JSON API errors, 421, 501) reached the server. Step 2's `docker compose up -d` recreates Caddy with the new mount, so this time no separate reload is needed, and later reloads work. Check:
  ```bash
  curl -sI https://your.domain/login | grep -iE 'strict-transport|content-security|via|powered'
  ```
  Expected: the first two lines only. Also `curl -s https://your.domain/robots.txt` answers `User-agent: *` / `Disallow: /` in plain text.
- Tool modules: `digi_bookings` (`list_bookings` now says who requested each booking, so Digi can answer "who requested BK-…", QA DEF-61). Run step 3 with `--update digi_bookings`.

### Earlier update: Digi can answer questions about campus events
- Portal image: a new read-only tool, `events.search`, looks up the events imported into Digi by date or name (campus time; classes only when asked). Anyone who can use Digi may use it, Faculty and Students included. Faculty booking access is unchanged: they request, view, change and cancel their own bookings, and cannot see other people's or approve. One small database migration (`0016_events_search.sql`) runs by itself at start.
- Tool modules: `digi_events` (new `search_events`). Run step 3 with `--update digi_events`.
- Digi's instructions: add this section above "Calendar invites" (step 4):
  > Campus events (you have a tool for this)
  > - When someone asks what is happening on campus, about an event, or about a game day, call search_events with the dates and any name words they gave, and answer only from what it returns.
  > - If it finds nothing, say Digi has no events listed for those dates and suggest Student Life (events) or Athletics (games).
- Answers come only from the imported events; if the Supabase import has not been run, Digi says none are listed.

### Earlier update: same room form everywhere, booking email fixes
- Portal image:
  - The **Request a room** page (Bookings > + Request a room) now has the same form as the one Digi shows in chat.
  - **Settings > Notifications** has a sliding on/off switch for room booking emails, and no Calendar invites option: invites are sent whenever email is set up, after the person confirms them in chat.
  - Room booking emails now start **on** when email and `BOOKING_MANAGER_EMAIL` are set, unless someone already switched them off. Before, they started off, so requests and approvals were not emailed until someone found the switch.
  - Approve / Reject links in manager emails are checked strictly.
  - **Stop** in chat ends the answer on the server too, and only what was shown is saved, so a reload or History no longer reveals an answer that was stopped (QA DEF-50).
  - **History** says when your conversations could not be loaded and offers Try again, instead of showing "No conversations yet" (QA DEF-52).
  - If Digi tells someone to press Confirm but no confirmation card was prepared, the answer now says so and how to get the card, instead of leaving them looking for it.
  - Conversations with a worker that no longer exists show as **Retired worker · read only** in History (not "Agent"), and open read only instead of a dead end (QA DEF-07).
  - **Settings > Users** shows "Temporary password" as its own badge next to Active / Disabled, instead of loose text that wrapped around the badge.
  - **Settings > Users** can delete an account (trash button, asks first; needs the Disable users permission, and only an Admin can delete an Admin). Their conversations and memories go with it; room bookings and the audit trail stay, without the link to the person (QA DEF-33).
  - **Copy** on an answer copies the text as shown (no `**` markdown; pastes into email or documents with the formatting) and says "Copied" (QA DEF-38).
  - **Change password** flags "The new passwords do not match" while typing (the browser will not submit it), and the hint says plainly not to include the first part of your email address (QA DEF-40).
  - Screen readers: after a rejected sign-in the Email and Password fields are marked invalid and point at the error, and the Add user field an error is about is marked the same way (QA DEF-43).
  - Unknown `/api/...` paths (including `/API/...`) answer `404 {"error":"No such API endpoint.","code":"no_such_endpoint"}` from the portal itself, not the HTML 404 page, as Caddy already did (QA DEF-44).
  - A method an API route does not take answers `405` in JSON with an `Allow` header, `OPTIONS` answers `204` with `Allow` even when signed out, and a method the portal never implements answers `501` in JSON (QA DEF-45).
  - Times on Settings > Users, Approvals, Bookings, Notifications and AI updates are shown in campus time (Central), the same on the server and in the browser, which removes the React hydration error on a full load of Settings > Users (QA DEF-51).
  - A room search for a time that has already passed says "That time has already passed" (in chat and on the Request a room page) instead of listing free rooms the request step would then refuse (QA DEF-53).
  - **Settings > AI**: "Switch to Strands" (or back) is disabled while that runtime cannot be reached or cannot run what is installed, with a line saying what has to happen first (QA DEF-55).
  - Every `/api/*` answer carries `Cache-Control: no-store`, like the pages, so data is never kept by a browser or proxy cache (QA DEF-56).
  - The notification bell says "1 unread notification" (not "notifications"), its rows are menu items that arrow keys move between, and choosing one closes the panel (QA DEF-57).
  - **Settings > Memory** shows when each note was added ("Added Oct 16, 2026, 11:38 AM", campus time) (QA DEF-58).
  - Copy: the AI updates page links to the Permissions page instead of naming a module that only exists once a capability is installed; the "Tool connections" permission says plainly that there is no screen for it (tool servers are set up through the admin API); the home page reads "Ask Digi, your Digital Institutional Gateway for Information, about events…" (QA DEF-59).
  - **Approvals** lists every waiting room request (room, time, size, purpose, who asked, reference) with Approve / Decline, the same decision as on Bookings; your own requests are listed but another approver has to decide them.
  - One small database migration (`0015_permission_copy.sql`, rewords one permission's description) runs by itself at start.
- Tool modules: `digi_rooms` (the chat room form starts at today, 2 to 3 pm, 6 people, like the page; Digi looks up one room by name, so "the capacity of St. John's Chapel" or "Performance Hall" is answered instead of "not listed", and a room list covers every room and says when it shows only part of them, QA DEF-49) and `digi_bookings` (request_room says the card only exists once it is called). Run step 3 with `--update digi_rooms,digi_bookings`.
- `Caddyfile`: TRACE, PURGE and other methods the portal never implements answer `501` in JSON under `/api/*` (the portal's server would give a 500 or an empty 400); the old 405 rewrite is gone because the portal now sends its own 405 with `Allow` (QA DEF-45). A request whose Host header is not this site is refused with `421 Misdirected Request` instead of an empty 200 (`strict_sni_host`, QA DEF-46). `/api/*` answers get `Cache-Control: no-store` when they have none (QA DEF-56). Check and reload it:
  ```bash
  docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
  ```
- Digi's instructions: add this line under "Honesty rules" (step 4):
  > - A confirmation card exists only when request_room, cancel_booking or another tool that prepares an action was called in this reply. Never say a card is shown, or tell someone to press Confirm, without calling that tool in this reply. If they ask where the card is, or it is not showing, call the tool again with the same details.

### Earlier update: room booking emails and calendar invites
- Portal image: **Settings > Notifications** (switch room booking emails and calendar invites on or off, room manager inbox, test email, recent email results); room manager emails with Approve / Reject; requester emails for every change; calendar invites from Digi. One database migration (`0014_booking_emails.sql`) runs by itself at start. Nothing is emailed until someone switches it on.
- The portal is now built from source kept in this repo (`deployment/image/portal`, see **Building the portal image**); all the earlier QA fixes are part of it. The image runs exactly as before.
- `docker-compose.yml` and `.env.example`: new optional **Email** values (`MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MAIL_FROM`, `BOOKING_MANAGER_EMAIL`). Copy that block from `.env.example` into your `.env` and fill it in when you have the Microsoft values; then follow **Room booking emails and calendar invites**.
- Tool modules: new `digi_events` (calendar invites). Run step 3 with `--update digi_events`; it is created and added to Digi.
- Digi's instructions: add this section above "Honesty rules" (step 4):
  > Calendar invites (you have a tool for this)
  > - When someone asks you to schedule an event or meeting and invite people, call send_calendar_invite with the title, date, start and end time, and the attendees' email addresses. Ask for anything missing; never guess an email address.
  > - This only prepares the invite: Digi shows a confirmation card and it is sent when they press Confirm. Never say it is sent. It does not reserve a room; if they need one, help them request it first.

### Earlier update (QA fixes): only if your server does not have it yet
- Portal image: QA fixes (room request form no longer books an older search's date, Approvals page points to room requests waiting on Bookings, Settings > AI connection loads at once, booking references shown in the Bookings table, home page date and greeting in campus time, Help opens a chat with Digi, Reset password in Settings > Users asks first and is not offered on your own account, cancelling a booking asks first, the room request form says what is wrong with it instead of only the browser's bubble, a room search that had to give up the building and the equipment names both, Settings > AI updates explains the Release address instead of showing releases.example.com, waiting requests on Bookings show "Approve or decline" to people who can decide them, deleting a chat on History asks first, the sign-in page has Forgot password? and signed-out API calls get 401 "Please sign in.", the Add user error clears once the form is edited), and tables in chat replies.
- `docker-compose.yml`: Strands' health check now fails at once (Strands is not part of this package).
- `Caddyfile`: adds the Strict-Transport-Security and Content-Security-Policy headers, and answers /robots.txt with a short plain-text file (crawlers stay out) and /sitemap.xml with a plain 404 instead of the HTML error page, and answers unknown `/api/*` paths with a JSON 404 (`"code":"no_such_endpoint"`) and a wrong method with a JSON 405 (`"code":"method_not_allowed"`). Reload Caddy (step 2).
- Tool modules: `digi_rooms` (new `check_room_availability`, so Digi checks a named room before saying it is free) and `digi_bookings` (Digi calls a waiting request "Waiting", as the Bookings page does, not "Tentative"). Run step 3 with `--update digi_rooms,digi_bookings`.
- Digi's instructions: add this line under "Room requests" (step 4):
  > - When someone asks whether a specific room is free, call check_room_availability with the room, date, start and end time (ask for the end time if they did not give one). Never say a specific room is free or taken without it, and repeat its answer as it is.

## Building the portal image
`../image/digiworks-portal.tar.gz` is built from `../image/portal` (the portal's source, Next.js). You only need this to change the portal; deploying uses the tarball. On a machine with Docker (the image is **arm64**, like the EC2 instance it runs on; build on an arm64 machine such as an Apple Silicon Mac or a Graviton instance):
```bash
cd deployment/image/portal
docker build -t digiworks-portal:release .
docker save digiworks-portal:release | gzip > ../digiworks-portal.tar.gz
```
The folders under `../image/patches` are the earlier fixes that were applied to the built image before the source was in the repo; they are all part of `portal` now and are kept only as a record.

## Before real students use it
Enable snapshots of the EBS volume, put the daily dump in S3, and ask for Studio/MFA when you want operator access; none of that is in this package.
