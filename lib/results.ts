// U9. Final standings (R15). Pure ranking helpers so tie/co-winner behavior is
// unit-testable independent of the DB. A tie at the top yields co-winners rather
// than an arbitrary single winner; a game where no one scored has no winner.

import type { LeaderboardEntry } from "@/lib/db/types";

export function sortStandings(players: LeaderboardEntry[]): LeaderboardEntry[] {
  return [...players].sort((a, b) => b.score - a.score);
}

/** Players tied for the top score. Empty when no one scored (top <= 0). */
export function winners(players: LeaderboardEntry[]): LeaderboardEntry[] {
  if (players.length === 0) return [];
  const top = Math.max(...players.map((p) => p.score));
  if (top <= 0) return [];
  return players.filter((p) => p.score === top);
}
