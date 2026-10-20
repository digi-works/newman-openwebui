import { isPlatform } from "@/lib/role";
import { clientIp } from "@/lib/ratelimit";
import { loginOperator } from "@/lib/studio/auth";
import { studioEnabled } from "@/lib/studio/db";
import { jsonBody } from "@/lib/studio/guard";

/** Step 1 of operator sign-in: email and password. A session is created but is not usable until the second factor is proved. */
export async function POST(req: Request) {
  if (!isPlatform() || !studioEnabled()) return Response.json({ error: "Not found." }, { status: 404 });
  const b = await jsonBody<{ email?: unknown; password?: unknown }>(req);
  if (!b || typeof b.email !== "string" || typeof b.password !== "string" || b.email.length > 320 || b.password.length > 1024) {
    return Response.json({ error: "Enter your email and password." }, { status: 400 });
  }
  const r = await loginOperator(b.email, b.password, clientIp(req));
  return r.ok ? Response.json({ next: r.next }) : Response.json({ error: r.error }, { status: r.status });
}
