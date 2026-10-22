/**
 * AI turns still running in this process, by assistant message id, so Stop can end one. The browser dropping its connection is not enough:
 * behind the proxy the server does not always hear it, and the answer would run on and be saved in full (QA DEF-50).
 */
type Turn = {
  userId: string;
  /** Ends the turn, keeping the first `shown` characters. False when the turn is already saving its answer. */
  stop: (shown: number) => boolean;
  /** Settles once the turn's answer is saved. */
  saved: Promise<void>;
};

const g = globalThis as { __liveTurns?: Map<string, Turn> };
const turns = (g.__liveTurns ??= new Map());

export function trackTurn(messageId: string, turn: Turn): () => void {
  turns.set(messageId, turn);
  return () => { if (turns.get(messageId) === turn) turns.delete(messageId); };
}

/** "stopped" when the running turn took the stop; "ended" when there is no running turn here (or it had finished), so the saved message is final. */
export async function stopTurn(messageId: string, userId: string, shown: number): Promise<"stopped" | "ended"> {
  const t = turns.get(messageId);
  if (!t || t.userId !== userId) return "ended";
  if (t.stop(shown)) return "stopped";
  await t.saved;
  return "ended";
}
