import { describe, expect, it } from "vitest";
import {
  isValidCodeShape,
  normalizeCode,
  normalizeUsername,
  seatForStatus,
  USERNAME_MAX,
  validateUsername,
} from "../join";

describe("code + username normalization (U5)", () => {
  it("trims and strips non-digits from the code (R6.1)", () => {
    expect(normalizeCode(" 01 234 ")).toBe("01234");
    expect(normalizeCode("04213")).toBe("04213");
  });

  it("collapses whitespace in usernames", () => {
    expect(normalizeUsername("  Sir   Reginald  ")).toBe("Sir Reginald");
  });

  it("validates username length bounds", () => {
    expect(validateUsername("").ok).toBe(false);
    expect(validateUsername("a").ok).toBe(true);
    expect(validateUsername("x".repeat(USERNAME_MAX)).ok).toBe(true);
    expect(validateUsername("x".repeat(USERNAME_MAX + 1)).ok).toBe(false);
  });

  it("recognizes a well-shaped 5-digit numeric code (R6.1)", () => {
    expect(isValidCodeShape("01234")).toBe(true);
    expect(isValidCodeShape("ABCDE")).toBe(false); // letters
    expect(isValidCodeShape("1234")).toBe(false); // too short
    expect(isValidCodeShape("123456")).toBe(false); // too long
    expect(isValidCodeShape("12 34")).toBe(false); // space
  });
});

describe("seatForStatus — mid-game join rule (U5)", () => {
  it("seats a full player in the lobby", () => {
    expect(seatForStatus("lobby")).toEqual({ canJoin: true, isSpectator: false });
  });

  it("seats a next-question spectator once active (score 0, not retroactive)", () => {
    const seat = seatForStatus("active");
    expect(seat.canJoin).toBe(true);
    expect(seat.isSpectator).toBe(true);
  });

  it("rejects joining an ended game", () => {
    const seat = seatForStatus("ended");
    expect(seat.canJoin).toBe(false);
    expect(seat.reason).toBeTruthy();
  });
});
