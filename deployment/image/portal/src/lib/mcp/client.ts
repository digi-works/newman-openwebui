import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * A small MCP client (JSON-RPC 2.0 over streamable HTTP) used only by Digi's MCP proxy (M5.9). Runtimes never talk to a tool server directly:
 * every call goes through Digi, so Authority, the per-tool switches and the audit trail cannot be bypassed.
 *
 * Safety: https only (unless the host is on the server's explicit allow-list for the pilot), no addresses inside private networks,
 * no redirects, a time limit and a size limit on every response.
 */
const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 20_000;

export class McpError extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

const allowedHosts = () => (process.env.DIGI_MCP_ALLOW_HOSTS || "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);

const isPrivate = (ip: string) => {
  if (ip.includes(":")) { const v = ip.toLowerCase(); return v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:127."); }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
};

/** Checked again on every call, not only when registered, so a name that later points inside the network is refused. Hosts on the allow-list (the pilot only) may be plain http or private. */
export async function assertOutboundUrl(raw: string, allow: string[]): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new McpError("Enter the address as a full URL.", 400); }
  if (u.username || u.password) throw new McpError("The address must not contain a login.", 400);
  if (allow.includes(u.hostname.toLowerCase())) return u;
  if (u.protocol !== "https:") throw new McpError("The address must start with https://.", 400);
  const host = u.hostname;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new McpError("That address points inside a private network.", 400);
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addrs.length) throw new McpError("Could not find that server.", 400);
  if (addrs.some(isPrivate)) throw new McpError("That address points inside a private network.", 400);
  return u;
}
export const assertMcpUrl = (raw: string) => assertOutboundUrl(raw, allowedHosts());

type Rpc = { jsonrpc: "2.0"; id?: number; method: string; params?: unknown };

async function readLimited(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) { await reader.cancel(); throw new McpError("The tool server sent too much data."); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** The JSON-RPC response may arrive as plain JSON or as an event stream; either way we want the message that answers our request. */
function parse(text: string, id: number): { result?: unknown; error?: { message?: string } } {
  const t = text.trim();
  const candidates: string[] = t.startsWith("{") || t.startsWith("[") ? [t] : t.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
  for (const c of candidates) {
    try {
      const j = JSON.parse(c);
      for (const m of Array.isArray(j) ? j : [j]) if (m && m.id === id) return m;
    } catch { /* ignore a partial frame */ }
  }
  throw new McpError("The tool server gave an answer Digi could not read.");
}

export class McpSession {
  private nextId = 1;
  private sessionId: string | null = null;
  constructor(private url: URL, private token: string | null) {}

  private async post(body: Rpc): Promise<Response> {
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    try {
      return await fetch(this.url, { method: "POST", headers, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    } catch {
      throw new McpError("Could not reach the tool server.");
    }
  }

  private async rpc(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    const res = await this.post({ jsonrpc: "2.0", id, method, params });
    if (res.status === 401 || res.status === 403) throw new McpError("The tool server rejected Digi's credential.", 502);
    if (!res.ok) throw new McpError(`The tool server answered with an error (${res.status}).`);
    this.sessionId = res.headers.get("mcp-session-id") ?? this.sessionId;
    const msg = parse(await readLimited(res), id);
    if (msg.error) throw new McpError(String(msg.error.message ?? "The tool server reported an error.").slice(0, 300));
    return msg.result;
  }

  async open() {
    await this.rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "digi-portal", version: "1" } });
    const r = await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
    await r.body?.cancel().catch(() => undefined);
  }

  async listTools(): Promise<{ name: string; description: string; inputSchema: Record<string, unknown> }[]> {
    const out = (await this.rpc("tools/list")) as { tools?: { name?: unknown; description?: unknown; inputSchema?: unknown }[] };
    return (out.tools ?? [])
      .filter((t) => typeof t.name === "string" && /^[\w.-]{1,64}$/.test(t.name as string))
      .map((t) => ({ name: t.name as string, description: typeof t.description === "string" ? t.description.slice(0, 500) : "", inputSchema: (t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : {}) as Record<string, unknown> }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    const out = (await this.rpc("tools/call", { name, arguments: args })) as { content?: { type?: string; text?: string }[]; isError?: boolean };
    const text = (out.content ?? []).filter((c) => c.type === "text" && typeof c.text === "string").map((c) => c.text).join("\n");
    return { text: text.slice(0, 20_000), isError: out.isError === true };
  }
}

export async function connect(rawUrl: string, token: string | null): Promise<McpSession> {
  const s = new McpSession(await assertMcpUrl(rawUrl), token);
  await s.open();
  return s;
}
