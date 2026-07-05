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

export interface PodiumStep {
  /** 1, 2, or 3 — position by distinct score, not by player count. */
  rank: 1 | 2 | 3;
  score: number;
  /** All players tied at this score — they share the step (R3.4). */
  players: LeaderboardEntry[];
}

/**
 * U10/R3. The top-three podium: up to three steps by *distinct* score in
 * descending order, each holding the players tied at that score. Players who
 * scored 0 (or negative) are excluded, so a game where nobody scored yields no
 * steps (R3.3). Ties share a step and consume a rank, so [300, 200, 200] yields
 * a rank-1 and a rank-2 step with no rank-3 shown (R3.4).
 */
export function podium(standings: LeaderboardEntry[]): PodiumStep[] {
  const scored = sortStandings(standings).filter((p) => p.score > 0);
  const distinctScores = [...new Set(scored.map((p) => p.score))].slice(0, 3);
  return distinctScores.map((score, i) => ({
    rank: (i + 1) as 1 | 2 | 3,
    score,
    players: scored.filter((p) => p.score === score),
  }));
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
