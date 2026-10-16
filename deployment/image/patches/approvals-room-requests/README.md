# Patch: Approvals page points to waiting room requests (QA DEF-02)

`digiworks-portal.tar.gz` includes this patch (on top of `booking-stale-results`). To reproduce it: extract `/app` from the image before this patch, run `python3 apply.py <extracted app dir> files` here to regenerate `files/`, then `docker build -t digiworks-portal:release .`.

**Symptom:** with 9 to 12 room requests waiting, Bookings showed "Awaiting approval 12" and the bell said "12 booking requests are waiting for a decision", while the Approvals page said "Nothing is waiting for a decision."

**Cause:** not wrong data. The two pages hold different things. Room requests are approved or declined on Bookings (the bell links there). The Approvals page lists actions that need a second person's OK before they run, such as Digi's request to take a room from another waiting request. None of those existed, so its empty message read as "nothing to decide" to someone looking for room requests.

**Fix:**
- When room requests are waiting and the person may approve them, the Approvals page shows a box at the top: "12 room requests are waiting for a decision. Room requests are approved or declined on the Bookings page, not here." with a *Review room requests* link to Bookings. The count is the bell's (`pendingCount`).
- The page's empty message says what the page holds: "No actions are waiting for a second person's approval."

Patched files: the Approvals page's server code (`[root-of-the-server]__1nkfd9z._.js`), and the Approvals view in the browser chunk (renamed to `167s8qzpp8cyo-rooms1.js` so browsers do not reuse the cached old file; the page manifest is updated) and the server-render chunk (`_1lsy4ma._.js`), which must match.

**Tested** on a local copy: with 3 waiting requests the box says 3 and its link opens Bookings showing "Awaiting approval 3"; with none waiting the box is gone and the new empty message shows. No console errors.

**Fix in the portal source** (apply there so the next build keeps it): `src/approvals-page.tsx` is the fixed `src/app/(app)/approvals/page.tsx`, `src/approvals-view.tsx` the fixed `src/components/approvals-view.tsx`; `src/approvals.diff` is the change.
