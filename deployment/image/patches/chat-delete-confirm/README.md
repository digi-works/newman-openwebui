# Patch: deleting a chat asks first (QA DEF-29)

`digiworks-portal.tar.gz` includes this patch (on top of `bookings-decide-cue`). To reproduce it: extract `/app/.next` from the image **with the earlier patches applied**, run `python3 apply.py <extracted app dir> files` here to regenerate `files/`, then `docker build -t digiworks-portal:release .`.

**Symptom:** on History, the trash control on a chat (aria-label "Delete <title>") sent `DELETE /api/conversations/<id>` on the first click; the chat was gone with no confirmation and no undo.

**Cause:** the button called `deleteChat` directly (`src/components/history-list.tsx`). It is the only place in the app that deletes a chat.

**Fix:** the same pattern as cancelling a booking (WOR-142). The trash button now only asks: the row shows "Delete this chat? This cannot be undone." with **Yes, delete** and **Keep it** (focus moves to Keep it, so Enter backs out). Only Yes, delete deletes. On narrow screens the question text is hidden and the two buttons remain.

Only the browser chunk changes (renamed to `3qaeeclzx3r-g-del1.js` so browsers do not reuse the cached old file; the `/history` manifest is updated). The server renders loading placeholders and the chat rows only appear in the browser, so the server-render chunk is unchanged.

**Tested** on a local copy as Admin with two chats: the trash button shows the question and nothing is deleted (`GET /api/conversations` still lists both); Keep it backs out; trash then Yes, delete removes the chat from the list and from `GET /api/conversations`. No console errors.

**Fix in the portal source** (apply there so the next build keeps it): `history-list.tsx` here is the fixed file; `history-list.diff` is the change.
