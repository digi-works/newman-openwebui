# Patch: the Help button opens a chat with Digi (QA DEF-20)

`digiworks-portal.tar.gz` includes this patch (on top of `home-campus-time`). To reproduce it: extract `/app/.next` from the image **with the earlier patches applied** (this patch rewrites 15 page manifests, five of which earlier patches already changed), run `python3 apply.py <extracted app dir> files` here to regenerate `files/`, then `docker build -t digiworks-portal:release .`.

**Symptom:** clicking Help in the sidebar did nothing: no dialog, no navigation, no network call.

**Cause:** Help was a `SidebarMenuButton` with no action (`src/components/app-sidebar.tsx`); there is no help page or support address to point it at.

**Fix (agreed):** Help starts a new chat with Digi that opens with "What can you help me with in Ask Digi?", the same way the sidebar's New chat starts one, so people get an answer about what Digi and the portal can do. Only the sidebar's browser chunk changes (a click handler does not change the server-rendered HTML); it is renamed to `3i-29vktforvc-help1.js` so browsers do not reuse the cached old file, and all 15 page manifests that list it are updated.

**Tested** on a local copy: a real mouse click on Help created a chat, opened it and sent the question; every main page (home, workers, bookings, new booking, approvals, history, settings, chat) loads the new sidebar together with its own earlier fixes; no console errors.

**Fix in the portal source:** `app-sidebar.tsx` here is the fixed `src/components/app-sidebar.tsx`; `app-sidebar.diff` is the one-line change.
