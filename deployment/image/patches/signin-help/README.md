# Patch: a way back in from the sign-in page, and "Please sign in" when signed out (QA DEF-30)

`digiworks-portal.tar.gz` includes this patch (on top of `chat-delete-confirm`). To reproduce it: extract `/app/.next` from the image **with the earlier patches applied**, run `python3 apply.py <extracted app dir> files` here to regenerate `files/`, then `docker build -t digiworks-portal:release .`.

**Symptom:** /login had no "Forgot password" option, so a locked-out person had no way back in. And `POST /api/rooms/search` with no session answered 403 "Your role cannot request rooms." instead of asking to sign in (as did most other APIs: about 25 routes answer a missing session with their role message).

**Password recovery.** Digi cannot send email (the portal has no mail transport), so a reset link by email is not possible without new infrastructure. Recovery is an Admin's *Reset password* (Settings > Users, which gives a temporary password and forces a new one at the next sign-in), and for a locked-out Admin the server script `deployment/aws/scripts/reset-password.mjs`. The sign-in page now has **Forgot password?** next to the Password label; it shows: "Ask an Admin at <organisation> to reset it under Settings > Users. They will give you a temporary password, and you choose a new one when you sign in. If no Admin can sign in, your IT team can reset it on the server."

**Signed-out API calls.** The request proxy (`src/proxy.ts`) now answers any `/api/*` request without a session cookie with `401 {"error":"Please sign in."}`, before it reaches a route, except sign-in itself (`/api/auth/*`), the key-protected internal API (`/api/internal/*`) and the platform's own APIs (`/api/platform/*`, `/api/release/*`, separate sign-in). A cookie that is present but expired still reaches the route, so the two room routes (`/api/rooms/search`, and `POST /api/bookings` which requests a room) also check: no valid session gives `401 "Please sign in again."`, and only a signed-in person without the permission gets the 403 role message. Other routes with an expired cookie still answer with their own message, as before.

Files: the proxy and the two route chunks are server code, patched in place; the login form's browser chunk is renamed to `2pxazq6kpdrl0-forgot1.js` (the `/login` manifest is updated) and its server-render chunk is patched to match, since the link is in the first render.

**Tested** on a local copy. Signed out: `/api/rooms/search`, `/api/bookings`, `/api/memory` give 401 "Please sign in."; a stale cookie on the two room routes gives 401 "Please sign in again."; a wrong password on `/api/auth/login` still gives "Incorrect email or password."; signed in, room search and conversations work. /login shows Forgot password? and its help text; no console or hydration errors.

**Fix in the portal source** (apply there so the next build keeps it): `proxy.ts`, `login-form.tsx` and `src/app/api/...` here are the fixed files; `signin-help.diff` is the change.
