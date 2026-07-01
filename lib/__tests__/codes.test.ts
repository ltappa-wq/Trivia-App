import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateRoomCode, generateToken, hashToken, ROOM_CODE_LENGTH } from "../codes";

describe("generateRoomCode (KTD7)", () => {
  it("is the configured length and uses only the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode();
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      // No ambiguous glyphs (I, L, O, 0, 1) and no lowercase.
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/);
    }
  });

  it("is effectively unique across many draws (high entropy, not sequential)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateRoomCode());
    // Collisions in 1000 draws over 31^6 space should be vanishingly unlikely.
    expect(seen.size).toBeGreaterThan(995);
  });
});

describe("token helpers (KTD7)", () => {
  it("generates distinct high-entropy url-safe tokens", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toEqual(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
    expect(a.length).toBeGreaterThanOrEqual(40);
  });

  it("hashToken matches the Postgres sha256 hex digest used by resolve_token", () => {
    const token = "example-token";
    const expected = createHash("sha256").update(token).digest("hex");
    expect(hashToken(token)).toBe(expected);
    // 64 hex chars — same shape stored in games.host_token_hash.
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});
