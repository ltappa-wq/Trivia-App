import { describe, expect, it } from "vitest";
import { QUESTION_COUNT_MAX, validateSetupInput } from "../gameConfig";

const valid = {
  categories: ["History", "Science"],
  questionCount: 10,
  answerMode: "multiple_choice" as const,
  difficulty: "medium" as const,
};

describe("validateSetupInput (U4)", () => {
  it("accepts a well-formed setup", () => {
    const r = validateSetupInput(valid);
    expect(r.ok).toBe(true);
  });

  it("rejects an empty category selection", () => {
    expect(validateSetupInput({ ...valid, categories: [] }).ok).toBe(false);
  });

  it("rejects an unknown category", () => {
    expect(validateSetupInput({ ...valid, categories: ["Underwater Basket Weaving"] }).ok).toBe(
      false,
    );
  });

  it("rejects a question count above the generation ceiling (KTD10)", () => {
    const r = validateSetupInput({ ...valid, questionCount: QUESTION_COUNT_MAX + 1 });
    expect(r.ok).toBe(false);
  });

  it("rejects a non-integer or zero count", () => {
    expect(validateSetupInput({ ...valid, questionCount: 0 }).ok).toBe(false);
    expect(validateSetupInput({ ...valid, questionCount: 5.5 }).ok).toBe(false);
  });

  it("rejects an unknown answer mode or difficulty", () => {
    expect(validateSetupInput({ ...valid, answerMode: "essay" }).ok).toBe(false);
    expect(validateSetupInput({ ...valid, difficulty: "impossible" }).ok).toBe(false);
  });
});
