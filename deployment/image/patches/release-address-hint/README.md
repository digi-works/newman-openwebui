# Patch: Release address explains itself instead of a made-up example (QA DEF-22)

`digiworks-portal.tar.gz` includes this patch (on top of `search-unmet-criteria`). To reproduce it: extract `/app/.next` from the image **with the earlier patches applied**, run `python3 apply.py <extracted app dir> files` here to regenerate `files/`, then `docker build -t digiworks-portal:release .`.

**Symptom:** Settings > AI updates > Connection: the *Release address* field showed the placeholder `https://releases.example.com`, which reads as unfinished scaffolding.

**Cause:** placeholder text in `UpdatesAdmin` (`src/components/updates-admin.tsx`). There is no fixed release address to show instead: it comes from the platform together with the single-use enrollment token (and the portal only accepts hosts listed in `DIGI_RELEASE_ALLOW_HOSTS`).

**Fix:** the placeholder now says "Paste the address you were given", and a hint under the field (linked with `aria-describedby`) says "The https address that came with your enrollment token. If you do not have it, ask whoever gave you the token." If the platform later has one fixed address, put it in the placeholder instead.

The placeholder is part of the server-rendered HTML, which hydration does not replace, so both chunks are patched: the browser chunk (renamed to `20dr4g_i5s3q7-hint1.js` so browsers do not reuse the cached old file; the `/settings/updates` manifest is updated to match) and the server-render chunk `_0_v7pxv._.js`.

**Tested** on a local copy as Admin: /settings/updates loads the renamed chunk and shows the new placeholder and hint; no console errors from the portal.

**Fix in the portal source** (apply there so the next build keeps it): `updates-admin.tsx` here is the fixed file; `updates-admin.diff` is the change.
