import { io, type Socket } from "socket.io-client";
import { owuiBase } from "../owui";

/**
 * Connections to Open WebUI: a small pool of shared runtime accounts, each with ONE persistent websocket that carries many chats.
 * Open WebUI sends every event of an account to all of that account's sockets, so a socket per turn made traffic grow with the
 * square of concurrent chats (load probe, spikes/s0/LOAD.md). One socket per account, events routed by chat id, fixes that;
 * several accounts spread the load. Architecture v0.3 A11.
 *
 * Accounts come from OWUI_RUNTIME_POOL (a JSON array of {email, password}) or, for one account, OWUI_RUNTIME_EMAIL and
 * OWUI_RUNTIME_PASSWORD. People never have Open WebUI accounts.
 */
export type OwuiEvent = { chat_id?: string; data?: { type?: string; data?: Record<string, unknown> }; __disconnect?: boolean };
type Listener = (e: OwuiEvent) => void;
type Cred = { email: string; password: string };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const jitter = (ms: number) => ms + Math.floor(Math.random() * ms * 0.5);

export function poolCredentials(): Cred[] {
  const raw = process.env.OWUI_RUNTIME_POOL;
  if (raw) {
    try {
      const list = JSON.parse(raw) as Cred[];
      const ok = list.filter((c) => c && typeof c.email === "string" && typeof c.password === "string");
      if (ok.length) return ok;
    } catch { /* fall through to the single account */ }
  }
  const email = process.env.OWUI_RUNTIME_EMAIL, password = process.env.OWUI_RUNTIME_PASSWORD;
  return email && password ? [{ email, password }] : [];
}

export class Account {
  token: string | null = null;
  socket: Socket | null = null;
  up = false;
  inflight = 0;
  readonly listeners = new Map<string, Listener>();
  private connecting: Promise<void> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoff = 1000;

  constructor(readonly cred: Cred) {}

  async signIn(): Promise<string> {
    const res = await fetch(`${owuiBase()}/api/v1/auths/signin`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(this.cred), cache: "no-store",
    });
    if (!res.ok) throw new Error(`runtime sign-in failed (${res.status})`);
    this.token = ((await res.json()) as { token: string }).token;
    return this.token;
  }

  /** Makes sure the account has a live socket. Several callers share one attempt; attempts retry with jitter. */
  ensure(): Promise<void> {
    if (this.up) return Promise.resolve();
    this.connecting ??= (async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 4; attempt++) {
        try { await this.connect(); return; } catch (e) { lastError = e; await sleep(jitter(250 * 2 ** attempt)); }
      }
      throw lastError instanceof Error ? lastError : new Error("could not connect to the AI service");
    })().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  private async connect() {
    const token = await this.signIn();
    const socket = io(owuiBase(), { path: "/ws/socket.io", transports: ["websocket"], auth: { token }, reconnection: false, timeout: 8000 });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", (e) => { socket.close(); reject(e); });
    });
    socket.emit("user-join", { auth: { token } });
    await sleep(250);
    socket.on("events", (e: OwuiEvent) => { if (e?.chat_id) this.listeners.get(e.chat_id)?.(e); });
    socket.on("disconnect", () => {
      this.up = false;
      this.socket = null;
      for (const l of this.listeners.values()) l({ __disconnect: true });
      this.scheduleReconnect();
    });
    this.socket = socket;
    this.up = true;
    this.backoff = 1000;
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensure().catch(() => { this.backoff = Math.min(this.backoff * 2, 30_000); this.scheduleReconnect(); });
    }, jitter(this.backoff));
  }

  /** Drops the token and socket so the next use signs in again (an expired or rejected token). */
  reset() {
    this.token = null;
    this.up = false;
    this.socket?.close();
    this.socket = null;
  }
}

const g = globalThis as { __owuiPool?: Account[] };
export const pool = (): Account[] => (g.__owuiPool ??= poolCredentials().map((c) => new Account(c)));

/** The least busy account with a live socket; connects the others if none is up yet. */
export async function acquireAccount(): Promise<Account> {
  const accounts = pool();
  if (!accounts.length) throw new Error("OWUI_RUNTIME_EMAIL and OWUI_RUNTIME_PASSWORD are not set");
  const up = accounts.filter((a) => a.up);
  if (up.length) return up.reduce((best, a) => (a.inflight < best.inflight ? a : best));
  const results = await Promise.allSettled(accounts.map((a) => a.ensure().then(() => a)));
  const ready = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (!ready.length) throw new Error("could not connect to the AI service");
  return ready.reduce((best, a) => (a.inflight < best.inflight ? a : best));
}
