import type { Agent } from "./types";

/** The worker behind the Home page. Override the id with HOME_AGENT_ID. */
export function findHero(agents: Agent[]): Agent | null {
  const id = process.env.HOME_AGENT_ID || "digi";
  return agents.find((a) => a.id === id) ?? agents.find((a) => a.name.toLowerCase() === "digi") ?? null;
}
