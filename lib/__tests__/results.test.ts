import { describe, expect, it } from "vitest";
import { sortStandings, winners } from "../results";
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
