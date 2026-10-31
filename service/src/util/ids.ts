import { randomBytes } from "node:crypto";

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** `s_` and 12 random lowercase base32 characters (60 bits). */
export function newSessionId(): string {
  let id = "s_";
  // 32 divides 256, so the low five bits of a random byte are uniform.
  for (const byte of randomBytes(12)) id += BASE32[byte & 31];
  return id;
}
