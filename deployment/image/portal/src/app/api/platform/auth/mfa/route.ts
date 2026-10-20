import QRCode from "qrcode";
import { isPlatform } from "@/lib/role";
import { currentOperator, mfaEnrollStart, mfaVerify } from "@/lib/studio/auth";
import { studioEnabled } from "@/lib/studio/db";
import { jsonBody } from "@/lib/studio/guard";

const gone = () => Response.json({ error: "Not found." }, { status: 404 });

/** Starts two-factor enrolment: returns the secret and an otpauth link for an authenticator app. Only before enrolment is complete. */
export async function GET() {
  if (!isPlatform() || !studioEnabled()) return gone();
  const op = await currentOperator();
  if (!op) return Response.json({ error: "Sign in first." }, { status: 401 });
  const r = await mfaEnrollStart(op);
  return "error" in r ? Response.json(r, { status: 409 }) : Response.json({ ...r, qr: await QRCode.toString(r.uri, { type: "svg", margin: 1, width: 192 }) });
}

/** Proves the second factor (and completes enrolment on first use). */
export async function POST(req: Request) {
  if (!isPlatform() || !studioEnabled()) return gone();
  const op = await currentOperator();
  if (!op) return Response.json({ error: "Sign in first." }, { status: 401 });
  const b = await jsonBody<{ code?: unknown }>(req);
  if (!b || typeof b.code !== "string") return Response.json({ error: "Enter the 6-digit code." }, { status: 400 });
  return (await mfaVerify(op, b.code)) ? Response.json({ ok: true }) : Response.json({ error: "That code is not right, or was already used." }, { status: 401 });
}
