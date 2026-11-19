import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

Object.assign(process.env, { OWUI_BASE_URL: "http://owui.test", OWUI_RUNTIME_EMAIL: "runtime@digi.test", OWUI_RUNTIME_PASSWORD: "x" });
const { pool } = await import("@/lib/runtime/owui-connections");
const { OwuiRuntimeAdapter } = await import("@/lib/runtime/owui-adapter");

/* A fake Open WebUI 0.13: it refuses a turn whose chat_id it holds no chat for, as the real one does (404). */
type Req = { method: string; path: string; body: Record<string, unknown> | null };
let calls: Req[] = [];
let chats: Set<string>;
let canOpen: boolean;
const account = pool()[0]!;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
  const path = new URL(String(url)).pathname, method = init.method ?? "GET";
  const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
  calls.push({ method, path, body });
  if (path === "/api/v1/chats/new") {
    if (!canOpen) return json(500, { detail: "nope" });
    chats.add("owui-chat-1"); return json(200, { id: "owui-chat-1" });
  }
  if (path === "/api/chat/completions") {
    if (!chats.has(body.chat_id)) return json(404, { detail: "We could not find what you're looking for :/" });
    // the answer arrives over the account's socket, tagged with the chat id
    setTimeout(() => account.listeners.get(body.chat_id)?.({ chat_id: body.chat_id, data: { type: "chat:completion", data: { done: true } } }), 5);
    return json(200, { task_ids: ["task-1"] });
  }
  if (method === "DELETE" && path.startsWith("/api/v1/chats/")) { chats.delete(path.split("/").pop()!); return json(200, true); }
  return json(404, {});
}) as typeof fetch;

async function turn() {
  const events = [];
  for await (const e of new OwuiRuntimeAdapter().startExecution({ executionId: "digi-run-7", tenantId: "t1", model: "digi", toolIds: [], messages: [{ role: "user", content: "hi" }] } as never)) events.push(e);
  await new Promise((r) => setTimeout(r, 5));   // the chat is deleted without waiting
  return events.map((e) => e.type);
}

describe("a turn on Open WebUI 0.13", () => {
  beforeEach(() => {
    calls = []; chats = new Set(); canOpen = true;
    Object.assign(account, { up: true, token: "runtime-token", socket: { id: "socket-1" }, inflight: 0 });
  });

  test("opens a chat in Open WebUI, sends the turn with that chat's id, and deletes the chat afterwards", async () => {
    assert.deepEqual(await turn(), ["started", "completed"]);
    const send = calls.find((c) => c.path === "/api/chat/completions")!;
    assert.equal(send.body!.chat_id, "owui-chat-1");
    assert.notEqual(send.body!.chat_id, "digi-run-7", "a made-up chat id is what Open WebUI 0.13 answers 404 to");
    assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ["POST /api/v1/chats/new", "POST /api/chat/completions", "DELETE /api/v1/chats/owui-chat-1"]);
    assert.equal(chats.size, 0);
    assert.equal(account.listeners.size, 0);
  });

  test("if Open WebUI will not open a chat, the turn fails with a plain message and nothing is sent", async () => {
    canOpen = false;
    assert.deepEqual(await turn(), ["started", "failed"]);
    assert.equal(calls.filter((c) => c.path === "/api/chat/completions").length, 0);
    assert.equal(account.inflight, 0);
  });
});
