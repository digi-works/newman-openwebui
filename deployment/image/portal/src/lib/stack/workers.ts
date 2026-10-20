import type { WorkerPolicy } from "../authority";
import { systemQuery } from "../digi-db";

/**
 * The Workers installed on this stack (from a verified release, or staged by the platform Test Lab). Customers never see these as "Workers":
 * they are AI Capabilities. This module is the stack's read model of them; installing and activating is in installer.ts.
 */
export type InstalledWorker = {
  workerId: string; releaseId: string; version: number; name: string; description: string; spec: Record<string, unknown>;
  toolPolicies: Record<string, "allow" | "ask" | "deny">; modelId: string | null; active: boolean; runtimeDef: { system?: string } | null;
};

const row = (r: Record<string, unknown>): InstalledWorker => ({
  workerId: r.worker_id as string, releaseId: r.release_id as string, version: r.version as number, name: r.name as string, description: r.description as string,
  spec: r.spec as Record<string, unknown>, toolPolicies: r.tool_policies as InstalledWorker["toolPolicies"], modelId: (r.compiled_model_id as string) ?? null, active: r.active as boolean, runtimeDef: (r.runtime_def as { system?: string } | null) ?? null,
});

export async function activeWorkers(): Promise<InstalledWorker[]> {
  return (await systemQuery("select * from installed_workers where active and release_id <> 'lab' order by worker_id")).rows.map(row);
}

export async function getWorker(workerId: string, lab = false): Promise<InstalledWorker | null> {
  const r = (await systemQuery(lab ? "select * from installed_workers where release_id = 'lab' and worker_id = $1" : "select * from installed_workers where active and release_id <> 'lab' and worker_id = $1", [workerId])).rows[0];
  return r ? row(r) : null;
}

/** The Worker's own limit on tools, for Authority: a tool it may not use is not allowed; one marked ask needs another person's approval. */
export function workerPolicyOf(w: InstalledWorker): WorkerPolicy {
  const entries = Object.entries(w.toolPolicies);
  return { name: w.name, allow: entries.filter(([, p]) => p !== "deny").map(([t]) => t), ask: entries.filter(([, p]) => p === "ask").map(([t]) => t) };
}
