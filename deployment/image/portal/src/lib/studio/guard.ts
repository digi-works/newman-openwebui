import { isPlatform } from "../role";
import { currentOperator, type Operator, type OperatorRole } from "./auth";
import { studioEnabled } from "./db";

/**
 * Every /api/platform route starts here. Not the platform instance: 404. No session: 401. Signed in but the second factor not yet proved: 403.
 * Wrong platform role: 403. A customer Admin has none of this: customer sessions are a different cookie in a different database.
 */
export async function platformApi(role?: OperatorRole): Promise<{ op: Operator } | { res: Response }> {
  const no = (error: string, status: number) => ({ res: Response.json({ error }, { status }) });
  if (!isPlatform() || !studioEnabled()) return no("Not found.", 404);
  const op = await currentOperator();
  if (!op) return no("Sign in to Studio.", 401);
  if (!op.mfaVerified) return no("Two-factor sign-in is required.", 403);
  if (role === "platform_admin" && op.role !== "platform_admin") return no("This needs a platform admin.", 403);
  return { op };
}

export const jsonBody = async <T extends Record<string, unknown>>(req: Request): Promise<T | null> => {
  try { const b = await req.json(); return b && typeof b === "object" && !Array.isArray(b) ? (b as T) : null; } catch { return null; }
};
