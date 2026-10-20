import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { auditEvent } from "./audit";
import { withTenant } from "./digi-db";
import { owuiBase } from "./owui";
import { patchSecretMeta, putSecret, readSecret, secretInfo } from "./secrets";

/**
 * The customer's own LLM key (decision of 8 Oct: customer-provided). The admin enters it once; Digi keeps it encrypted, never shows it again,
 * tests it, reads the provider's rate limits, compares them with the number of users, and tells the admin plainly when it is rejected or throttled.
 * People using Digi only ever see "AI quota is busy", never a provider message or a key.
 */
const NAME = "llm_api_key";
export const DEFAULT_BASE = "https://api.openai.com/v1";

export type LimitInfo = { requestsPerMin?: number; tokensPerMin?: number };
export type CheckResult = { ok: boolean; message: string; models?: number; limits?: LimitInfo; at: string };
export type AiStatus = {
  configured: boolean; last4: string; baseUrl: string; updatedAt?: string;
  check?: CheckResult; alert?: { kind: "key_rejected" | "rate_limited"; at: string };
  sizing: { users: number; estimatedTokensPerMin: number; warning?: string };
};

export class AiConnectionError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

/* ---- SSRF guard: an admin-supplied address must be https and must not point inside our network */
const isPrivateIp = (ip: string) => {
  if (ip.includes(":")) return ip === "::1" || ip.toLowerCase().startsWith("fc") || ip.toLowerCase().startsWith("fd") || ip.toLowerCase().startsWith("fe80") || ip.startsWith("::ffff:127.");
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
};
export async function assertPublicHttps(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new AiConnectionError("Enter the provider address as a full https:// URL."); }
  if (u.protocol !== "https:") throw new AiConnectionError("The provider address must start with https://.");
  if (u.username || u.password) throw new AiConnectionError("The provider address must not contain a login.");
  const host = u.hostname;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new AiConnectionError("That address points inside a private network.");
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addrs.length) throw new AiConnectionError("Could not find that provider address.");
  if (addrs.some(isPrivateIp)) throw new AiConnectionError("That address points inside a private network.");
  return u;
}

const normalize = (u: string) => u.trim().replace(/\/+$/, "");

export async function aiStatus(tenantId: string): Promise<AiStatus> {
  const info = await secretInfo(tenantId, NAME);
  const users = await withTenant(tenantId, async (c) => (await c.query("select count(*)::int as n from users where status = 'active'")).rows[0].n as number);
  // Sizing guide: about one in ten people is in a conversation at the busiest moment, each turn is roughly 4,000 tokens, two turns a minute.
  const estimatedTokensPerMin = Math.round(users * 0.1 * 2 * 4000);
  const check = info.meta.check as CheckResult | undefined;
  const limit = check?.limits?.tokensPerMin;
  const warning = limit && limit < estimatedTokensPerMin
    ? `Your provider limit (${limit.toLocaleString()} tokens a minute) is below what ${users.toLocaleString()} people may use at the busiest moment (about ${estimatedTokensPerMin.toLocaleString()}). Ask the provider for a higher tier before a busy day.`
    : undefined;
  return {
    configured: info.exists, last4: info.last4, baseUrl: (info.meta.baseUrl as string) || DEFAULT_BASE, updatedAt: info.updatedAt,
    check, alert: info.meta.alert as AiStatus["alert"], sizing: { users, estimatedTokensPerMin, warning },
  };
}

export async function saveConnection(admin: { id: string; tenantId: string }, input: { apiKey: string; baseUrl?: string }): Promise<AiStatus> {
  const apiKey = input.apiKey.trim();
  if (apiKey.length < 20 || apiKey.length > 300 || /\s/.test(apiKey)) throw new AiConnectionError("That does not look like a complete API key. Paste it again without spaces.");
  const baseUrl = normalize(input.baseUrl || DEFAULT_BASE);
  await assertPublicHttps(baseUrl);
  await putSecret(admin.tenantId, NAME, apiKey, admin.id, { baseUrl });
  await withTenant(admin.tenantId, (c) => auditEvent(c, { tenantId: admin.tenantId, userId: admin.id, action: "ai.key.update", entityType: "secret", entityId: NAME, metadata: { baseUrl, last4: apiKey.slice(-4) } }));
  return aiStatus(admin.tenantId);
}

const headerNum = (h: Headers, ...names: string[]) => { for (const n of names) { const v = Number(h.get(n)); if (v > 0) return v; } return undefined; };

