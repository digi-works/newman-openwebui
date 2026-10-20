import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

const ENV = { MS_TENANT_ID: "tenant-1", MS_CLIENT_ID: "client-1", MS_CLIENT_SECRET: "s3cret-value", MAIL_FROM: "Rooms@Example.edu" };
Object.assign(process.env, ENV);
const { mailConfigured, mailFrom, sendMail, sendMime, MailError } = await import("@/lib/mail");

/* A fake Microsoft: answers the token and sendMail endpoints from a script of responses and records every request. */
type Req = { url: string; init: RequestInit };
let calls: Req[] = [];
let script: Record<"token" | "send", () => Response>;
const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
  calls.push({ url: String(url), init });
  return String(url).includes("login.microsoftonline.com") ? script.token() : script.send();
}) as typeof fetch;
const tokenCalls = () => calls.filter((c) => c.url.includes("login.microsoftonline.com"));
const sendCalls = () => calls.filter((c) => c.url.includes("graph.microsoft.com"));

describe("Microsoft Graph sender", () => {
  beforeEach(() => {
    Object.assign(process.env, ENV);
    calls = [];
    script = { token: json(200, { access_token: "tok-1", expires_in: 3600 }), send: () => new Response(null, { status: 202 }) };
  });

  test("configured only when all four settings are present; MAIL_FROM is lowercased", () => {
    assert.equal(mailConfigured(), true);
    assert.equal(mailFrom(), "rooms@example.edu");
    for (const k of Object.keys(ENV)) {
      const v = process.env[k];
      delete process.env[k];
      assert.equal(mailConfigured(), false, k);
      process.env[k] = v;
    }
  });

  test("sendMail signs in with client credentials and posts one HTML message as MAIL_FROM", async () => {
    await sendMail({ to: ["a@x.edu"], subject: "Hello", html: "<p>Hi</p>", senderName: "Room Bookings" });
    const [tok] = tokenCalls();
    if (tok) { // the token may already be cached from an earlier test in this file
      assert.equal(tok.url, "https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token");
      const form = new URLSearchParams(String(tok.init.body));
      assert.equal(form.get("grant_type"), "client_credentials");
      assert.equal(form.get("scope"), "https://graph.microsoft.com/.default");
      assert.equal(form.get("client_secret"), "s3cret-value");
    }
    const [send] = sendCalls();
    assert.equal(send.url, "https://graph.microsoft.com/v1.0/users/rooms%40example.edu/sendMail");
    assert.equal((send.init.headers as Record<string, string>)["Content-Type"], "application/json");
    assert.match((send.init.headers as Record<string, string>).Authorization, /^Bearer tok-/);
    const body = JSON.parse(String(send.init.body));
    assert.equal(body.saveToSentItems, true);
    assert.equal(body.message.subject, "Hello");
    assert.deepEqual(body.message.body, { contentType: "HTML", content: "<p>Hi</p>" });
    assert.deepEqual(body.message.from, { emailAddress: { name: "Room Bookings", address: "rooms@example.edu" } });
    assert.deepEqual(body.message.toRecipients, [{ emailAddress: { address: "a@x.edu" } }]);
  });

  test("the access token is reused until it nearly expires", async () => {
    await sendMail({ to: ["a@x.edu"], subject: "1", html: "" });
    await sendMail({ to: ["b@x.edu"], subject: "2", html: "" });
    assert.ok(tokenCalls().length <= 1);
    assert.equal(sendCalls().length, 2);
  });

  test("subjects are cut at 250 characters", async () => {
    await sendMail({ to: ["a@x.edu"], subject: "x".repeat(400), html: "" });
    assert.equal(JSON.parse(String(sendCalls()[0].init.body)).message.subject.length, 250);
  });

  test("sendMime posts the MIME message base64 encoded as text/plain", async () => {
    const raw = "From: a@x.edu\r\nSubject: Café\r\n\r\nbody";
    await sendMime(raw);
    const [send] = sendCalls();
    assert.equal((send.init.headers as Record<string, string>)["Content-Type"], "text/plain");
    assert.equal(Buffer.from(String(send.init.body), "base64").toString("utf8"), raw);
  });

  test("a token Graph no longer accepts: signs in again and the same email goes through", async () => {
    let first = true;
    script.send = () => { if (first) { first = false; return json(401, { error: { code: "InvalidAuthenticationToken", message: "expired" } })(); } return new Response(null, { status: 202 }); };
    await sendMail({ to: ["a@x.edu"], subject: "s", html: "" });
    assert.equal(sendCalls().length, 2);
    assert.ok(tokenCalls().length >= 1); // a fresh sign-in after the refusal
  });

  test("Graph keeps refusing the token: a temporary error (retried later), and the next email signs in again", async () => {
    script.send = json(401, { error: { code: "InvalidAuthenticationToken", message: "expired" } });
    await assert.rejects(sendMail({ to: ["a@x.edu"], subject: "s", html: "" }), (e: unknown) => e instanceof MailError && !e.permanent);
    calls = [];
    script.send = () => new Response(null, { status: 202 });
    await sendMail({ to: ["a@x.edu"], subject: "s", html: "" });
    assert.equal(tokenCalls().length, 1);
  });

  const cases: [string, () => Response, RegExp, boolean][] = [
    ["wrong secret (token endpoint)", json(401, { error: "invalid_client", error_description: "AADSTS7000215" }), /Microsoft sign-in failed \(HTTP 401 invalid_client\): MS_CLIENT_SECRET is wrong or expired/, true],
    ["missing Mail.Send", json(403, { error: { code: "ErrorAccessDenied", message: "Access is denied." } }), /Sending failed \(HTTP 403 ErrorAccessDenied\): The app lacks Mail\.Send/, true],
    ["unknown mailbox", json(404, { error: { code: "ErrorInvalidUser", message: "x" } }), /MAIL_FROM is not a mailbox/, true],
    ["Microsoft outage", json(503, { error: { code: "ServiceUnavailable", message: "Try later" } }), /HTTP 503 ServiceUnavailable\): Try later/, false],
    ["throttled", json(429, { error: { code: "TooManyRequests", message: "slow down" } }), /HTTP 429/, false],
  ];
  for (const [name, resp, message, permanent] of cases) {
    test(`${name}: a readable error, ${permanent ? "permanent (no retry)" : "temporary (retried)"}`, async () => {
      if (name.includes("token")) {
        // force a fresh sign-in: a token Graph keeps refusing is dropped
        script.send = json(401, { error: { code: "InvalidAuthenticationToken", message: "" } });
        await sendMail({ to: ["a@x.edu"], subject: "s", html: "" }).catch(() => undefined);
        script.token = resp;
        script.send = () => new Response(null, { status: 202 });
      } else {
        script.send = resp;
      }
      await assert.rejects(sendMail({ to: ["a@x.edu"], subject: "s", html: "" }), (e: unknown) => {
        assert.ok(e instanceof MailError);
        assert.match(e.message, message);
        assert.equal(e.permanent, permanent);
        assert.doesNotMatch(e.message, /s3cret-value/); // the secret never appears in an error
        return true;
      });
    });
  }

  test("not configured: refuses at once without calling Microsoft", async () => {
    delete process.env.MS_CLIENT_SECRET;
    await assert.rejects(sendMail({ to: ["a@x.edu"], subject: "s", html: "" }), (e: unknown) => e instanceof MailError && e.permanent && /not set up/.test(e.message));
    assert.equal(calls.length, 0);
  });
});
