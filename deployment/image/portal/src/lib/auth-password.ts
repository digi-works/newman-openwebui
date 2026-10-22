import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Password hashing with Node's built-in scrypt (no native dependency). Parameters follow the OWASP minimum for scrypt
 * (N=2^17, r=8, p=1). The stored string carries its own parameters, so they can be raised later without a migration.
 */
const N = 131072, R = 8, P = 1, KEYLEN = 64;

const scrypt = (pw: string, salt: Buffer, n: number, r: number, p: number) =>
  new Promise<Buffer>((resolve, reject) => {
    const opts: ScryptOptions = { N: n, r, p, maxmem: 256 * n * r };
    scryptCb(pw, salt, KEYLEN, opts, (e, key) => (e ? reject(e) : resolve(key)));
  });

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await scrypt(pw, Buffer.from(salt, "base64"), Number(n), Number(r), Number(p));
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A hash to verify against when the account does not exist, so unknown and known emails take the same time. */
let dummy: Promise<string> | undefined;
export const dummyHash = () => (dummy ??= hashPassword("not-a-real-password"));

const COMMON = new Set(["password", "password1", "123456789012", "qwertyuiop12", "welcome12345", "letmein12345", "iloveyou1234", "newmanuniversity", "changeme1234"]);

/** Returns a message if the password is not acceptable, otherwise null. */
export function passwordProblem(pw: string, email = ""): string | null {
  if (pw.length < 12) return "Use at least 12 characters.";
  if (pw.length > 200) return "That password is too long.";
  const low = pw.toLowerCase();
  if (COMMON.has(low) || /^(.)\1+$/.test(pw)) return "That password is too easy to guess.";
  const local = email.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && low.includes(local)) return "Do not include the first part of your email address (before the @) in your password.";
  return null;
}

export function temporaryPassword(): string {
  return randomBytes(12).toString("base64url");
}
