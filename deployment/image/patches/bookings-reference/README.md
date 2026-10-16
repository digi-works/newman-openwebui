# Patch: booking reference in the bookings table (QA DEF-15)

`digiworks-portal.tar.gz` includes this patch (on top of `ai-settings-fast`). To reproduce it: extract `/app` from the image before this patch, run `python3 apply.py <extracted app dir> files` here to regenerate `files/`, then `docker build -t digiworks-portal:release .`.

**Symptom:** after making a request a person is given a reference (e.g. BK-6TPEY), but the Bookings table showed room, requester, date and time, purpose and status, not the reference. It appeared only after opening a row, so nobody holding a reference could find their row in a queue of 28.

**Fix:** the reference is shown in small text under the room name in every row (no new column, so the table keeps its layout), and can be found with Cmd/Ctrl+F. Patched in the bookings view's browser chunk (renamed to `45b5nwileyx2a-ref1.js` so browsers do not reuse the cached old file; the `/bookings` manifest is updated) and its server-render chunk, which must match.

**Tested** on a local copy: both rows show their reference (BK-TLR9D, BK-6TPEY), clicking a row still opens its details, no console errors.

**Fix in the portal source:** `bookings-view.tsx` here is the fixed `src/components/bookings-view.tsx`; `bookings-view.diff` is the one-line change.
