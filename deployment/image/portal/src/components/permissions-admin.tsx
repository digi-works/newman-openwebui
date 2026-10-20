"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Loader2, Lock, Plus, Save, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PermissionInfo, RoleRow } from "@/lib/admin-roles";
import { cn } from "@/lib/utils";

/** Roles on the left, and for the chosen role a grid of modules and actions to tick. */
export function PermissionsAdmin({ roles, catalog }: { roles: RoleRow[]; catalog: PermissionInfo[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(roles.find((r) => !r.grantsAll)?.id ?? roles[0]?.id ?? "");
  const role = roles.find((r) => r.id === selectedId) ?? roles[0];
  // unsaved edits, kept per role so switching roles does not lose them
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState(false);

  const modules = useMemo(() => {
    const m = new Map<string, PermissionInfo[]>();
    for (const p of catalog) m.set(p.module, [...(m.get(p.module) ?? []), p]);
    return [...m.entries()];
  }, [catalog]);

  if (!role) return <p className="text-sm text-muted-foreground">No roles yet.</p>;

  const current = new Set(role.grantsAll ? catalog.map((p) => p.code) : (drafts[role.id] ?? role.permissions));
  const dirty = !role.grantsAll && drafts[role.id] !== undefined && [...current].sort().join() !== [...role.permissions].sort().join();

  const toggle = (code: string) => {
    if (role.grantsAll) return;
    const next = new Set(current);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setDrafts((d) => ({ ...d, [role.id]: [...next] }));
    setNotice("");
  };
  const toggleModule = (codes: string[]) => {
    if (role.grantsAll) return;
    const next = new Set(current);
    const all = codes.every((c) => next.has(c));
    codes.forEach((c) => (all ? next.delete(c) : next.add(c)));
    setDrafts((d) => ({ ...d, [role.id]: [...next] }));
    setNotice("");
  };

  async function call(url: string, method: string, body: unknown, key: string) {
    setBusy(key); setError(""); setNotice("");
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }).catch(() => null);
    const out = res ? await res.json().catch(() => ({})) : {};
    setBusy(null);
    if (!res || !res.ok) { setError(out.error ?? "Could not complete that."); return null; }
    return out as { id?: string };
  }

  async function save() {
    const out = await call(`/api/admin/roles/${role!.id}`, "PUT", { permissions: [...current] }, "save");
    if (out) {
      setDrafts((d) => { const { [role!.id]: _gone, ...rest } = d; void _gone; return rest; });
      setNotice(`Saved. People with the ${role!.name} role get the change on their next request.`);
      router.refresh();
    }
  }

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const out = await call("/api/admin/roles", "POST", { name: f.get("name"), description: f.get("description") }, "create");
    if (out?.id) { setSelectedId(out.id); setAdding(false); router.refresh(); }
  }

  async function remove() {
    if (!confirm(`Delete the role "${role!.name}"?`)) return;
    const out = await call(`/api/admin/roles/${role!.id}`, "DELETE", undefined, "delete");
    if (out) { setSelectedId(roles.find((r) => r.id !== role!.id && !r.grantsAll)?.id ?? ""); router.refresh(); }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Permissions</h1>
        <p className="text-sm text-muted-foreground">Choose what each role can do, module by module. Then give people a role on the Users page. A person gets everything their role allows.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-[16rem_1fr]">
        <aside className="space-y-3">
          <ul className="space-y-1" aria-label="Roles">
            {roles.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => { setSelectedId(r.id); setError(""); setNotice(""); }}
                  aria-current={r.id === role.id ? "true" : undefined}
                  className={cn("flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors", r.id === role.id ? "bg-accent font-semibold text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
                >
                  <span className="flex items-center gap-1.5 truncate">{r.grantsAll && <Lock className="size-3.5 shrink-0" />}{r.name}{drafts[r.id] && <span className="size-1.5 rounded-full bg-amber-500" title="Unsaved changes" />}</span>
                  <span className="rounded-full bg-background px-2 text-xs tabular-nums ring-1 ring-border" title="People with this role">{r.userCount}</span>
                </button>
              </li>
            ))}
          </ul>
          {adding ? (
            <form onSubmit={create} className="space-y-2 rounded-xl border bg-card p-3">
              <Input name="name" required maxLength={60} placeholder="Role name" aria-label="Role name" autoFocus />
              <Input name="description" maxLength={300} placeholder="What is it for? (optional)" aria-label="Description" />
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={busy === "create"}>{busy === "create" && <Loader2 className="animate-spin" />} Create</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
              </div>
            </form>
          ) : (
            <Button variant="outline" className="w-full" onClick={() => setAdding(true)}><Plus /> New role</Button>
          )}
        </aside>

        <section className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold">{role.name}{role.isSystem && <Badge variant="outline">Built-in</Badge>}</h2>
              <p className="text-sm text-muted-foreground">{role.description || "No description."} · {role.userCount} {role.userCount === 1 ? "person" : "people"}</p>
            </div>
            <div className="flex gap-2">
              {!role.isSystem && <Button variant="outline" onClick={remove} disabled={busy !== null}><Trash2 /> Delete role</Button>}
              {!role.grantsAll && <Button onClick={save} disabled={!dirty || busy !== null}>{busy === "save" ? <Loader2 className="animate-spin" /> : <Save />} Save changes</Button>}
            </div>
          </div>

          {role.grantsAll && (
            <p className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm"><Lock className="size-4" /> The Admin role always has every permission, including ones added later, so it cannot be edited or removed.</p>
          )}
          {notice && <p role="status" className="rounded-lg border border-emerald-600/30 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-400/10 dark:text-emerald-200">{notice}</p>}
          {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

          <div className="divide-y rounded-xl border bg-card">
            {modules.map(([module, perms]) => {
              const codes = perms.map((p) => p.code);
              const allOn = codes.every((c) => current.has(c));
              return (
                <fieldset key={module} className="p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <legend className="text-sm font-semibold">{module}</legend>
                    {!role.grantsAll && <button type="button" onClick={() => toggleModule(codes)} className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">{allOn ? "Clear all" : "Select all"}</button>}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {perms.map((p) => (
                      <label key={p.code} className={cn("flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm", current.has(p.code) ? "border-primary/40 bg-accent/40" : "bg-background", role.grantsAll ? "opacity-80" : "cursor-pointer hover:bg-muted/40")}>
                        <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={current.has(p.code)} disabled={role.grantsAll} onChange={() => toggle(p.code)} />
                        <span>
                          <span className="font-medium">{p.label}</span>
                          {!p.enforced && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground" title="Saved with the role, but no screen uses it yet.">coming</span>}
                          <span className="block text-xs text-muted-foreground">{p.description}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
