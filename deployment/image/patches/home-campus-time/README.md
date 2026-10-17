# Patch: home page date and greeting in campus time (QA DEF-19)

`digiworks-portal.tar.gz` includes this patch (on top of `bookings-reference`). To reproduce it: extract `/app` from the image before this patch, run `python3 apply.py <extracted app dir> files` here to regenerate `files/`, then `docker build -t digiworks-portal:release .`.

**Symptom:** at 20:15 Central, the home page first showed "Wednesday, October 14 · Good morning" (server, UTC), then changed to "Tuesday, October 13 · Good evening" (the browser's zone). People saw the wrong day and greeting first.

**Cause:** `HomeLanding` (`src/components/home-landing.tsx`) took the hour and date from whatever machine it ran on: the server renders in UTC (Docker), the browser redraws in its own zone, so they disagree for part of every day.

**Fix:** both the hour and the date use America/Chicago (campus time, the zone the room request form already uses for "today"), so the server and the browser always render the same text, and it is the campus day. Patched in the home page's browser chunk (renamed to `24_12p3phqwvo-tz1.js` so browsers do not reuse the cached old file; the manifest is updated) and its server-render chunk.

**Tested** on a local copy at 05:00 Central with the browser on India time (15:00): the server HTML and the page after loading both read "Saturday, October 17 · Good morning" (before the fix the browser would have switched it to "Good afternoon"); no hydration errors.

**Fix in the portal source:** `home-landing.tsx` here is the fixed `src/components/home-landing.tsx`; `home-landing.diff` is the change.
