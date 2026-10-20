import { platformApi } from "@/lib/studio/guard";

export async function GET() {
  const g = await platformApi();
  return "res" in g ? g.res : Response.json({ operator: g.op });
}
