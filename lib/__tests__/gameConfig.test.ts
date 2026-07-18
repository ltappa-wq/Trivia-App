import { describe, expect, it } from "vitest";
import {
  CUSTOM_CATEGORY_MAX_COUNT,
  isValidCategory,
  QUESTION_COUNT_MAX,
  validateSetupInput,
} from "../gameConfig";

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

  it("accepts a custom free-text category", () => {
    const r = validateSetupInput({
      ...valid,
      categories: ["Underwater Basket Weaving"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.categories).toEqual(["Underwater Basket Weaving"]);
  });

  it("rejects an empty or overlong custom category", () => {
    expect(validateSetupInput({ ...valid, categories: ["   "] }).ok).toBe(false);
    expect(
      validateSetupInput({ ...valid, categories: ["x".repeat(80)] }).ok,
    ).toBe(false);
  });

  it("rejects too many custom categories", () => {
    const customs = Array.from({ length: CUSTOM_CATEGORY_MAX_COUNT + 1 }, (_, i) => `Custom ${i}`);
    expect(validateSetupInput({ ...valid, categories: customs }).ok).toBe(false);
  });

  it("rejects a question count above the generation ceiling", () => {
    const r = validateSetupInput({ ...valid, questionCount: QUESTION_COUNT_MAX + 1 });
    expect(r.ok).toBe(false);
  });

  it("accepts the full question-count ceiling (100)", () => {
    const r = validateSetupInput({ ...valid, questionCount: QUESTION_COUNT_MAX });
    expect(r.ok).toBe(true);
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

describe("isValidCategory", () => {
  it("accepts built-ins and reasonable custom labels", () => {
    expect(isValidCategory("Sports")).toBe(true);
    expect(isValidCategory("  90s cartoons ")).toBe(true);
  });

  it("rejects blank or control-laden labels", () => {
    expect(isValidCategory("")).toBe(false);
    expect(isValidCategory("bad\nname")).toBe(false);
  });
});
