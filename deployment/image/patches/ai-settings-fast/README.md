# Patch: Settings > AI connection loads at once (QA DEF-18)

`digiworks-portal.tar.gz` includes this patch (on top of `approvals-room-requests`). To reproduce it: extract `/app` from the image before this patch, run `python3 apply.py <extracted app dir> files` here to regenerate `files/`, then `docker build -t digiworks-portal:release .`.

**Symptom:** `/settings/ai` took about 5.1 s on every load; every other page answered in under 0.11 s.

**Cause:** before rendering, the page builds the "AI runtime" card with `runtimeView()` (`src/lib/stack/runtime-switch.ts`), which checked each runtime's health one after the other and waited for each answer:
- Strands, which this deployment does not run: its check gives up only after a 5 second timeout (`strands-adapter.ts`, `AbortSignal.timeout(5000)`).
- Open WebUI, when its live connection is not up yet (e.g. after a restart): the check signs in and retries for seconds before answering.

**Fix:** both checks run at the same time, and the page waits at most 1.5 seconds. A check still running then shows "did not answer within 1.5 seconds; reload to check again" and keeps going in the background, so Open WebUI's connection is up for the next load. Patched in both copies of `runtimeView` (the page's and the API route's); server only, nothing in the browser changes.

Together with `STRANDS_RUNTIME_URL=http://127.0.0.1:9` in `deployment/aws/docker-compose.yml` (Strands' check then fails at once), the page loads as fast as the others whenever Open WebUI is connected, and never takes more than about 1.5 s.

**Tested** on a local copy whose Open WebUI can never connect (the worst case): 4.3 to 5.5 s before, 1.3 to 1.7 s after, with the card showing both runtimes' status. Other settings pages unchanged (about 0.05 s).

**Fix in the portal source:** in `runtimeView`, replace the `for` loop over `["owui", "strands"]` with

```ts
const ids: RuntimeId[] = ["owui", "strands"];
const slow = { ok: false, detail: "did not answer within 1.5 seconds; reload to check again" };
const health = await Promise.all(ids.map((id) => Promise.race([
  runtimeById(id).health().catch(() => ({ ok: false, detail: "not reachable" })),
  new Promise<typeof slow>((r) => setTimeout(() => r(slow), 1500)),
])));
ids.forEach((id, i) => {
  const features = runtimeById(id).capabilities().capabilities as unknown as Record<string, boolean>;
  options.push({ id, name: NAMES[id], ok: health[i].ok, detail: health[i].detail, features, blockedBy: missing(needs, features) });
});
```
