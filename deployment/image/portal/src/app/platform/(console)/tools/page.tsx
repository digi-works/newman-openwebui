import { listSpecs } from "@/lib/studio/store";

export const dynamic = "force-dynamic";

const Block = ({ title, rows }: { title: string; rows: { id: string; version: number; spec: Record<string, unknown> }[] }) => (
  <section className="rounded-2xl border bg-card">
    <div className="border-b px-5 py-3.5 text-sm font-semibold">{title}</div>
    <ul className="divide-y text-sm">
      {rows.map((r) => (
        <li key={`${r.id}@${r.version}`} className="flex flex-wrap justify-between gap-2 px-5 py-3">
          <div><span className="font-mono">{r.id}</span> <span className="text-muted-foreground">v{r.version}</span><div className="text-muted-foreground">{String(r.spec.title ?? "")}{r.spec.description ? ` · ${String(r.spec.description)}` : ""}</div></div>
          {r.spec.risk ? <div className="text-muted-foreground">{String(r.spec.risk).replace("_", " ")} · needs {String(r.spec.permission)}</div> : null}
        </li>
      ))}
    </ul>
  </section>
);

/** The catalogue Workers are built from: tools, skills, policies and model profiles. Read-only here; new versions are saved through the API. */
export default async function CataloguePage() {
  const [tools, skills, policies, profiles] = await Promise.all([listSpecs("tool"), listSpecs("skill"), listSpecs("policy"), listSpecs("model_profile")]);
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Catalogue</h1>
      <p className="text-sm text-muted-foreground">Tools are bound to what a Digi stack really provides. A Worker can use only these, and a tool without a permission cannot exist.</p>
      <Block title="Tools" rows={tools} /><Block title="Skills" rows={skills} /><Block title="Policies" rows={policies} /><Block title="Model profiles" rows={profiles} />
    </div>
  );
}
