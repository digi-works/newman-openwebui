import type { Actor } from "./booking-service";
import { withTenant } from "./digi-db";
import { resolveExecutionContext, type ExecutionContext } from "./exec-context";
import { accessFor } from "./session";

/**
 * Who is asking, for the tool gateway: recovered from the per-turn handle Digi created, never from tool arguments. Permissions are read live,
 * so a role change takes effect on the next tool call. Returns null if the handle is unknown, expired or the person is disabled.
 */
export async function callerFromChatId(chatId: unknown): Promise<{ actor: Actor; ctx: ExecutionContext } | null> {
  const ctx = await resolveExecutionContext(chatId);
  if (!ctx) return null;
  const row = await withTenant(ctx.tenantId, async (c) => (await c.query("select name, email from users where id = $1 and status = 'active'", [ctx.userId])).rows[0]);
  if (!row) return null;
  const access = await accessFor(ctx.tenantId, ctx.userId);
  return { actor: { id: ctx.userId, tenantId: ctx.tenantId, name: row.name, email: row.email, permissions: access.permissions }, ctx };
}

export async function actorFromChatId(chatId: unknown): Promise<Actor | null> {
  return (await callerFromChatId(chatId))?.actor ?? null;
}
