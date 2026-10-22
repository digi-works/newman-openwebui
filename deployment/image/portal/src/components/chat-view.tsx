"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, ChevronDown, Copy, Database, FileText, Square, ThumbsDown, ThumbsUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AgentAvatar } from "@/components/agent-avatar";
import { streamReply } from "@/lib/chat-transport";
import { renderMarkdown } from "@/lib/markdown";
import type { ChatDetail, ChatMessage } from "@/lib/conversations";
import { ActionCardView } from "@/components/action-card";
import { createChat, refreshChats } from "@/lib/store";
import type { Agent, Message } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Hidden machine-readable blocks (<!--room-request {...}-->) that forms add for the worker. People never see them. */
const stripMarkers = (t: string) => t.replace(/<!--[\s\S]*?-->/g, "").trim();

/** A message from the server as the chat shows it. One still marked streaming belongs to a turn this page is not running. */
const toUi = (m: ChatMessage): Message => ({
  id: m.id, role: m.role, text: m.text, toolLabel: m.toolLabel, embeds: m.embeds, actions: m.actions, feedback: m.feedback,
  status: m.role === "user" ? undefined : m.status === "stopped" || m.status === "streaming" ? "stopped" : "done",
});

const SERVER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ChatView({ agents, initial, live }: { agents: Agent[]; initial: ChatDetail; live: boolean }) {
  const router = useRouter();
  const chatId = initial.id;
  const agent = agents.find((a) => a.id === initial.agentId);
  const [messages, setMessages] = useState<Message[]>(() => initial.messages.map(toUi));
  const [input, setInput] = useState("");
  const stopRef = useRef<(() => void) | null>(null);
  const sentPending = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const sendRef = useRef<(t: string) => void>(() => {});
  const streaming = messages.some((m) => m.status === "working" || m.status === "streaming");
  const patchMsg = (id: string, patch: Partial<Message>) => setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages]);

  // Forms inside the chat talk to the page with postMessage, the same way they do inside Open WebUI.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const frame = Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe[data-embed]")).find((f) => f.contentWindow === e.source);
      if (!frame) return;
      const d = e.data as { type?: string; text?: string; height?: number } | null;
      if (d?.type === "iframe:height" && typeof d.height === "number") frame.style.height = `${Math.min(Math.max(d.height, 80), 1400)}px`;
      if (d?.type === "input:prompt:submit" && typeof d.text === "string" && d.text.length < 4000) sendRef.current(d.text);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function send(text: string) {
    text = text.trim();
    if (!text || !agent || streaming) return;
    // The server loads the history itself; the browser sends only this message. Temporary ids are swapped for the saved ones on "meta".
    const tmp = Date.now();
    let aid = `tmp-a${tmp}`;
    const uid = `tmp-u${tmp}`;
    setMessages((ms) => [...ms, { id: uid, role: "user", text }, { id: aid, role: "assistant", text: "", status: "working" }]);
    setInput("");
    const ctl = new AbortController();
    let acc = "";
    // Stop tells the server how much of the answer was shown, so it saves only that, then drops the stream (QA DEF-50).
    // Before "meta" there is no saved id to stop yet, so the stop waits for it.
    let stopAsked = false;
    const stopNow = () => {
      if (live && SERVER_ID.test(aid)) {
        void fetch(`/api/conversations/${chatId}/messages/${aid}/stop`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shown: acc.length }), keepalive: true }).catch(() => undefined);
      }
      ctl.abort();
    };
    stopRef.current = () => { if (!live || SERVER_ID.test(aid)) stopNow(); else stopAsked = true; };
    let waiting = false;
    const patch = (p: Partial<Message>) => patchMsg(aid, p);
    const clearWait = () => { if (waiting) { waiting = false; patch({ toolLabel: undefined }); } };
    try {
      for await (const ev of streamReply(agent, chatId, text, live, ctl.signal)) {
        if (ev.type === "meta") {
          // the updater runs later, so it must compare with the temporary id, not with aid after it is reassigned
          const tmpId = aid;
          setMessages((ms) => ms.map((m) => (m.id === uid ? { ...m, id: ev.userMessageId } : m.id === tmpId ? { ...m, id: ev.assistantMessageId } : m)));
          aid = ev.assistantMessageId;
          void refreshChats();
          if (stopAsked) stopNow();
        } else if (ev.type === "queued") {
          waiting = true;
          patch({ toolLabel: ev.position > 1 ? `Digi is busy. ${ev.position - 1} ahead of you…` : "Digi is busy. You are next…" });
        } else if (ev.type === "tool") { waiting = false; patch({ toolLabel: ev.label }); }
        else if (ev.type === "embed") { clearWait(); setMessages((ms) => ms.map((m) => (m.id === aid ? { ...m, embeds: [...(m.embeds ?? []), ev.html] } : m))); }
        else if (ev.type === "action") {
          clearWait();
          setMessages((ms) => ms.map((m) => (m.id === aid ? { ...m, actions: [...(m.actions ?? []).filter((a) => a.id !== ev.action.id), ev.action] } : m)));
        }
        else if (ev.type === "text") { clearWait(); acc += ev.delta; patch({ text: acc, status: "streaming" }); }
        else if (ev.type === "done") { clearWait(); patch({ status: "done", table: ev.table, sources: ev.sources }); }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") patch({ status: "stopped", toolLabel: undefined });
      else patch({ status: "done", toolLabel: undefined, text: acc || `Sorry, I couldn’t get an answer. ${(e as Error).message || "Try again."}` });
    } finally {
      stopRef.current = null;
      void refreshChats();
    }
  }

  function setFeedback(m: Message, value: "up" | "down" | undefined) {
    patchMsg(m.id, { feedback: value });
    if (live && SERVER_ID.test(m.id)) {
      void fetch(`/api/conversations/${chatId}/messages/${m.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feedback: value ?? null }) });
    }
  }

  useEffect(() => { sendRef.current = (t) => { void send(t); }; });

  // A prompt chosen on another page (a starter or card) is sent once when the chat opens. The server clears it as the turn starts.
  useEffect(() => {
    if (initial.pendingPrompt && sentPending.current !== initial.id) {
      sentPending.current = initial.id;
      void send(initial.pendingPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.id]);

  if (!agent) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div className="space-y-3">
          <h1 className="text-lg font-semibold">This worker is not available</h1>
          <p className="text-sm text-muted-foreground">The conversation is kept, but the worker it was with is no longer offered to you.</p>
          <Button render={<Link href="/history" />}>Back to history</Button>
        </div>
      </div>
    );
  }

  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;

  return (
    <div className="flex h-full min-h-0">
      {/* thread */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2.5 md:px-6">
          <AgentAvatar name={agent.name} className="size-8" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold leading-tight">{agent.name}</div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-1.5 rounded-full bg-emerald-500" />Online</div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>Switch worker <ChevronDown /></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              {agents.map((a) => (
                <DropdownMenuItem key={a.id} onClick={async () => router.push(`/chat/${await createChat(a.id)}`)}>
                  <AgentAvatar name={a.name} className="size-6 text-xs" />
                  <span className="flex-1 truncate">{a.name}</span>
                  <span className="text-xs text-muted-foreground">{a.category}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-6 md:px-6">
          <div className="mx-auto max-w-3xl space-y-6">
            {messages.length === 0 ? (
              <div className="space-y-6 pt-8 text-center">
                <div className="space-y-2">
                  <AgentAvatar name={agent.name} className="mx-auto size-14 text-xl" />
                  <h2 className="text-xl font-semibold tracking-tight">{agent.name}</h2>
                  <p className="mx-auto max-w-md text-sm text-muted-foreground">{agent.description}</p>
                </div>
                <div className="grid gap-2 text-left sm:grid-cols-2">
                  {agent.starters.slice(0, 4).map((s) => (
                    <button key={s} onClick={() => void send(s)} className="rounded-lg border bg-card px-3.5 py-2.5 text-sm transition-colors hover:bg-muted">{s}</button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) => <MessageRow key={m.id} m={m} agent={agent} onFeedback={setFeedback} activeEmbeds={m.id === lastAssistantId} />)
            )}
            <div ref={endRef} />
          </div>
        </div>

        <div className="shrink-0 px-4 pb-4 md:px-6">
          <form
            onSubmit={(e) => { e.preventDefault(); void send(input); }}
            className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border bg-card p-2 shadow-sm focus-within:ring-3 focus-within:ring-ring/30"
          >
            {/* Attachments are not built yet (Plane: chat attachments). The button stays out until they work. */}
            <Textarea
              value={input} onChange={(e) => setInput(e.target.value)} rows={1}
              placeholder={`Message ${agent.name}…`} aria-label="Message"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }}
              className="max-h-36 min-h-9 resize-none border-0 bg-transparent px-1 py-2 shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
            {streaming ? (
              <Button type="button" size="icon" aria-label="Stop" onClick={() => stopRef.current?.()}><Square className="fill-current" /></Button>
            ) : (
              <Button type="submit" size="icon" aria-label="Send" disabled={!input.trim()}><ArrowUp /></Button>
            )}
          </form>
          <p className="mt-2 text-center text-xs text-muted-foreground">AI can make mistakes. Check important figures against the source.</p>
        </div>
      </div>
    </div>
  );
}

function MessageRow({ m, agent, onFeedback, activeEmbeds }: { m: Message; agent: Agent; onFeedback: (m: Message, v: "up" | "down" | undefined) => void; activeEmbeds: boolean }) {
  const [copied, setCopied] = useState(false);
  if (m.role === "user") {
    return <div className="flex justify-end"><div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">{stripMarkers(m.text)}</div></div>;
  }
  const working = m.status === "working";
  return (
    <div className="flex gap-3">
      <AgentAvatar name={agent.name} className="size-8" />
      <div className="min-w-0 flex-1 space-y-3 text-sm leading-relaxed">
        {(m.toolLabel || working) && (
          <div className="inline-flex max-w-full items-center gap-2 rounded-lg border bg-card px-3 py-1.5 font-mono text-xs text-muted-foreground">
            {working ? <span className="size-3.5 animate-spin rounded-full border-2 border-muted border-t-foreground" /> : <Check className="size-3.5 text-emerald-600" />}
            <span className="truncate">{!m.toolLabel ? "Thinking…" : working ? m.toolLabel.replace(/^(Queried|Looked up|Used)/, "Using") + "…" : m.toolLabel}</span>
          </div>
        )}
        {renderMarkdown(m.text)}
        {m.embeds?.map((html, i) =>
          activeEmbeds ? (
            <iframe key={i} data-embed title="Form from the worker" sandbox="allow-scripts" srcDoc={html} className="block w-full rounded-xl border-0 bg-transparent" style={{ height: 360 }} />
          ) : (
            <p key={i} className="text-xs text-muted-foreground">Form shown earlier in this conversation.</p>
          ),
        )}
        {m.actions?.map((a) => <ActionCardView key={a.id} action={a} />)}
        {m.status === "stopped" && <p className="text-xs text-muted-foreground">Stopped.</p>}
        {m.table && (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm tabular-nums">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>{m.table.head.map((h, i) => <th key={h} className={cn("px-3 py-2 font-medium", i ? "text-right" : "text-left")}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {m.table.rows.map((r, ri) => (
                  <tr key={ri} className="border-t">
                    {r.map((c, ci) => {
                      const cell = typeof c === "string" ? { text: c } : c;
                      return <td key={ci} className={cn("whitespace-nowrap px-3 py-2", ci ? "text-right" : "text-left", cell.flag && "font-semibold text-amber-600 dark:text-amber-400")}>{cell.text}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {m.sources && m.sources.length > 0 && m.status === "done" && (
          <div className="flex flex-wrap gap-2">
            {m.sources.map((s) => (
              <Badge key={s.label} variant="outline" className="gap-1.5 font-normal text-muted-foreground">
                {s.kind === "data" ? <Database className="size-3" /> : <FileText className="size-3" />}{s.label}
              </Badge>
            ))}
          </div>
        )}
        {m.status === "done" && (
          <div className="-ml-1.5 flex gap-0.5">
            <Button variant="ghost" size="icon-sm" aria-label="Good answer" aria-pressed={m.feedback === "up"} onClick={() => onFeedback(m, m.feedback === "up" ? undefined : "up")}>
              <ThumbsUp className={cn(m.feedback === "up" && "fill-current")} />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Needs work" aria-pressed={m.feedback === "down"} onClick={() => onFeedback(m, m.feedback === "down" ? undefined : "down")}>
              <ThumbsDown className={cn(m.feedback === "down" && "fill-current")} />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Copy" onClick={async () => { try { await navigator.clipboard.writeText(m.text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }}>
              {copied ? <Check /> : <Copy />}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
