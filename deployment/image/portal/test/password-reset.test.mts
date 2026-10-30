import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

process.env.BRAND_NAME = "Ask Digi";
process.env.BRAND_ORG = "Newman University";
process.env.BRAND_HOST = "newman.digiworks.ai";
delete process.env.PUBLIC_URL;
const { passwordResetEmail } = await import("@/lib/email-templates");
const { resetUrl, LINK_MINUTES } = await import("@/lib/password-reset");
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

describe("forgot password (QA DEF-30)", () => {
  test("the link points at this site's /reset-password, from the configured address and never the request's Host", () => {
    assert.equal(resetUrl("ab-c_9"), "https://newman.digiworks.ai/reset-password?token=ab-c_9");
    process.env.PUBLIC_URL = "https://digi.example.edu/";
    assert.equal(resetUrl("x"), "https://digi.example.edu/reset-password?token=x");
    delete process.env.PUBLIC_URL;
    assert.doesNotMatch(src("lib/password-reset.ts"), /headers\(\)|x-forwarded-host/);
  });

  test("the email has the button, how long it works, and what to do if you did not ask; the name is escaped", () => {
    const { subject, html } = passwordResetEmail(`Sam <b>"x"</b>`, "https://newman.digiworks.ai/reset-password?token=t&u=1", LINK_MINUTES);
    assert.equal(subject, "Reset your Ask Digi password");
    assert.ok(html.includes('href="https://newman.digiworks.ai/reset-password?token=t&amp;u=1"'));
    assert.ok(html.includes("Sam &lt;b&gt;&quot;x&quot;&lt;/b&gt;"));
    assert.ok(!html.includes("<b>\"x\""));
    for (const s of ["Choose a new password", `${LINK_MINUTES} minutes`, "Did not ask for this?"]) assert.ok(html.includes(s), s);
  });

  test("only a hash of the token is stored, links are single-use and end every session", () => {
    const lib = src("lib/password-reset.ts");
    assert.match(lib, /hashToken\(token\)/);
    assert.match(lib, /delete from password_resets where user_id = \$1", \[r\.user_id\]/);
    assert.match(lib, /delete from sessions where user_id = \$1/);
    assert.match(lib, /expires_at > now\(\)/);
  });

  test("the answer does not depend on whether the account exists, and the email goes out in the background", () => {
    const route = src("app/api/auth/forgot/route.ts");
    assert.match(route, /await requestPasswordReset\(.*\);\n[\s\S]*return Response\.json\(\{ ok: true \}\)/);
    assert.match(src("lib/password-reset.ts"), /void sendMail\(/);
  });

  test("the sign-in page links to /forgot-password instead of only showing a hint", () => {
    assert.match(src("components/login-form.tsx"), /<Link href="\/forgot-password"[^>]*>Forgot password\?<\/Link>/);
  });
});
