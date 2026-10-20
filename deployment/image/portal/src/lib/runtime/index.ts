import { systemQuery } from "../digi-db";
import { OwuiRuntimeAdapter } from "./owui-adapter";
import { StrandsRuntimeAdapter } from "./strands-adapter";
import type { RuntimeAdapter, RuntimeId } from "./types";

export type * from "./types";

/**
 * The runtimes Digi can run AI turns on, and which one this stack uses. The choice is per stack and is made by the stack's Admin (Settings > AI runtime):
 * Open WebUI is the default and stays so until Strands has passed the same tests. The choice is stored in stack_identity.runtime and read with a short
 * cache, so a switch takes effect on the next turn everywhere. DIGI_RUNTIME in the environment is used only where there is no database (demo mode).
 */
const g = globalThis as { __runtimes?: Record<RuntimeId, RuntimeAdapter>; __runtimeChoice?: { at: number; id: RuntimeId } };
const adapters = () => (g.__runtimes ??= { owui: new OwuiRuntimeAdapter(), strands: new StrandsRuntimeAdapter() });

export const runtimeById = (id: RuntimeId): RuntimeAdapter => adapters()[id];

export async function currentRuntimeId(): Promise<RuntimeId> {
  const c = g.__runtimeChoice;
  if (c && Date.now() - c.at < 3000) return c.id;
  let id: RuntimeId = process.env.DIGI_RUNTIME === "strands" ? "strands" : "owui";
  if (process.env.DIGI_DATABASE_URL) {
    const r = (await systemQuery("select runtime from stack_identity where singleton").catch(() => ({ rows: [] }))).rows[0] as { runtime?: string } | undefined;
    if (r?.runtime === "strands" || r?.runtime === "owui") id = r.runtime;
  }
  g.__runtimeChoice = { at: Date.now(), id };
  return id;
}

export const forgetRuntimeChoice = () => { g.__runtimeChoice = undefined; };
export const getRuntime = async (): Promise<RuntimeAdapter> => runtimeById(await currentRuntimeId());
