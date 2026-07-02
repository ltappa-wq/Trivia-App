import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateRoomCode, generateToken, hashToken, ROOM_CODE_LENGTH } from "../codes";

describe("generateRoomCode (KTD7, R6)", () => {
  it("is exactly 5 digits, numeric only (R6.1)", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode();
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect(ROOM_CODE_LENGTH).toBe(5);
      expect(code).toMatch(/^[0-9]+$/);
    }
  });

  it("draws roughly uniformly across the digit alphabet (not sequential, R6.3)", () => {
    // Over many draws every digit should appear — a sequential or biased
    // generator would leave gaps.
    const digits = new Set<string>();
    for (let i = 0; i < 500; i++) {
      for (const ch of generateRoomCode()) digits.add(ch);
    }
    expect(digits.size).toBe(10);
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
