import { jsonBody } from "@/lib/studio/guard";
import { enroll } from "@/lib/studio/installations";
import { StudioError } from "@/lib/studio/store";

/** A customer stack redeems its single-use enrollment token, sending only its PUBLIC key and its version. */
export async function POST(req: Request) {
  const b = await jsonBody<{ token?: unknown; public_key?: unknown; digi_version?: unknown; runtime_capabilities?: unknown }>(req);
  if (!b || typeof b.token !== "string") return Response.json({ error: "Not authorised." }, { status: 401 });
  try {
    return Response.json(await enroll({ token: b.token, publicKey: b.public_key, digiVersion: typeof b.digi_version === "string" ? b.digi_version : undefined, runtimeCapabilities: b.runtime_capabilities }));
  } catch (e) {
    if (e instanceof StudioError) return Response.json({ error: e.status === 401 ? "Not authorised." : e.message }, { status: e.status });
    console.error("enrolment failed", e);
    return Response.json({ error: "Could not enrol." }, { status: 500 });
  }
}