/** Checks the stored key against the provider. With deep it also makes one tiny request to read the rate-limit headers. */
export async function testConnection(admin: { id: string; tenantId: string }, deep: boolean): Promise<CheckResult> {
  const key = await readSecret(admin.tenantId, NAME);
  if (!key) throw new AiConnectionError("No AI key has been saved yet.", 404);
  const base = normalize(((await secretInfo(admin.tenantId, NAME)).meta.baseUrl as string) || DEFAULT_BASE);
  await assertPublicHttps(base);
  const at = new Date().toISOString();
  const done = async (r: CheckResult) => {
    await patchSecretMeta(admin.tenantId, NAME, { check: r, ...(r.ok ? { alert: null } : {}) });
    await withTenant(admin.tenantId, (c) => auditEvent(c, { tenantId: admin.tenantId, userId: admin.id, action: "ai.key.test", entityType: "secret", entityId: NAME, result: r.ok ? "success" : "failed", metadata: { message: r.message } }));
    return r;
  };
  const call = (path: string, init: RequestInit = {}) =>
    fetch(base + path, { ...init, redirect: "error", signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" } });

  let res: Response;
  try { res = await call("/models"); } catch { return done({ ok: false, message: "Could not reach the AI provider. Check the address and try again.", at }); }
  if (res.status === 401 || res.status === 403) {
    await patchSecretMeta(admin.tenantId, NAME, { alert: { kind: "key_rejected", at } });
    return done({ ok: false, message: "The AI provider rejected this key. Check that it was copied in full and has not been revoked.", at });
  }
  if (res.status === 429) return done({ ok: false, message: "The key is valid, but the provider is rate limiting it right now. Try again in a minute.", at });
  if (!res.ok) return done({ ok: false, message: `The AI provider answered with an error (${res.status}).`, at });

  const models = ((await res.json().catch(() => ({}))) as { data?: { id: string }[] }).data ?? [];
  let limits: LimitInfo | undefined;
  if (deep) {
    const model = models.find((m) => m.id === "gpt-4o-mini")?.id ?? models.find((m) => /mini|haiku|flash/i.test(m.id))?.id ?? models[0]?.id;
    if (model) {
      const r2 = await call("/chat/completions", { method: "POST", body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "ok" }] }) }).catch(() => null);
      if (r2) limits = { requestsPerMin: headerNum(r2.headers, "x-ratelimit-limit-requests"), tokensPerMin: headerNum(r2.headers, "x-ratelimit-limit-tokens") };
    }
  }
  return done({ ok: true, message: `The key works (${models.length} models available).`, models: models.length, limits, at });
}

/** What a failed turn tells us about the key. Users never see the provider's words. */
export function classifyAiFailure(message: string): "rate_limited" | "key_rejected" | null {
  if (/\b429\b|rate.?limit|quota|too many requests|insufficient_quota/i.test(message)) return "rate_limited";
  if (/\b401\b|invalid.{0,12}api.?key|incorrect api key|unauthori[sz]ed|revoked/i.test(message)) return "key_rejected";
  return null;
}
export async function noteAiFailure(tenantId: string, kind: "rate_limited" | "key_rejected") {
  const info = await secretInfo(tenantId, NAME).catch(() => null);
  if (info?.exists) await patchSecretMeta(tenantId, NAME, { alert: { kind, at: new Date().toISOString() } }).catch(() => undefined);
}

/**
 * Puts the saved key into the Open WebUI connection that has the same address. dryRun reports what would change without changing it.
 * The key goes server to server only.
 */
export async function applyToRuntime(admin: { id: string; tenantId: string }, dryRun: boolean): Promise<{ connection: number; changed: boolean }> {
  const key = await readSecret(admin.tenantId, NAME);
  if (!key) throw new AiConnectionError("No AI key has been saved yet.", 404);
  const base = normalize(((await secretInfo(admin.tenantId, NAME)).meta.baseUrl as string) || DEFAULT_BASE);
  const token = process.env.OWUI_API_KEY || "";
  if (!owuiBase() || !token) throw new AiConnectionError("The AI service admin access is not configured on the server.", 503);
  const get = await fetch(`${owuiBase()}/openai/config`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!get.ok) throw new AiConnectionError("Could not read the AI service settings.", 502);
  const cfg = (await get.json()) as { OPENAI_API_BASE_URLS: string[]; OPENAI_API_KEYS: string[]; [k: string]: unknown };
  const idx = cfg.OPENAI_API_BASE_URLS.findIndex((u) => normalize(u) === base);
  if (idx < 0) throw new AiConnectionError("The AI service has no connection for that provider address, so the key was not applied.", 409);
  const changed = cfg.OPENAI_API_KEYS[idx] !== key;
  if (dryRun || !changed) return { connection: idx, changed };
  cfg.OPENAI_API_KEYS[idx] = key;
  const post = await fetch(`${owuiBase()}/openai/config/update`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(cfg), cache: "no-store" });
  if (!post.ok) throw new AiConnectionError("The AI service did not accept the new key.", 502);
  await withTenant(admin.tenantId, (c) => auditEvent(c, { tenantId: admin.tenantId, userId: admin.id, action: "ai.key.apply", entityType: "secret", entityId: NAME, metadata: { connection: idx } }));
  return { connection: idx, changed: true };
}
