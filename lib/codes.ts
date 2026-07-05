// U4/U5/KTD7/R6. Room codes and credential tokens.
// Room codes are numeric-only and easy to read aloud / type on a phone (R6.1).
// A 5-digit numeric space is deliberately small (100k combinations), so the join
// path carries compensating safeguards (R6.2): only lobby/active games are
// joinable, an ended game's code is retired and its value recycled (partial
// unique index, KTD2), and join attempts are rate-limited (U5, joinGame). Codes
// are still drawn with cryptographic randomness — never sequential (R6.3). Host
// and player tokens are the actual write-side credentials; only the host token's
// hash is stored, matching the Postgres `encode(digest(token,'sha256'),'hex')`
// comparison in the resolve_token RPC (U2).

import { createHash, randomBytes } from "node:crypto";

// Digits only — read-aloud friendly and quick to type (R6.1).
const CODE_ALPHABET = "0123456789";
export const ROOM_CODE_LENGTH = 5;

/**
 * Generate a numeric room code using rejection sampling to avoid modulo bias.
 * The 5-digit space is small by design (R6.1); guessing is bounded by the join
 * safeguards and rate limit rather than by code entropy (R6.2, KTD2). Randomness
 * is cryptographic so individual codes stay unpredictable (R6.3).
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
