# Patch: follow-up chat replies stuck on "Thinking…"

`digiworks-portal.tar.gz` includes this patch. To reproduce it: `docker build -t digiworks-portal:release .` in this folder, on top of the unpatched image.

**Symptom:** the first reply in a chat showed. Every later reply stayed on "Thinking…" until the page was reloaded, although the server had sent the full answer.

**Cause:** in the chat view (`ChatView`, `src/app/.../chat`), the `meta` event handler queued a React state update that compared each message id with the variable `a` (the temporary assistant id), then reassigned `a` to the server's id straight away. React runs queued updaters later, so the comparison saw the new id. The temporary message was never renamed, and every later update went to an id that was not on screen. The first message only worked because React sometimes runs the updater immediately.

**Fix in the portal source** (apply there so the next build keeps it). Capture the temporary id before reassigning it:

```ts
const tmpId = assistantId;
setMessages(ms => ms.map(m => m.id === userTmpId ? { ...m, id: ev.userMessageId } : m.id === tmpId ? { ...m, id: ev.assistantMessageId } : m));
assistantId = ev.assistantMessageId;
```

The built chunk here is the original with that single change (`(__tmp=>p(...))(a)`).
