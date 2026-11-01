import type { LeaderboardEntry } from "@/lib/db/types";

/** Dense ranks match the podium: equal scores share a rank and a step. */
export function rankedStandings(entries: LeaderboardEntry[]) {
  const scores = [...new Set(entries.map((p) => p.score))].sort((a, b) => b - a);
  const ranks = new Map(scores.map((score, i) => [score, i + 1]));
  return [...entries].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .map((p) => ({ ...p, rank: ranks.get(p.score)! }));
}

/** Build movement for the entire board with one baseline ranking pass. */
export function rankDeltas(current: ReturnType<typeof rankedStandings>, previous: LeaderboardEntry[] | null) {
  const before = new Map(previous ? rankedStandings(previous).map((p) => [p.id, p.rank]) : []);
  return new Map(current.map((p) => {
    const previousRank = before.get(p.id);
    return [p.id, previousRank === undefined ? null : previousRank - p.rank] as const;
  }));
}

export function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

export function rankMovement(current: LeaderboardEntry[], previous: LeaderboardEntry[] | null, id: string) {
  const rank = rankedStandings(current).find((p) => p.id === id)?.rank;
  if (rank === undefined) return null;
  const before = previous && rankedStandings(previous).find((p) => p.id === id)?.rank;
  return { rank, delta: typeof before === "number" ? before - rank : null };
}

export interface RoundSnapshot {
  index: number;
  baseline: LeaderboardEntry[] | null;
  completed: LeaderboardEntry[] | null;
}

/** Never use an in-progress score as a baseline. Missing/skipped history is unknown.
 * Re-review after adjudication keeps the baseline and replaces the completed score. */
export function observeRound(previous: RoundSnapshot | null, index: number,
  phase: string, standings: LeaderboardEntry[]): RoundSnapshot {
  const same = previous?.index === index;
  let baseline = same ? previous.baseline :
    previous?.index === index - 1 ? previous.completed : null;
  if (phase === "lobby" || phase === "get_ready") baseline = standings;
  return { index, baseline, completed: phase === "review" || phase === "lobby" ? standings : same ? previous.completed : null };
}

export function recapText(points: number, movement: ReturnType<typeof rankMovement>, voided: boolean): string {
  const gain = voided ? "Question voided · No points this round" : points > 0 ? `+${points.toLocaleString("en-US")} pts` : "No points this round";
  if (!movement) return gain;
  const { rank, delta } = movement;
  const place = delta === 0 ? `Still ${ordinal(rank)}` : `now ${ordinal(rank)}`;
  return `${gain} · ${place}${delta ? ` (${delta > 0 ? "↑" : "↓"}${Math.abs(delta)})` : ""}`;
}
