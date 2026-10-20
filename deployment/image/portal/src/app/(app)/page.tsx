import { HomeLanding } from "@/components/home-landing";
import { listAgents } from "@/lib/api";
import { findHero } from "@/lib/hero";
import { getSessionUser } from "@/lib/session";

export default async function HomePage() {
  const [agents, user] = await Promise.all([listAgents(), getSessionUser()]);
  return <HomeLanding hero={findHero(agents)} firstName={user?.name.split(" ")[0] ?? ""} />;
}
