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

/**
 * Winner summary for the results views (host + player): the set of winner ids to
 * highlight, and a banner label (null when nobody scored). Computed once so the
 * host and player screens don't each re-derive it.
 */
export function describeWinners(standings: LeaderboardEntry[]): {
  winnerIds: Set<string>;
  label: string | null;
} {
  const champs = winners(standings);
  const winnerIds = new Set(champs.map((w) => w.id));
  const label =
    champs.length === 0
      ? null
      : `${champs.length > 1 ? "Co-winners" : "Winner"}: ${champs.map((w) => w.username).join(", ")}`;
  return { winnerIds, label };
}
