import { createPrivateKey, sign as nodeSign, type KeyObject } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Cert } from "../release/verify";

/**
 * The only place a private signing key is touched. Callers ask a Signer to sign bytes; they never see a key.
 *
 *  - FileSigner (pilot): reads the release key from a folder mounted read-only into the Studio service only, outside the repository.
 *  - A KMS/HSM signer (production: Azure Key Vault, AWS KMS, ...) implements the same interface and is selected with STUDIO_SIGNER. The signature
 *    algorithm is ES256 (ECDSA P-256 with SHA-256) because every managed KMS offers it; Ed25519 is not universally available.
 */
export interface Signer {
  readonly keyId: string;
  readonly alg: "ES256";
  /** The release key's certificate (signed by the root), which travels with everything this key signs. */
  readonly cert: Cert;
  sign(data: Buffer): Promise<Buffer>;
}

class FileSigner implements Signer {
  readonly alg = "ES256" as const;
  constructor(readonly keyId: string, readonly cert: Cert, private key: KeyObject) {}
  async sign(data: Buffer) { return nodeSign("sha256", data, { key: this.key, dsaEncoding: "ieee-p1363" }); }
}

let cached: Signer | null = null;

export function getSigner(): Signer {
  if (cached) return cached;
  const kind = process.env.STUDIO_SIGNER || "file";
  if (kind !== "file") throw new Error(`The ${kind} signer is not configured on this platform instance.`);
  const dir = process.env.STUDIO_KEYS_DIR || "/run/keys";
  const keyFile = path.join(dir, "release.key.pem"), certFile = path.join(dir, "release.cert.json");
  if (!fs.existsSync(keyFile) || !fs.existsSync(certFile)) throw new Error("No release signing key is installed. Run the key ceremony (scripts/studio-keys.mjs).");
  const cert = JSON.parse(fs.readFileSync(certFile, "utf8")) as Cert;
  cached = new FileSigner(cert.key_id, cert, createPrivateKey(fs.readFileSync(keyFile, "utf8")));
  return cached;
}

export const signerAvailable = () => { try { getSigner(); return true; } catch { return false; } };
