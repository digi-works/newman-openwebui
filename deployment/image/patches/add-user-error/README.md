# Patch: the Add user error clears once the form is edited (QA DEF-31)

`digiworks-portal.tar.gz` includes this patch (on top of `signin-help`). To reproduce it: extract `/app/.next` from the image **with the earlier patches applied** (it builds on the Users chunk from `reset-password-confirm`), run `python3 apply.py <extracted app dir> files` here to regenerate `files/`, then `docker build -t digiworks-portal:release .`.

**Symptom:** Settings > Users > Add user: after submitting an email that already exists, "A user with that email already exists." stayed on screen while the email was changed or the fields cleared, so it no longer described the current input.

**Cause:** `UsersAdmin` (`src/components/users-admin.tsx`) cleared the error only when the next request started.

**Fix:** editing any field of the Add user form clears the error, and so does opening or closing the form with *Add user*. A new submit still clears it before trying, and a failed one shows its own message.

Only the browser chunk changes (renamed from `181nyvs65jtp2-confirm1.js` to `181nyvs65jtp2-adderr1.js` so browsers do not reuse the cached copy; the `/settings/users` manifest is updated). The form only appears after a click, so the server render is unchanged.

**Tested** on a local copy with QA's steps: an existing email shows "A user with that email already exists."; changing the email removes it at once; submitting the existing email again brings it back; closing the form with Add user removes it.

**Not this patch:** /settings/users already logs a React hydration error (#418, text) on load, with or without this patch (checked on the unpatched image); likely the "Last sign-in" time formatted in the server's time zone and again in the browser's.

**Fix in the portal source** (apply there so the next build keeps it): `users-admin.tsx` here is the fixed file; `users-admin.diff` is the change against the `reset-password-confirm` version.
