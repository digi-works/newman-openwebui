# Patch: cancelling a booking asks first (Jira WOR-142)

`digiworks-portal.tar.gz` includes this patch (on top of `reset-password-confirm`). To reproduce it: extract `/app/.next` from the image **with the earlier patches applied** (it builds on the bookings chunk from `bookings-reference`), run `python3 apply.py <extracted app dir> files` here to regenerate `files/`, then `docker build -t digiworks-portal:release .`.

**Symptom (reported by Maaz, 18 Oct):** in a booking's details panel, *Cancel booking* (a confirmed booking, by its requester or an approver) and *Cancel request* (a waiting request) cancelled on the first click, with no warning.

**Fix:** the first click asks "Cancel this booking? This cannot be undone." (or "...request?"), with **Yes, cancel booking** / **Yes, cancel request** and **Keep it**. Only "Yes" cancels. An approver cancelling someone else's booking still has to give a reason first.

Only the bookings view's browser chunk changes (the panel renders after a click, so the server-rendered page is unchanged): `45b5nwileyx2a-ref1.js` is renamed to `45b5nwileyx2a-cancel1.js` so browsers do not reuse the cached copy, and the `/bookings` manifest is updated.

**Tested** on a local copy: Cancel request asks first, Keep it backs out, Yes cancels; Cancel booking without a reason still asks for one, then asks to confirm, then cancels and stores the reason. No console errors.

**Fix in the portal source:** `booking-dialog.tsx` here is the fixed `src/components/booking-dialog.tsx`; `booking-dialog.diff` is the change.
