import { canonicalJson, sha256Hex } from "../release/common";
import { trustedRoots } from "../release/trust";
import { bundleBody, revocationListBody, validRevokedKeys, verifyBundle, type Bundle, type KeyRevocation, type RevocationList } from "../release/verify";
import type { Operator } from "./auth";
import { sq, stx, studioAudit } from "./db";
import { findForbiddenContent, SCHEMAS } from "./specs";
import { getSigner } from "./signer";
import { StudioError } from "./store";

/**
 * Releases (ST.6): a signed bundle of published Worker versions and exactly the specs they were locked to. A bundle is product definition only:
 * never a secret, a customer, a role mapping, an endpoint or any data (checked before signing, and again by every stack that installs it).
 * Every signing is audited. Revocation of a release or a key is published as a signed list that stacks fetch.
 */
export type ReleaseInput = { workers: { worker_id: string; version: number }[]; channel: "stable" | "preview"; notes?: string; securityCritical?: boolean; digiMinVersion?: string };

export async function createRelease(op: Operator, input: ReleaseInput): Promise<{ release_id: string; seq: number; digest: string }> {
  if (!input.workers.length) throw new StudioError("Choose at least one published Worker version.");
  const signer = getSigner();
  return stx(async (c) => {
    const files: Record<string, unknown> = {};
    const workers: Record<string, unknown>[] = [];
    const lockWorkers: Record<string, unknown> = {};
    const caps = new Set<string>(["chat"]);
    const requiredTools: Record<string, number> = {}, requiredProfiles: Record<string, number> = {};

    for (const w of input.workers) {
      const v = (await c.query("select spec, spec_hash, lock, status from studio_worker_versions where worker_id = $1 and version = $2", [w.worker_id, w.version])).rows[0];
      if (!v) throw new StudioError(`Worker ${w.worker_id} version ${w.version} does not exist.`, 404);
      if (v.status !== "published") throw new StudioError(`Worker ${w.worker_id} version ${w.version} is ${v.status}; only published versions can be released.`, 409);
      files[`workers/${w.worker_id}.json`] = v.spec;
      lockWorkers[w.worker_id] = { version: w.version, spec_hash: v.spec_hash, lock: v.lock };
      workers.push({ id: w.worker_id, version: w.version, name: v.spec.name, description: v.spec.description });
      for (const cap of (v.spec.required_runtime_capabilities ?? []) as string[]) caps.add(cap);
      const lock = v.lock as { tools: { id: string; version: number }[]; skills: { id: string; version: number }[]; policies: { id: string; version: number }[]; model_profile: { id: string; version: number } };
      const grab = async (table: string, folder: string, r: { id: string; version: number }) => {
        const row = (await c.query(`select spec from ${table} where id = $1 and version = $2`, [r.id, r.version])).rows[0];
        if (!row) throw new StudioError(`Locked dependency ${r.id}@${r.version} is missing.`, 500);
        files[`${folder}/${r.id}.json`] = row.spec;
      };
      for (const t of lock.tools) { await grab("studio_tools", "tool-requirements", t); requiredTools[t.id] = t.version; }
      for (const s of lock.skills) await grab("studio_skills", "skills", s);
      for (const p of lock.policies) await grab("studio_policies", "policies", p);
      await grab("studio_model_profiles", "model-requirements", lock.model_profile); requiredProfiles[lock.model_profile.id] = lock.model_profile.version;
    }
    files["schemas/specs.schema.json"] = SCHEMAS;

    const seq = Number((await c.query("select nextval(pg_get_serial_sequence('studio_releases', 'seq')) as n")).rows[0].n);
    const release_id = `r-${String(seq).padStart(4, "0")}`;
    // releases older than the newest security-critical one must not be activated (anti-rollback)
    const prev = Number((await c.query("select coalesce(max(seq), 0) as n from studio_releases where security_critical")).rows[0].n);
    const manifest = {
      release_id, seq, channel: input.channel, created_at: new Date().toISOString(), digi_min_version: input.digiMinVersion ?? "0.1.0",
      security_critical: !!input.securityCritical, grace_days: input.securityCritical ? 7 : 0, min_allowed_seq: input.securityCritical ? seq : prev,
      notes: (input.notes ?? "").slice(0, 2000), runtime_capabilities: [...caps].sort(), required_tools: requiredTools, required_model_profiles: requiredProfiles, workers,
    };
    const lock = { schema_version: 1, workers: lockWorkers };
    const body: Pick<Bundle, "format" | "manifest" | "files" | "lock"> = { format: 1, manifest, files, lock };

    const forbidden = findForbiddenContent({ manifest, lock, files: Object.fromEntries(Object.entries(files).filter(([k]) => !k.startsWith("schemas/"))) });
    if (forbidden.length) throw new StudioError("This release would contain something a release must never hold.", 400, forbidden);

    const canon = bundleBody(body);
    const sigBytes = await signer.sign(Buffer.from(canon));
    const signature = { alg: signer.alg, key_id: signer.keyId, digest: sha256Hex(canon), signature: sigBytes.toString("base64"), signed_at: new Date().toISOString(), cert: signer.cert };
    const bundle: Bundle = { ...body, signature };

    // never store something that this very platform would refuse to install
    const self = verifyBundle(bundle, { roots: trustedRoots() });
    if (!self.ok) throw new StudioError(`The signed bundle failed its own verification: ${self.reason}`, 500);

    await c.query(
      `insert into studio_releases (seq, release_id, channel, security_critical, notes, digi_min_version, manifest, bundle, digest, signature, key_id, created_by)
       overriding system value values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [seq, release_id, input.channel, !!input.securityCritical, manifest.notes, manifest.digi_min_version, JSON.stringify(manifest), JSON.stringify(bundle), signature.digest, JSON.stringify(signature), signer.keyId, op.id],
    );
    await studioAudit({ operatorId: op.id, action: "release.sign", entityType: "release", entityId: release_id, metadata: { key_id: signer.keyId, digest: signature.digest, workers: workers.map((w) => `${w.id}@${w.version}`), channel: input.channel, security_critical: !!input.securityCritical } }, c);
    return { release_id, seq, digest: signature.digest };
  });
}

export async function listReleases() {
  return sq<{ release_id: string; seq: number; channel: string; status: string; security_critical: boolean; notes: string; manifest: Record<string, unknown>; digest: string; key_id: string; signed_at: string }>(
    "select release_id, seq, channel, status, security_critical, notes, manifest, digest, key_id, signed_at from studio_releases order by seq desc");
}

export async function getBundle(releaseId: string): Promise<Bundle | null> {
  return (await sq<{ bundle: Bundle }>("select bundle from studio_releases where release_id = $1 and status = 'signed'", [releaseId]))[0]?.bundle ?? null;
}

/** The newest release a stack on this channel may install (preview stacks also see stable ones). */
export async function latestRelease(channel: string) {
  const channels = channel === "preview" ? ["stable", "preview"] : ["stable"];
  return (await sq<{ release_id: string; seq: number; security_critical: boolean; notes: string; manifest: Record<string, unknown>; signed_at: string; digest: string }>(
    "select release_id, seq, security_critical, notes, manifest, signed_at, digest from studio_releases where status = 'signed' and channel = any($1) order by seq desc limit 1", [channels]))[0] ?? null;
}

export async function revokeRelease(op: Operator, releaseId: string, reason: string) {
  await stx(async (c) => {
    const r = await c.query("update studio_releases set status = 'revoked' where release_id = $1 and status = 'signed'", [releaseId]);
    if (!r.rowCount) throw new StudioError("That release does not exist or is already revoked.", 404);
    await c.query("insert into studio_revocations (kind, ref, reason, revoked_by) values ('release', $1, $2, $3) on conflict do nothing", [releaseId, reason.slice(0, 500), op.id]);
    await studioAudit({ operatorId: op.id, action: "release.revoke", entityType: "release", entityId: releaseId, metadata: { reason } }, c);
  });
}

/** A key revocation made at the root ceremony. It is verified against the trusted root here too, so a forged entry cannot be stored. */
export async function importKeyRevocation(op: Operator, entry: KeyRevocation) {
  if (!validRevokedKeys([entry], trustedRoots()).has(entry.key_id)) throw new StudioError("That revocation is not signed by a trusted root.", 400);
  await stx(async (c) => {
    await c.query("insert into studio_revocations (kind, ref, reason, revoked_by, entry) values ('key', $1, $2, $3, $4) on conflict (kind, ref) do nothing", [entry.key_id, entry.reason, op.id, JSON.stringify(entry)]);
    await studioAudit({ operatorId: op.id, action: "key.revoke.import", entityType: "key", entityId: entry.key_id }, c);
  });
}

/** The signed revocation list stacks fetch. Signed by the current release key; key revocations inside it carry their own root signatures. */
export async function currentRevocationList(): Promise<RevocationList> {
  const releases = await sq<{ ref: string; reason: string; revoked_at: string }>("select ref, reason, revoked_at from studio_revocations where kind = 'release' order by id");
  const keys = await sq<{ entry: KeyRevocation }>("select entry from studio_revocations where kind = 'key' and entry is not null order by id");
  const base = {
    issued_at: new Date().toISOString(),
    releases: releases.map((r) => ({ release_id: r.ref, reason: r.reason, revoked_at: new Date(r.revoked_at).toISOString() })),
    keys: keys.map((k) => k.entry),
  };
  const signer = getSigner();
  const sig = await signer.sign(Buffer.from(revocationListBody(base)));
  return { ...base, signature: { key_id: signer.keyId, signature: sig.toString("base64"), cert: signer.cert } };
}

export { canonicalJson };
