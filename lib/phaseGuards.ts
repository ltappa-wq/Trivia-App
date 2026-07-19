// Phase / lifecycle guards shared by write-side server actions.
// Keeps "when is the room answerable / challengeable / advanceable" in one
// place so review, pause, and ended locks cannot drift between actions.

import type { GameStatus } from "@/lib/db/types";

export type PhaseGame = {
  status: GameStatus;
  paused: boolean;
  reviewing: boolean;
  current_index: number;
  reveal_at: string | null;
};

/** True when a player may still submit an answer for the current question. */
export function isAnswerWindowOpen(game: PhaseGame): boolean {
  return (
    game.status === "active" &&
    !game.paused &&
    !game.reviewing &&
    game.current_index >= 0 &&
    game.reveal_at != null
  );
}

/**
 * Throws when submit must be rejected. Review is locked even if the server
 * timer has not fully elapsed (answer keys may already be revealable).
 */
export function assertCanSubmitAnswer(game: PhaseGame): void {
  if (game.status === "ended") throw new Error("This game has ended");
  if (game.status !== "active" || game.current_index < 0 || !game.reveal_at) {
    throw new Error("No active question");
  }
  if (game.paused) throw new Error("The game is paused");
  if (game.reviewing) throw new Error("Answering is locked");
}

/** Throws when a player may not raise a challenge. Spectators cannot pause play. */
export function assertCanChallenge(
  game: Pick<PhaseGame, "status" | "current_index">,
  isSpectator: boolean,
): void {
  if (isSpectator) throw new Error("Spectators can't raise challenges");
  if (game.status === "ended") throw new Error("This game has ended");
  if (game.status !== "active" || game.current_index < 0) {
    throw new Error("No active question to challenge");
  }
}

/** Statuses from which advance may leave (lobby start or live pacing). */
export const ADVANCEABLE_STATUSES: GameStatus[] = ["lobby", "active"];

export function isAdvanceableStatus(status: GameStatus): boolean {
  return status === "lobby" || status === "active";
}
