// S0 spike: one shared OWUI runtime account, two simulated Digi users at the same time.
// The tool gateway must recover the REAL user from the OWUI chat id, never from the runtime account.
// Run from the portal folder: node spikes/s0/run.mjs
import http from "node:http";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { io } from "socket.io-client";

const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => [l.split("=")[0].trim(), l.split("=").slice(1).join("=").trim().replace(/^"|"$/g, "")]));
const KEY = env.PORTAL_INTERNAL_KEY;
const OWUI = "http://localhost:3001";
const runtimeToken = JSON.parse(fs.readFileSync(".spike-runtime.json", "utf8")).token;

// --- Digi side: execution contexts and the tool gateway ---
const contexts = new Map(); // chat id -> { user, expiresAt }
const gatewayLog = [];
const connectLog = [];
function newContext(user, ttlMs = 120_000) {
  const chatId = `local:exec-${randomBytes(24).toString("hex")}`;
  contexts.set(chatId, { user, expiresAt: Date.now() + ttlMs });
  return chatId;
}
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (req.headers["x-internal-key"] !== KEY) return send(401, { error: "bad key" });
    let p = {}; try { p = JSON.parse(body); } catch {}
    const ctx = contexts.get(p.chat_id);
    const entry = { chat_id_prefix: String(p.chat_id).slice(0, 18), found: !!ctx, expired: !!ctx && ctx.expiresAt < Date.now(), user: ctx?.user?.email };
    gatewayLog.push(entry);
    if (!ctx) return send(404, { error: "unknown execution context" });
    if (ctx.expiresAt < Date.now()) return send(410, { error: "execution context expired" });
    send(200, { tenant: ctx.user.tenant, user_id: ctx.user.id, name: ctx.user.name, email: ctx.user.email, role: ctx.user.role });
  });
});
await new Promise((r) => server.listen(8791, "0.0.0.0", r));

// --- Digi -> OWUI turn (same websocket flow as the portal) ---
async function turn(chatId, prompt, timeoutMs = 90_000) {
  let socket, attempt = 0;
  for (;;) {
    const t0 = Date.now();
    socket = io(OWUI, { path: "/ws/socket.io", transports: ["websocket"], auth: { token: runtimeToken }, reconnection: false, timeout: 8000 });
    try {
      await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("connect_error", reject); });
      connectLog.push({ attempt, ms: Date.now() - t0 });
      break;
    } catch (e) {
      socket.close(); connectLog.push({ attempt, failed: String(e.message), ms: Date.now() - t0 });
      if (++attempt >= 4) throw e;
    }
  }
  socket.emit("user-join", { auth: { token: runtimeToken } });
  await new Promise((r) => setTimeout(r, 250));
  let text = "", done = false, error = null;
  const outputs = [];
  const seen = [];
  socket.on("events", (e) => {
    if (e?.chat_id !== chatId) return;
    const t = e.data?.type, p = e.data?.data;
    if (process.env.DEBUG) seen.push({ t, keys: p ? Object.keys(p) : null, sample: JSON.stringify(p)?.slice(0, 700) });
    if (t === "chat:completion" && p) {
      if (p.error) error = JSON.stringify(p.error);
      if (p.done) { done = true; for (const o of p.output ?? []) outputs.push(o); }
    }
    if (t === "response:completion" && p?.type === "response.output_text.delta" && typeof p.delta === "string") text += p.delta;
  });
  const res = await fetch(`${OWUI}/api/chat/completions`, {
    method: "POST", headers: { Authorization: `Bearer ${runtimeToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "digi", stream: true, tool_ids: ["digi_s0_whoami"], chat_id: chatId, id: crypto.randomUUID(), session_id: socket.id, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) { socket.close(); return { error: `HTTP ${res.status} ${await res.text().then((t) => t.slice(0, 200))}` }; }
  const t0 = Date.now();
  while (!done && !error && Date.now() - t0 < timeoutMs) await new Promise((r) => setTimeout(r, 200));
  socket.close();
  const call = outputs.find((o) => o.type === "function_call_output");
  const toolOut = call ? JSON.stringify(call.output ?? call) : null;
  if (process.env.DEBUG) console.log(JSON.stringify(seen, null, 1));
  return { text, error, toolOut, timedOut: !done && !error };
}

const A = { id: "u-alice", tenant: "newman", name: "Alice Student", email: "alice@newmanu.edu", role: "Student" };
const B = { id: "u-bob", tenant: "newman", name: "Bob Admin", email: "bob@newmanu.edu", role: "Admin" };
const PROMPT = "Call the whoami tool once, then reply with only the name and email it returned.";
const results = {};
const chatA = newContext(A), chatB = newContext(B);
const [ra, rb] = await Promise.all([turn(chatA, PROMPT), turn(chatB, PROMPT)]);
results.concurrent = { A: ra, B: rb };
const has = (r, who, not) => r.text.includes(who.email) && !r.text.includes(not.email);
results.reply_check = {
  A_reply_names_alice_not_bob: has(ra, A, B),
  B_reply_names_bob_not_alice: has(rb, B, A),
  A_reply_never_names_runtime_account: !ra.text.includes("digi-runtime"),
};

// Negative checks go straight at the gateway
const post = (chat_id, key = KEY) => fetch("http://localhost:8791/whoami", { method: "POST", headers: { "content-type": "application/json", "x-internal-key": key }, body: JSON.stringify({ chat_id }) }).then((r) => r.status);
const expired = newContext(A, -1);
results.negative = {
  unknown_chat_id: await post("local:exec-" + "0".repeat(48)),
  other_users_chat_id_without_key: await post(chatA, "wrong"),
  expired_context: await post(expired),
  missing_chat_id: await post(undefined),
};

console.log(JSON.stringify({ results, gatewayLog, connectLog }, null, 1));
server.close();
process.exit(0);
