# Patch: tables and other Markdown in chat replies

`digiworks-portal.tar.gz` includes this patch (on top of `chat-followup-replies`). To reproduce it: extract `/app` from the unpatched image, run `python3 apply.py <extracted app dir> files` here to regenerate `files/`, then `docker build -t digiworks-portal:release .`.

**Symptom:** asked for a table, Digi's answer showed as a run of `| Room | Capacity |---|---|...` text. Lists, headings and code blocks also came out as plain text.

**Cause:** the chat view (`MessageRow` in `src/components/chat-view.tsx`) did not render Markdown. It split the reply on blank lines into paragraphs and only understood `**bold**`, so a Markdown table (which the model sends correctly) was flattened into one paragraph.

**Fix:** `markdown.js` renders GitHub-style tables (with `:--:` alignment, escaped `\|`, missing cells), headings, bullet and numbered lists, quotes, code blocks, rules, `**bold**`, `*italic*`, `` `code` `` and http(s)/mailto links. It builds React elements, never HTML strings, so model output cannot inject markup. A table shows as soon as its header and `|---|` line have streamed in.

`apply.py` puts it into both builds of the chat view, which must match or React reports a hydration error on page load:
- the browser chunk, saved under a new name (`1ftcf9r3odi0s-md1.js`) because Next.js serves chunks as cacheable forever and browsers would otherwise keep the old file; the chat page manifest is updated to the new name (it lists it twice)
- the server-render chunk `src_components_chat-view_tsx_1l5qao6._.js`

**Fix in the portal source** (apply there so the next build keeps it): add `markdown.ts` as `src/lib/markdown.ts`, then in `MessageRow` replace the `m.text.split("\n\n")...` line with

```tsx
{renderMarkdown(m.text)}
```

and `import { renderMarkdown } from "@/lib/markdown";`. Tailwind's preflight removes list bullets, so the renderer sets those styles inline.
