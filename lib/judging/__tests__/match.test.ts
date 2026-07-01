import { describe, expect, it } from "vitest";
import {
  allowedEdits,
  boundedLevenshtein,
  judgeMultipleChoice,
  judgeTypeAnswer,
  normalize,
} from "../match";

describe("normalize", () => {
  it("lowercases, trims, strips accents and punctuation", () => {
    expect(normalize("  Café! ")).toBe("cafe");
    expect(normalize("O'Brien")).toBe("obrien");
    expect(normalize("John   Kennedy")).toBe("john kennedy");
  });
});

describe("boundedLevenshtein", () => {
  it("computes small distances and short-circuits over budget", () => {
    expect(boundedLevenshtein("kenedy", "kennedy", 2)).toBe(1);
    expect(boundedLevenshtein("cat", "dog", 1)).toBe(2); // returns max+1 when over
  });
});

describe("judgeMultipleChoice (R9)", () => {
  it("is an exact option-index match", () => {
    expect(judgeMultipleChoice(2, 2)).toBe(true);
    expect(judgeMultipleChoice(1, 2)).toBe(false);
    expect(judgeMultipleChoice(-1, 2)).toBe(false);
  });
});

describe("judgeTypeAnswer (R9, AE1)", () => {
  it("matches an exact accepted variant", () => {
    expect(judgeTypeAnswer("Paris", ["paris"])).toBe(true);
  });

  it("fuzzy-matches a near-miss typo (kenedy -> kennedy) (AE1)", () => {
    expect(judgeTypeAnswer("kenedy", ["kennedy", "john kennedy"])).toBe(true);
  });

  it("matches a multi-word variant ignoring case and spacing", () => {
    expect(judgeTypeAnswer("John  Kennedy", ["kennedy", "john kennedy"])).toBe(true);
  });

  it("does not fuzzy-collide distinct short words (cat vs bat)", () => {
    expect(judgeTypeAnswer("bat", ["cat"])).toBe(false);
  });

  it("rejects an empty or clearly wrong answer", () => {
    expect(judgeTypeAnswer("", ["paris"])).toBe(false);
    expect(judgeTypeAnswer("london", ["paris"])).toBe(false);
  });
});

describe("allowedEdits", () => {
  it("scales the fuzz budget with word length", () => {
    expect(allowedEdits(3)).toBe(0);
    expect(allowedEdits(7)).toBe(1);
    expect(allowedEdits(12)).toBe(2);
  });
});
