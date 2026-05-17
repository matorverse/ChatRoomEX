import { pbkdf2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const pbkdf2Async = promisify(pbkdf2);
const iterations = 210_000;
const keyLength = 32;
const digest = "sha256";

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const derived = await pbkdf2Async(password, salt, iterations, keyLength, digest);
  return `pbkdf2:${iterations}:${salt}:${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [scheme, rawIterations, salt, hash] = encoded.split(":");
  if (scheme !== "pbkdf2" || !rawIterations || !salt || !hash) return false;

  const derived = await pbkdf2Async(password, salt, Number(rawIterations), keyLength, digest);
  const expected = Buffer.from(hash, "base64url");
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}
