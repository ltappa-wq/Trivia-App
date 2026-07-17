import { describe, expect, it } from "vitest";
import {
  CATEGORY_MAX_LEN,
  MAX_CATEGORIES,
  QUESTION_COUNT_MAX,
  isPresetCategory,
  validateSetupInput,
} from "../gameConfig";

const valid = {
  categories: ["History", "Science"],
  questionCount: 10,
  answerMode: "multiple_choice" as const,
  difficulty: "medium" as const,
};

describe("validateSetupInput", () => {
  it("accepts a well-formed setup with presets", () => {
    const r = validateSetupInput(valid);
    expect(r.ok).toBe(true);
  });

  it("accepts a free-text custom category within bounds", () => {
    const r = validateSetupInput({
      ...valid,
      categories: ["Underwater Basket Weaving"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.categories).toEqual(["Underwater Basket Weaving"]);
    }
  });

  it("accepts mixed presets and customs", () => {
    const r = validateSetupInput({
      ...valid,
      categories: ["Geography", "90s Sitcoms"],
    });
    expect(r.ok).toBe(true);
  });

  it("trims whitespace and canonicalizes preset casing", () => {
    const r = validateSetupInput({
      ...valid,
      categories: ["  geography  ", "  90s   Sitcoms "],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.categories).toEqual(["Geography", "90s Sitcoms"]);
    }
  });

  it("rejects an empty category selection", () => {
    expect(validateSetupInput({ ...valid, categories: [] }).ok).toBe(false);
  });

  it("rejects a whitespace-only category", () => {
    expect(validateSetupInput({ ...valid, categories: ["   "] }).ok).toBe(false);
  });

  it("rejects an overlong category name", () => {
    const long = "x".repeat(CATEGORY_MAX_LEN + 1);
    expect(validateSetupInput({ ...valid, categories: [long] }).ok).toBe(false);
  });

  it("rejects more than MAX_CATEGORIES", () => {
    const cats = Array.from({ length: MAX_CATEGORIES + 1 }, (_, i) => `Cat ${i}`);
    expect(validateSetupInput({ ...valid, categories: cats }).ok).toBe(false);
  });

  it("rejects case-insensitive duplicate categories", () => {
    expect(
      validateSetupInput({ ...valid, categories: ["History", "history"] }).ok,
    ).toBe(false);
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

describe("isPresetCategory", () => {
  it("matches presets case-insensitively", () => {
    expect(isPresetCategory("Geography")).toBe(true);
    expect(isPresetCategory("geography")).toBe(true);
    expect(isPresetCategory("  GEOGRAPHY ")).toBe(true);
  });

  it("rejects free-text customs", () => {
    expect(isPresetCategory("Underwater Basket Weaving")).toBe(false);
  });
});
