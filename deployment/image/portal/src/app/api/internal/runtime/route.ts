import { admission } from "@/lib/admission";
import { internalAuthorized } from "@/lib/internal-auth";
import { getRuntime } from "@/lib/runtime";

/** Runtime and admission status for operators and tests. Protected by the internal key. */
export async function GET(req: Request) {
  if (!internalAuthorized(req)) return Response.json({ error: "Not found." }, { status: 404 });
  const rt = await getRuntime();
  return Response.json({ runtime: rt.capabilities(), health: await rt.health(), admission: admission().stats() });
}
