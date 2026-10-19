# Patch: the room request form says what is wrong (QA DEF-13)

`digiworks-portal.tar.gz` includes this patch (on top of `booking-cancel-confirm`). To reproduce it: extract `/app/.next` from the image **with the earlier patches applied** (it builds on the form chunk from `booking-stale-results`), run `python3 apply.py <extracted app dir> files` here to regenerate `files/`, then `docker build -t digiworks-portal:release .`.

**Symptom:** on Bookings > Request a room, pressing *Find available rooms* with an empty purpose or a past date showed nothing in the page, only the browser's own bubble, which disappears after a moment. An end time before the start time was not caught at all.

**Cause:** `RoomRequestForm` (`src/components/room-request-form.tsx`) left checking to the browser (`required`, `min`), apart from the purpose.

**Fix:** the form checks itself (`noValidate`, so no browser bubble) when *Find available rooms* is pressed. Each problem is listed in a red box above the button, and the field is outlined in red:
- What is the booking for? empty: "Say what the booking is for."
- Date empty: "Pick a date." Before today: "Pick today or a later date."
- Start or end empty: "Set a start time." / "Set an end time." End not after start: "The end time must be after the start time."
- People empty or outside 1 to 500: "Say how many people, from 1 to 500."

Once shown, the list updates as the person edits, so each line goes as soon as that field is fixed. A search that cannot run also removes earlier results, as before (DEF-12). The button stays enabled, so pressing it always explains what is missing.

Only the browser chunk changes (renamed to `0eamtwqza3ecy-valid1.js` so browsers do not reuse the cached old file; the `/bookings/new` manifest is updated to match). The server-render chunk is unchanged, so the form arrives without a `novalidate` attribute and hydration does not add one; the patched chunk sets `noValidate` from a ref instead. A build from the fixed source renders the attribute directly and needs no ref.

**Tested** on a local copy (real clicks and typing): an empty form shows "Say what the booking is for." with no browser bubble; a past date, an end before the start and 0 people show all three lines with those fields outlined; typing the purpose removes its line at once; fixing the rest clears the box and the search runs ("Sun, Oct 25, 14:00–16:00, 6 people"); emptying the purpose and searching again removes the results. No console errors from the portal.

**Fix in the portal source** (apply there so the next build keeps it): `room-request-form.tsx` here is the fixed file; `room-request-form.diff` is the change against the `booking-stale-results` version.
