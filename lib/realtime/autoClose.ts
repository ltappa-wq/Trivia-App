import type { ClientGame } from "@/lib/db/types";
import { ANSWER_TIMER_MS } from "@/lib/gameConfig";
import { isAnswerWindowOpen } from "@/lib/phaseGuards";

export type AutoCloseGame = Pick<ClientGame, "status" | "paused" | "reviewing" | "current_index" | "reveal_at" | "answer_mode">;

/** Matches close_question in migration 0015; lets in-flight answers finish. */
export const AUTO_CLOSE_GRACE_MS = 750;
export const AUTO_CLOSE_MAX_ATTEMPTS = 6;
export const AUTO_CLOSE_RETRY_MS = 1000;

export function autoCloseDeadline(game: Pick<ClientGame, "reveal_at" | "answer_mode">): number | null {
  if (!game.reveal_at) return null;
  const reveal = Date.parse(game.reveal_at);
  return Number.isFinite(reveal) ? reveal + ANSWER_TIMER_MS[game.answer_mode] + AUTO_CLOSE_GRACE_MS : null;
}

export function canAutoClose(game: AutoCloseGame, now: number): boolean {
  const deadline = autoCloseDeadline(game);
  return isAnswerWindowOpen(game) && deadline !== null && now >= deadline;
}
