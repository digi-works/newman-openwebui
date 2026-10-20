/** The deterministic part of the Capability Router, with no database or network, so it can be tested on its own. See router.ts for the whole story. */
export type Candidate = { workerId: string; keywords: string[]; priority: number };

export function pickWorker(cands: Candidate[], text: string, lastWorkerId?: string | null): { chosen: string | null; tied: string[]; scores: Record<string, number> } {
  const t = ` ${text.toLowerCase().replace(/<!--[\s\S]*?-->/g, " ")} `;
  const scores: Record<string, number> = {};
  for (const c of cands) scores[c.workerId] = c.keywords.filter((k) => k && t.includes(k.toLowerCase())).length;
  if (!cands.length) return { chosen: null, tied: [], scores };
  const best = Math.max(...Object.values(scores));
  // stay with the Worker already helping, unless another one matches strictly better
  if (lastWorkerId && lastWorkerId in scores && scores[lastWorkerId]! >= best && (best > 0 || cands.length >= 1)) return { chosen: lastWorkerId, tied: [], scores };
  if (best === 0) return { chosen: null, tied: [], scores };
  const top = cands.filter((c) => scores[c.workerId] === best);
  return top.length === 1 ? { chosen: top[0]!.workerId, tied: [], scores } : { chosen: null, tied: top.map((c) => c.workerId), scores };
}


/** An anti-rollback check: a release older than the stack's minimum allowed sequence must not be activated. */
export const isRollback = (seq: number, minAllowedSeq: number) => seq < minAllowedSeq;
