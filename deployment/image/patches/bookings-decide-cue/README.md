# Patch: the Bookings table shows which requests need a decision (QA DEF-24)

`digiworks-portal.tar.gz` includes this patch (on top of `release-address-hint`). To reproduce it: extract `/app/.next` from the image **with the earlier patches applied** (it builds on the bookings chunk from `booking-cancel-confirm`), run `python3 apply.py <extracted app dir> files` here to regenerate `files/`, then `docker build -t digiworks-portal:release .`.

**Symptom:** as Staff (or anyone who can decide room requests), /bookings listed waiting requests with no sign that action was possible; Approve and Decline only appeared after opening a row.

**Fix** (only for people who can decide, i.e. the same `canDecide` that shows Approve/Decline in the panel):
- every waiting request shows a small **Approve or decline** label next to its *Waiting* status; the whole row still opens the panel where the decision is made;
- the row is announced to screen readers as "Open booking for <room>, waiting for your decision";
- the *Awaiting approval* queue says "Requests waiting for a decision. Open one to approve or decline it."

People who cannot decide (and the "My bookings" view) see the table as before.

`bookings-view.tsx`'s browser chunk is renamed from `45b5nwileyx2a-cancel1.js` to `45b5nwileyx2a-decide1.js` so browsers do not reuse the cached copy (the `/bookings` manifest is updated), and its server-render chunk is patched to match.

**Tested** on a local copy as Admin with one waiting and one confirmed booking: only the waiting row shows the label and the longer row label; the Awaiting approval queue shows the new line; clicking the label opens the panel with Decline and Approve request. No console errors. Not tested with an account that cannot decide (the label uses the same permission flag as the panel's buttons).

**Fix in the portal source** (apply there so the next build keeps it): `bookings-view.tsx` here is the fixed file; `bookings-view.diff` is the change against the `bookings-reference` version.
