// U4/U5/KTD7. Room codes and credential tokens.
// Room codes are the (guessable-if-weak) join key, so they use a high-entropy,
// unambiguous alphabet and cryptographic randomness — never sequential. Host and
// player tokens are the actual write-side credentials; only the host token's
// hash is stored, matching the Postgres `encode(digest(token,'sha256'),'hex')`
// comparison in the resolve_token RPC (U2).

import { createHash, randomBytes } from "node:crypto";

// No I/L/O/0/1 — unambiguous when read aloud or off a shared screen.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;

/**
 * Generate a room code from the unambiguous alphabet using rejection sampling to
 * avoid modulo bias. ≥6 chars over a 31-symbol alphabet is unguessable enough
 * that active games can't be practically enumerated (KTD7); join attempts are
 * additionally rate-limited (U5).
 */
export function generateRoomCode(length: number = ROOM_CODE_LENGTH): string {
  const alphabetLen = CODE_ALPHABET.length;
  // Largest multiple of alphabetLen that fits in a byte; values at or above it
  // are rejected so every symbol is equally likely.
  const ceiling = Math.floor(256 / alphabetLen) * alphabetLen;
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= ceiling) continue;
      out += CODE_ALPHABET[byte % alphabetLen];
      if (out.length === length) break;
    }
  }
  return out;
}

/** High-entropy, URL-safe credential token (host or player). */
export function generateToken(byteLength: number = 32): string {
  return randomBytes(byteLength).toString("base64url");
}

/** SHA-256 hex digest — must match the Postgres digest used by resolve_token. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
