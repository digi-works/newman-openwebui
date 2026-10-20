// S0 load probe: K concurrent turns through ONE runtime account, one websocket per turn (what the portal does today).
// Measures connect time, time to finish, failures, and how many events each socket receives for OTHER chats.
// Usage: node spikes/s0/load.mjs 8 25   (runs each K in turn)
import fs from "node:fs";
import { io } from "socket.io-client";

const OWUI = "http://localhost:3001";
const token = JSON.parse(fs.readFileSync(".spike-runtime.json", "utf8")).token;

async function oneTurn(i) {
  const chatId = `local:load-${Date.now()}-${i}-${Math.random().toString(16).slice(2)}`;
  const out = { i, connectMs: null, totalMs: null, ok: false, own: 0, foreign: 0, error: null };
  const t0 = Date.now();
  const socket = io(OWUI, { path: "/ws/socket.io", transports: ["websocket"], auth: { token }, reconnection: false, timeout: 15000 });
  try {
    await new Promise((res, rej) => { socket.once("connect", res); socket.once("connect_error", rej); });
  } catch (e) { out.error = "connect: " + e.message; out.connectMs = Date.now() - t0; return out; }
  out.connectMs = Date.now() - t0;
  socket.emit("user-join", { auth: { token } });
  await new Promise((r) => setTimeout(r, 250));
  let done = false;
  socket.on("events", (e) => {
    if (e?.chat_id === chatId) { out.own++; if (e.data?.type === "chat:completion" && e.data.data?.done) done = true; if (e.data?.data?.error) out.error = "model: " + JSON.stringify(e.data.data.error).slice(0, 80); }
    else out.foreign++;
  });
  const t1 = Date.now();
  try {
    const res = await fetch(`${OWUI}/api/chat/completions`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "digi", stream: true, tool_ids: [], chat_id: chatId, id: crypto.randomUUID(), session_id: socket.id, messages: [{ role: "user", content: "Reply with the single word: ok" }] }),
    });
    if (!res.ok) { out.error = "http " + res.status; socket.close(); return out; }
    while (!done && !out.error && Date.now() - t1 < 90000) await new Promise((r) => setTimeout(r, 100));
    out.ok = done && !out.error;
    if (!done && !out.error) out.error = "timeout waiting for completion";
  } catch (e) { out.error = "fetch: " + e.message; }
  out.totalMs = Date.now() - t1;
  socket.close();
  return out;
}

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };
for (const k of process.argv.slice(2).map(Number)) {
  const t = Date.now();
  const r = await Promise.all(Array.from({ length: k }, (_, i) => oneTurn(i)));
  const ok = r.filter((x) => x.ok);
  console.log(JSON.stringify({
    concurrent: k, succeeded: ok.length, failed: r.length - ok.length,
    errors: [...new Set(r.filter((x) => x.error).map((x) => x.error))].slice(0, 4),
    connect_ms: { p50: pct(r.map((x) => x.connectMs).filter(Boolean), 0.5), p95: pct(r.map((x) => x.connectMs).filter(Boolean), 0.95) },
    turn_ms: { p50: pct(ok.map((x) => x.totalMs), 0.5), p95: pct(ok.map((x) => x.totalMs), 0.95) },
    events_per_socket: { own_avg: +(r.reduce((a, x) => a + x.own, 0) / k).toFixed(1), foreign_avg: +(r.reduce((a, x) => a + x.foreign, 0) / k).toFixed(1) },
    wall_s: +((Date.now() - t) / 1000).toFixed(1),
  }));
  await new Promise((r) => setTimeout(r, 3000));
}
process.exit(0);
