import { describe, expect, it } from "vitest";
import { normalizeAnswer, normalizePrompt } from "../dedup";
import { correctAnswerKeys } from "../schema";

describe("normalizePrompt (R7.2, KTD4)", () => {
  it("is case-insensitive", () => {
    expect(normalizePrompt("What is the CAPITAL of France")).toBe(
      normalizePrompt("what is the capital of france"),
    );
  });

  it("ignores punctuation and trailing question marks", () => {
    expect(normalizePrompt("What is the capital of France?")).toBe(
      normalizePrompt("What is the capital of France"),
    );
  });

  it("collapses and trims whitespace", () => {
    expect(normalizePrompt("  what   is  the   capital?  ")).toBe("what is the capital");
  });

  it("treats cosmetic variants of the same prompt as equal", () => {
    const a = normalizePrompt("Who wrote 'Hamlet'?");
    const b = normalizePrompt("who wrote hamlet");
    expect(a).toBe(b);
  });

  it("keeps genuinely different prompts distinct", () => {
    expect(normalizePrompt("Capital of France?")).not.toBe(
      normalizePrompt("Capital of Spain?"),
    );
  });

  it("preserves alphanumeric content including digits", () => {
    expect(normalizePrompt("What year was 1984 published?")).toBe(
      "what year was 1984 published",
    );
  });
});

describe("normalizeAnswer / correctAnswerKeys", () => {
  it("normalizes answer text like prompts", () => {
    expect(normalizeAnswer("  Paris! ")).toBe("paris");
  });

  it("extracts the MC correct option key", () => {
    expect(
      correctAnswerKeys({
        prompt: "q",
        mode: "multiple_choice",
        options: ["Paris", "Lyon", "Nice", "Rome"],
        correct_option: 0,
        difficulty: "easy",
      }),
    ).toEqual(["paris"]);
  });

  it("extracts all type-answer variants", () => {
    const keys = correctAnswerKeys({
      prompt: "q",
      mode: "type_answer",
      accepted_variants: ["Kennedy", "john kennedy"],
      difficulty: "easy",
    });
    expect(keys).toContain("kennedy");
    expect(keys).toContain("john kennedy");
  });
});
