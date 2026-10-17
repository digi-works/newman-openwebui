# Patch: Reset password asks first and never locks you out (QA DEF-27)

`digiworks-portal.tar.gz` includes this patch (on top of `help-asks-digi`). To reproduce it: extract `/app/.next` from the image **with the earlier patches applied** (the Users page manifest was already changed by `help-asks-digi`), run `python3 apply.py <extracted app dir> files` here to regenerate `files/`, then `docker build -t digiworks-portal:release .`.

**Symptom:** during QA, one click on *Reset password* in Settings > Users replaced the Administrator's password at once: no confirmation, offered even on the signed-in Admin's own row, and the new password was shown only once. It was lost, which locked the only Admin out (recovered with `deployment/aws/scripts/reset-password.mjs`).

**Fix:**
- *Reset password* asks first: the row shows "Reset the password for <name>? They will be signed out." with **Yes, reset** and **Cancel**. Built into the page, not a browser pop-up.
- It is not offered on your own row (as *Disable* already was not). Your own password is changed under Settings > Account.
- The server refuses a reset of your own account too ("Change your own password under Settings > Account.", 400), so the button is not the only guard.
- Unchanged: the temporary password is still shown once, naming the account it belongs to, and each reset is recorded in the audit log.

Patched: the Users screen's browser chunk (renamed to `181nyvs65jtp2-confirm1.js` so browsers do not reuse the cached old file; the manifest is updated) and its server-render chunk, which must match; and both server copies of `updateUser`.

**Tested** on a local copy: no Reset button on your own row; on another user it asks first, Cancel changes nothing, Yes resets and shows the temporary password for that account, and the audit log records it (source `portal`); a direct API call to reset your own account returns 400 and your password keeps working.

**Fix in the portal source:** `src/users-admin.tsx` and `src/admin-users.ts` are the fixed `src/components/users-admin.tsx` and `src/lib/admin-users.ts`; `src/reset-password.diff` is the change.

Not part of this fix: the Users page's *Last sign-in* column is formatted in the server's zone and then the browser's, so React reports a hydration mismatch (#418) when they differ. Same kind of issue as DEF-19; it was there before this patch.
