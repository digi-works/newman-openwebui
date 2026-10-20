import { notFound } from "next/navigation";
import { WorkerEditor } from "@/components/platform/worker-editor";
import { PERSONAS } from "@/lib/studio/lab";
import { getVersions, previewAuthority, reviewsFor, StudioError } from "@/lib/studio/store";

export const dynamic = "force-dynamic";

export default async function WorkerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const versions = await getVersions(id);
  if (!versions.length) notFound();
  let authority: Awaited<ReturnType<typeof previewAuthority>> | null = null, problems: string[] = [];
  try { authority = await previewAuthority(versions[0]!.spec); } catch (e) { if (e instanceof StudioError) problems = e.problems ?? [e.message]; else throw e; }
  return (
    <WorkerEditor
      workerId={id} versions={versions.map((v) => ({ version: v.version, status: v.status, source: v.source, spec: v.spec, specHash: v.spec_hash, lock: v.lock }))}
      authority={authority} problems={problems} reviews={await reviewsFor(id, versions[0]!.version)} personas={PERSONAS.map((p) => ({ key: p.key, label: p.label, role: p.role }))}
    />
  );
}
