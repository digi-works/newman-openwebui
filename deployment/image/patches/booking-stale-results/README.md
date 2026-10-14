# Patch: room requests never use an older search (QA DEF-11, DEF-12)

`digiworks-portal.tar.gz` includes this patch (on top of `chat-markdown`). To reproduce it: extract `/app` from the image before this patch, run `python3 apply.py <extracted app dir> files` here to regenerate `files/`, then `docker build -t digiworks-portal:release .`.

**Symptom:** on Bookings > Request a room, search Oct 24, change the date to Oct 25 without searching again, and press *Request this room*: the request is made for Oct 24 while the form shows Oct 25 (QA: BK-TLR9D). The same happened after a search the browser blocked, e.g. a past date: the earlier results stayed on screen and still booked their own date (QA: BK-H9ZE7).

**Cause:** `RoomRequestForm` (`src/components/room-request-form.tsx`) keeps the results together with the values they were searched for, and *Request this room* sends those saved values. Nothing removed the results when the form changed, and a blocked search never reaches the code (the browser stops it first), so the results stayed clickable.

**Fix:** any change to the form (a field, or a "needs" chip), or a search the browser blocks as invalid, removes the results and shows "You changed the search. Press Find available rooms again to see what is free." The results heading now also states what they are for, e.g. "Available rooms · Sat, Oct 24, 10:00–11:00, 5 people". The request still sends the values of the search it came from, which now always match the form.

Only the browser chunk changes (renamed to `0eamtwqza3ecy-stale1.js` so browsers do not reuse the cached old file; the `/bookings/new` manifest is updated to match). The server render shows the form with no results, which this patch does not alter, so its chunk is unchanged.

**Tested** on a local copy with QA's steps: the date change removes the Oct 24 results, a new search books Oct 25 (stored 10:00–11:00 Central), a past-date search leaves no room to click, and toggling a chip clears results. No console errors.

**Fix in the portal source** (apply there so the next build keeps it): `room-request-form.tsx` here is the fixed file; `room-request-form.diff` is the change against the version in the image.
