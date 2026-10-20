/**
 * Chat transport seam. The UI consumes an async stream of events and knows nothing else.
 * Live: POST /api/chat with the conversation id and the new message; the portal server loads the history, runs the turn through
 * the runtime adapter, saves the answer as it arrives, and streams these events back (meta, queued, tool, embed, text, done, error).
 * Mock: a canned reply, used when the AI service is not configured. It is not saved.
 */
import { FIN_REPLY } from "./mock-data";
import type { ActionCard, Agent, Source, TableData } from "./types";

export type ReplyEvent =
  | { type: "meta"; userMessageId: string; assistantMessageId: string; title: string }
  | { type: "queued"; position: number }
  | { type: "tool"; label: string }
  | { type: "embed"; html: string }
  | { type: "action"; action: ActionCard }
  | { type: "text"; delta: string }
  | { type: "done"; table?: TableData; sources?: Source[] };

type Wire =
  | { type: "meta"; userMessageId: string; assistantMessageId: string; title: string }
  | { type: "queued"; position: number }
  | { type: "tool"; label: string }
  | { type: "embed"; html: string }
  | { type: "action"; action: ActionCard }
  | { type: "text"; delta: string }
  | { type: "done" }
  | { type: "error"; message: string };

export function streamReply(agent: Agent, conversationId: string, text: string, live: boolean, signal?: AbortSignal) {
  return live ? streamLive(conversationId, text, signal) : streamMock(agent, text, signal);
}

async function* streamLive(conversationId: string, text: string, signal?: AbortSignal): AsyncGenerator<ReplyEvent> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId, text }),
    signal,
  });
  if (!res.ok || !res.body) {
    const msg = await res.json().then((j) => j.error as string).catch(() => `HTTP ${res.status}`);
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      let j: Wire;
      try { j = JSON.parse(line.slice(5).trim()); } catch { continue; }
      if (j.type === "error") throw new Error(j.message);
      if (j.type === "done") { yield { type: "done" }; continue; }
      yield j;
    }
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });

async function* streamMock(agent: Agent, prompt: string, signal?: AbortSignal): AsyncGenerator<ReplyEvent> {
  const isFin = agent.id === "fin";
  yield { type: "tool", label: isFin ? FIN_REPLY.toolLabel! : `Looked up ${agent.tools[0]?.name ?? "knowledge"}` };
  await sleep(1100, signal);

  const text = isFin
    ? FIN_REPLY.text
    : `Here is what I found about “${prompt.length > 80 ? prompt.slice(0, 80) + "…" : prompt}”.\n\nIn the live product this answer comes from ${agent.name}’s connected sources, with each statement linked to where it came from. Ask a follow-up and I’ll keep the context.`;
  for (const word of text.match(/\S+\s*/g) ?? []) {
    yield { type: "text", delta: word };
    await sleep(24, signal);
  }
  yield { type: "done", table: isFin ? FIN_REPLY.table : undefined, sources: isFin ? FIN_REPLY.sources : [{ kind: "doc", label: agent.tools[0]?.name ?? "Knowledge" }] };
}
