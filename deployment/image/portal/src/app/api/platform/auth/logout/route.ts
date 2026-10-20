import { isPlatform } from "@/lib/role";
import { logoutOperator } from "@/lib/studio/auth";

export async function POST() {
  if (!isPlatform()) return Response.json({ error: "Not found." }, { status: 404 });
  await logoutOperator();
  return Response.json({ ok: true });
}
