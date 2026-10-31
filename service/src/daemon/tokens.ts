import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 32 random bytes as base64url (43 chars, no padding). */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** sha256 hex digest of a token; only hashes are ever persisted. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Timing-safe comparison of a presented token against a stored hash. */
export function verifyToken(token: string, hash: string): boolean {
  const a = Buffer.from(hashToken(token));
  const b = Buffer.from(hash);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
