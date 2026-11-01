import type { ClientGame } from "@/lib/db/types";

export function autoAdvanceDeadline(game: Pick<ClientGame, "auto_advance_at">): number | null {
  const deadline = game.auto_advance_at ? Date.parse(game.auto_advance_at) : NaN;
  return Number.isFinite(deadline) ? deadline : null;
}

export function canAutoAdvance(game: ClientGame, now: number): boolean {
  const deadline = autoAdvanceDeadline(game);
  return game.status === "active" && game.reviewing && !game.paused &&
    game.current_index >= 0 && game.current_index < game.question_count - 1 &&
    game.auto_advance_ms != null && deadline !== null && now >= deadline;
}
