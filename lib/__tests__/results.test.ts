import { describe, expect, it } from "vitest";
import { podium, sortStandings, winners } from "../results";
import type { LeaderboardEntry } from "@/lib/db/types";

const mk = (id: string, username: string, score: number): LeaderboardEntry => ({
  id,
  username,
  score,
});

describe("sortStandings (R15)", () => {
  it("orders players by score descending", () => {
    const sorted = sortStandings([mk("a", "A", 100), mk("b", "B", 300), mk("c", "C", 200)]);
    expect(sorted.map((p) => p.id)).toEqual(["b", "c", "a"]);
  });

  it("does not mutate the input", () => {
    const input = [mk("a", "A", 100), mk("b", "B", 300)];
    sortStandings(input);
    expect(input.map((p) => p.id)).toEqual(["a", "b"]);
  });
});

describe("winners (R15)", () => {
  it("returns the single top scorer", () => {
    const w = winners([mk("a", "A", 100), mk("b", "B", 300), mk("c", "C", 200)]);
    expect(w.map((p) => p.id)).toEqual(["b"]);
  });

  it("returns co-winners on a tie at the top", () => {
    const w = winners([mk("a", "A", 300), mk("b", "B", 300), mk("c", "C", 200)]);
    expect(w.map((p) => p.id).sort()).toEqual(["a", "b"]);
  });

  it("returns no winner when nobody scored", () => {
    expect(winners([mk("a", "A", 0), mk("b", "B", 0)])).toEqual([]);
  });

  it("returns no winner for an empty game", () => {
    expect(winners([])).toEqual([]);
  });
});

describe("podium (R3)", () => {
  it("returns three single-player steps for three distinct scores", () => {
    const steps = podium([mk("a", "A", 100), mk("b", "B", 300), mk("c", "C", 200)]);
    expect(steps.map((s) => [s.rank, s.players.map((p) => p.id)])).toEqual([
      [1, ["b"]],
      [2, ["c"]],
      [3, ["a"]],
    ]);
  });

  it("shares a step for a tie and skips the step below (R3.4)", () => {
    // Two tied for 2nd -> both on rank 2, no rank 3.
    const steps = podium([mk("a", "A", 300), mk("b", "B", 200), mk("c", "C", 200)]);
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ rank: 1, score: 300 });
    expect(steps[1].rank).toBe(2);
    expect(steps[1].players.map((p) => p.id).sort()).toEqual(["b", "c"]);
  });

  it("shares the top step for a tie at first, then the next distinct score", () => {
    const steps = podium([mk("a", "A", 300), mk("b", "B", 300), mk("c", "C", 200)]);
    expect(steps[0].rank).toBe(1);
    expect(steps[0].players.map((p) => p.id).sort()).toEqual(["a", "b"]);
    expect(steps[1]).toMatchObject({ rank: 2, score: 200 });
  });

  it("returns only populated steps with fewer than three scoring players (R3.3)", () => {
    const steps = podium([mk("a", "A", 100), mk("b", "B", 50)]);
    expect(steps.map((s) => s.rank)).toEqual([1, 2]);
  });

  it("returns no steps when nobody scored (R3.3)", () => {
    expect(podium([mk("a", "A", 0), mk("b", "B", 0)])).toEqual([]);
    expect(podium([])).toEqual([]);
  });

  it("keeps only the top three distinct score-ranks", () => {
    const steps = podium([
      mk("a", "A", 500),
      mk("b", "B", 400),
      mk("c", "C", 300),
      mk("d", "D", 200),
    ]);
    expect(steps.map((s) => s.score)).toEqual([500, 400, 300]);
  });
});
