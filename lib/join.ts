// U5. Pure join-flow helpers: code/username normalization and the mid-game
// seating rule. Kept separate from the DB-touching joinGame action so the
// rules are unit-testable without a live database.

import type { GameStatus } from "@/lib/db/types";
import { ROOM_CODE_LENGTH } from "@/lib/codes";

export const USERNAME_MAX = 20;

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export function normalizeUsername(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export type UsernameValidation = { ok: true } | { ok: false; error: string };

export function validateUsername(name: string): UsernameValidation {
  if (name.length === 0) return { ok: false, error: "Enter a username" };
  if (name.length > USERNAME_MAX) {
    return { ok: false, error: `Username must be ${USERNAME_MAX} characters or fewer` };
  }
  return { ok: true };
}

export function isValidCodeShape(code: string): boolean {
  return new RegExp(`^[A-Z0-9]{${ROOM_CODE_LENGTH}}$`).test(code);
}

export interface Seat {
  canJoin: boolean;
  isSpectator: boolean;
  reason?: string;
}

/**
 * Mid-game join rule (U5): a valid code before start seats a full player; after
 * start seats a next-question spectator at score 0 (not rejected, not
 * retroactively scored); an ended game rejects.
 */
export function seatForStatus(status: GameStatus): Seat {
  switch (status) {
    case "lobby":
      return { canJoin: true, isSpectator: false };
    case "active":
      return { canJoin: true, isSpectator: true };
    case "ended":
    default:
      return { canJoin: false, isSpectator: false, reason: "This game has already ended" };
  }
}
