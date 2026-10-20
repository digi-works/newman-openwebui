/**
 * Outgoing email through Microsoft Graph, as one mailbox (MAIL_FROM), with an app registration that holds Mail.Send (application).
 * Server only. The client secret comes from the environment and is never logged, stored or returned; errors carry Microsoft's code only.
 *   MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MAIL_FROM
 */
export class MailError extends Error {
  /** permanent: retrying will not help (wrong secret, missing permission, unknown mailbox) */
  constructor(message: string, readonly permanent = false) { super(message); }
}

const cfg = () => ({
  tenant: (process.env.MS_TENANT_ID || "").trim(),
  client: (process.env.MS_CLIENT_ID || "").trim(),
  secret: process.env.MS_CLIENT_SECRET || "",
  from: (process.env.MAIL_FROM || "").trim().toLowerCase(),
});

export const mailConfigured = () => { const c = cfg(); return !!(c.tenant && c.client && c.secret && c.from); };
export const mailFrom = () => cfg().from;

const HINTS: Record<string, string> = {
  invalid_client: "MS_CLIENT_SECRET is wrong or expired. Create a new secret in Microsoft Entra.",
  unauthorized_client: "MS_CLIENT_ID is wrong or the app is not in this tenant.",
  invalid_request: "MS_TENANT_ID or MS_CLIENT_ID is malformed.",
  ErrorAccessDenied: "The app lacks Mail.Send (application) with admin consent, or a mailbox policy blocks MAIL_FROM.",
  ErrorInvalidUser: "MAIL_FROM is not a mailbox in this Microsoft tenant.",
  MailboxNotEnabledForRESTAPI: "MAIL_FROM has no Exchange Online mailbox.",
  ErrorSendAsDenied: "The app may not send as MAIL_FROM.",
};
const PERMANENT = new Set(Object.keys(HINTS));

async function reason(step: string, res: Response) {
  const body = (await res.json().catch(() => ({}))) as { error?: unknown; error_description?: string };
  const err = body.error;
  const code = typeof err === "object" && err ? String((err as { code?: string }).code ?? "") : String(err ?? "");
  const msg = typeof err === "object" && err ? String((err as { message?: string }).message ?? "") : String(body.error_description ?? "");
  // a refused sign-in or a refused mailbox will not fix itself; an outage, throttling or a network error is retried by the job
  const permanent = PERMANENT.has(code) || res.status === 403 || (step === "Microsoft sign-in" && res.status < 500);
  return new MailError(`${step} failed (HTTP ${res.status} ${code}): ${HINTS[code] ?? msg.slice(0, 200)}`, permanent);
}

let token: { value: string; until: number } | null = null;

async function accessToken(): Promise<string> {
  if (token && Date.now() < token.until) return token.value;
  const c = cfg();
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(c.tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    body: new URLSearchParams({ client_id: c.client, client_secret: c.secret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw await reason("Microsoft sign-in", res);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: j.access_token, until: Date.now() + (Number(j.expires_in) - 120) * 1000 };
  return token.value;
}

async function post(body: BodyInit, contentType: string) {
  if (!mailConfigured()) throw new MailError("Email is not set up on this server (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MAIL_FROM).", true);
  const once = async () => fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg().from)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": contentType },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  let res = await once();
  // a token Microsoft no longer accepts (revoked, clock skew): sign in again and try once more
  if (res.status === 401) { token = null; res = await once(); }
  if (res.status === 401) token = null;
  if (res.status !== 202) throw await reason("Sending", res); // Graph answers 202 Accepted
}

export type Mail = { to: string[]; subject: string; html: string; senderName?: string };

/** One HTML email. Every address in `to` sees the others, so send one per person when that matters. */
export async function sendMail(m: Mail) {
  await post(JSON.stringify({
    message: {
      subject: m.subject.slice(0, 250),
      body: { contentType: "HTML", content: m.html },
      from: { emailAddress: { name: m.senderName ?? "Digi", address: cfg().from } },
      toRecipients: m.to.map((address) => ({ emailAddress: { address } })),
    },
    saveToSentItems: true,
  }), "application/json");
}

/** A whole MIME message (used for calendar invites, which need a text/calendar part). Graph takes it base64 encoded. */
export async function sendMime(raw: string) {
  await post(Buffer.from(raw, "utf8").toString("base64"), "text/plain");
}
