/**
 * Data seam for the catalog. Pages call these functions only.
 * Live mode (OWUI_BASE_URL set): agents are Open WebUI custom models.
 * Otherwise: mock data, so the UI still runs on its own.
 * WIRING POINT: when Digiworks core owns the catalog, swap the live branch for calls to core.
 */
import { AGENTS } from "./mock-data";
import { isLive, listOwuiAgents } from "./owui";
import { runtimeToken } from "./owui-runtime";
import { getSessionUser } from "./session";
import type { Agent } from "./types";

export { isLive };

export async function listAgents(): Promise<Agent[]> {
  if (!isLive()) return AGENTS;
  if (!(await getSessionUser())) return [];
  try {
    return await listOwuiAgents(await runtimeToken());
  } catch (e) {
    console.error("listAgents failed", e);
    return [];
  }
}

export async function getAgent(id: string): Promise<Agent | undefined> {
  return (await listAgents()).find((a) => a.id === id);
}
