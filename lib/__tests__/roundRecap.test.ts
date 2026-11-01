import { describe, expect, it } from "vitest";
import { observeRound, rankedStandings, rankDeltas, rankMovement, recapText, ordinal } from "../roundRecap";
const entries = (scores: number[]) => scores.map((score, i) => ({ id: String(i), username: `P${i}`, score }));

describe("round ranks and recap", () => {
  it("shares dense ranks for ties without mutating the input", () => {
    const players = entries([100, 300, 300, 200]);
    expect(rankedStandings(players).map((p) => [p.id, p.rank])).toEqual([["1", 1], ["2", 1], ["3", 2], ["0", 3]]);
    expect(players[0].score).toBe(100);
  });
  it("computes positive, negative, unchanged and unknown movement", () => {
    const before = entries([500, 400, 300]);
    const after = entries([500, 400, 900]);
    expect(rankMovement(after, before, "2")).toEqual({ rank: 1, delta: 2 });
    expect(rankMovement(after, before, "0")).toEqual({ rank: 2, delta: -1 });
    expect(rankMovement(before, before, "0")).toEqual({ rank: 1, delta: 0 });
    expect(rankMovement(after, null, "2")).toEqual({ rank: 1, delta: null });
    expect(rankMovement(after, before, "spectator")).toBeNull();
  });
  it("builds all deltas with shared ranks for ties and unknown history", () => {
    const before = entries([500, 400, 400, 300]);
    const current = rankedStandings([...entries([500, 500, 400, 700]),
      { id: "new", username: "New", score: 400 }]);
    expect([...rankDeltas(current, before)]).toEqual([
      ["3", 2], ["0", -1], ["1", 0], ["2", -1], ["new", null],
    ]);
    expect([...rankDeltas(current, null).values()]).toEqual([null, null, null, null, null]);
  });
  it("formats gains, unchanged placement, voids and absent history", () => {
    expect(recapText(850, { rank: 3, delta: 2 }, false)).toBe("+850 pts · now 3rd (↑2)");
    expect(recapText(0, { rank: 1, delta: 0 }, false)).toBe("No points this round · Still 1st");
    expect(recapText(850, { rank: 2, delta: -1 }, true)).toBe("Question voided · No points this round · now 2nd (↓1)");
    expect(recapText(0, { rank: 1, delta: null }, false)).toBe("No points this round · now 1st");
    expect([11, 12, 13, 21, 22, 23].map(ordinal)).toEqual(["11th", "12th", "13th", "21st", "22nd", "23rd"]);
  });
});

describe("snapshot history", () => {
  const before = entries([500, 400]);
  const after = entries([500, 1250]);
  it("does not invent a baseline on a live or review reload", () => {
    let snapshot = observeRound(null, 3, "question", after);
    expect(snapshot.baseline).toBeNull();
    snapshot = observeRound(snapshot, 3, "review", after);
    expect(snapshot.baseline).toBeNull();
    expect(observeRound(null, 3, "review", after).baseline).toBeNull();
  });
  it("ignores live updates and preserves the baseline across review and adjudication", () => {
    let snapshot = observeRound(null, 0, "get_ready", before);
    snapshot = observeRound(snapshot, 0, "question", after);
    snapshot = observeRound(snapshot, 0, "review", after);
    expect(snapshot.baseline).toEqual(before);
    snapshot = observeRound(snapshot, 0, "paused", after);
    snapshot = observeRound(snapshot, 0, "review", before); // void/reversal
    expect(snapshot.baseline).toEqual(before);
    expect(rankMovement(before, snapshot.baseline, "0")?.delta).toBe(0);
    snapshot = observeRound(snapshot, 0, "review", after); // upheld answer
    expect(rankMovement(after, snapshot.baseline, "1")?.delta).toBe(1);
    expect(snapshot.completed).toEqual(after);
  });
  it("carries the latest reviewed score to the next question but drops skipped history", () => {
    const snapshot = observeRound(null, 2, "review", after);
    expect(observeRound(snapshot, 3, "question", after).baseline).toEqual(after);
    expect(observeRound(snapshot, 4, "review", after).baseline).toBeNull();
  });
});
