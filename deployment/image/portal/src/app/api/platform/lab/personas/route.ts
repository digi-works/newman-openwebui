import { platformApi } from "@/lib/studio/guard";
import { personaSummary } from "@/lib/studio/lab";

/** The Test Lab's synthetic personas and the permissions each really holds on the test stack. */
export async function GET() {
  const g = await platformApi();
  return "res" in g ? g.res : Response.json({ personas: await personaSummary() });
}
