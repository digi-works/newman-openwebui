import { owuiBase } from "./owui";

/**
 * Digi calls Open WebUI as one shared runtime account (digi-runtime). People never have Open WebUI accounts.
 * Credentials come from OWUI_RUNTIME_EMAIL and OWUI_RUNTIME_PASSWORD (server env only). The token is cached and refreshed on 401.
 */
let cached: { token: string; at: number } | null = null;
let inflight: Promise<string> | null = null;
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

async function signIn(): Promise<string> {
  const email = process.env.OWUI_RUNTIME_EMAIL, password = process.env.OWUI_RUNTIME_PASSWORD;
  if (!email || !password) throw new Error("OWUI_RUNTIME_EMAIL and OWUI_RUNTIME_PASSWORD are not set");
  const res = await fetch(`${owuiBase()}/api/v1/auths/signin`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }), cache: "no-store",
  });
  if (!res.ok) throw new Error(`runtime sign-in failed (${res.status})`);
  const { token } = (await res.json()) as { token: string };
  return token;
}

export async function runtimeToken(): Promise<string> {
  if (cached && Date.now() - cached.at < MAX_AGE_MS) return cached.token;
  inflight ??= signIn().then((token) => { cached = { token, at: Date.now() }; return token; }).finally(() => { inflight = null; });
  return inflight;
}

export function invalidateRuntimeToken() { cached = null; }
