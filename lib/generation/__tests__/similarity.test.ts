import { describe, expect, it } from "vitest";
import {
  NEAR_DUPLICATE_THRESHOLD,
  contentTokens,
  isNearDuplicate,
  promptSimilarity,
} from "../similarity";

// U4 / R1 / R2 / KTD3. These pin the *decision*, not the number: every
// assertion runs against the exported threshold, so retuning it later either
// keeps the acceptance examples on the right side of the line or fails here.

const BANKED_FRANCE = "What is the capital of France?";

describe("promptSimilarity (U4, KTD3)", () => {
  it("scores identical normalized prompts as 1", () => {
    expect(promptSimilarity(BANKED_FRANCE, "what is the capital of france")).toBe(1);
  });

  it("scores fully disjoint token sets as 0", () => {
    expect(promptSimilarity("Who wrote Hamlet?", "Which planet is largest?")).toBe(0);
  });

  it("is symmetric", () => {
    const a = "Which city is France's capital?";
    expect(promptSimilarity(a, BANKED_FRANCE)).toBe(promptSimilarity(BANKED_FRANCE, a));
  });

  it("stays within 0..1 for partial overlap", () => {
    const score = promptSimilarity("Who wrote Hamlet?", "Who wrote Macbeth?");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("is unaffected by casing and punctuation", () => {
    expect(promptSimilarity("Who wrote HAMLET???", "who wrote hamlet")).toBe(1);
  });

  it("does not let a repeated word inflate the score", () => {
    // Set-based, not bag-based.
    expect(promptSimilarity("capital capital capital france", "capital france")).toBe(1);
  });
});

describe("contentTokens (U4)", () => {
  it("drops interrogative scaffolding that carries no topical signal", () => {
    expect([...contentTokens(BANKED_FRANCE)].sort()).toEqual(["capital", "france"]);
  });

  it("falls back to all tokens when a prompt is entirely stop-words", () => {
    // An empty set would score 0 against everything and wave duplicates through.
    expect(contentTokens("what is the").size).toBeGreaterThan(0);
  });
});

describe("the near-duplicate decision (U4, R1, R2)", () => {
  it("AE1: a reworded question scores above the threshold and is rejected", () => {
    const score = promptSimilarity("Which city is France's capital?", BANKED_FRANCE);
    expect(score).toBeGreaterThanOrEqual(NEAR_DUPLICATE_THRESHOLD);
    expect(isNearDuplicate("Which city is France's capital?", [BANKED_FRANCE])).toBe(true);
  });

  it("AE2: a different question with the same answer scores below and is kept", () => {
    const score = promptSimilarity("Which city hosts the Louvre?", BANKED_FRANCE);
    expect(score).toBeLessThan(NEAR_DUPLICATE_THRESHOLD);
    expect(isNearDuplicate("Which city hosts the Louvre?", [BANKED_FRANCE])).toBe(false);
  });

  it("keeps two questions that share an answer but ask about different things", () => {
    // Both answer "Shakespeare"; neither is a rewording of the other.
    expect(isNearDuplicate("Who wrote Macbeth?", ["Who wrote Hamlet?"])).toBe(false);
  });

  it("rejects a padded restatement of a banked prompt", () => {
    expect(isNearDuplicate("What is the capital city of France?", [BANKED_FRANCE])).toBe(true);
  });

  it("returns false against an empty banked list without comparing anything", () => {
    // The anchor leaves this list empty in the overwhelming majority of cases.
    expect(isNearDuplicate(BANKED_FRANCE, [])).toBe(false);
  });

  it("flags a match against any entry, not only the first", () => {
    expect(
      isNearDuplicate("Which city is France's capital?", [
        "Who wrote Hamlet?",
        "Which planet is largest?",
        BANKED_FRANCE,
      ]),
    ).toBe(true);
  });

  it("honors an explicitly passed threshold over the default", () => {
    const pair: [string, string] = ["Which city hosts the Louvre?", BANKED_FRANCE];
    expect(isNearDuplicate(pair[0], [pair[1]], 0)).toBe(true);
    expect(isNearDuplicate(pair[0], [pair[1]], 1.01)).toBe(false);
  });
});
