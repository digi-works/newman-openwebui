import { listInstallations } from "@/lib/studio/installations";
import { platformApi } from "@/lib/studio/guard";

/** Customer stacks that have enrolled: only what they reported (id, label, release, version, runtime capabilities). Never customer data. */
export async function GET() {
  const g = await platformApi();
  return "res" in g ? g.res : Response.json({ items: await listInstallations() });
}
