import { describe, expect, it } from "vitest";
import {
  extractQuestionArray,
  isEasyTypeAnswer,
  validateGeneratedQuestion,
} from "../schema";

describe("isEasyTypeAnswer (R3)", () => {
  it("accepts one or two easy-to-spell words", () => {
    expect(isEasyTypeAnswer("kennedy")).toBe(true);
    expect(isEasyTypeAnswer("john kennedy")).toBe(true);
    expect(isEasyTypeAnswer("  Paris  ")).toBe(true);
  });

  it("rejects more than two words", () => {
    expect(isEasyTypeAnswer("john fitzgerald kennedy")).toBe(false);
  });

  it("rejects words with digits or punctuation", () => {
    expect(isEasyTypeAnswer("area51")).toBe(false);
    expect(isEasyTypeAnswer("o'brien")).toBe(false);
  });

  it("rejects an over-long (hard-to-spell) word", () => {
    expect(isEasyTypeAnswer("supercalifragilistic")).toBe(false);
  });

  it("rejects empty input", () => {
    expect(isEasyTypeAnswer("")).toBe(false);
    expect(isEasyTypeAnswer("   ")).toBe(false);
  });
});

describe("validateGeneratedQuestion", () => {
  const mc = { mode: "multiple_choice" as const, difficulty: "medium" as const };
  const type = { mode: "type_answer" as const, difficulty: "hard" as const };

  it("accepts a well-formed MC question and records requested difficulty (R16)", () => {
    const r = validateGeneratedQuestion(
      {
        prompt: "Capital of France?",
        options: ["Paris", "Lyon", "Nice", "Rome"],
        correct_option: 0,
        difficulty: "easy", // model echo is ignored
      },
      mc,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.question.difficulty).toBe("medium");
      expect(r.question.correct_option).toBe(0);
    }
  });

  it("rejects MC with too few options (needs distractors)", () => {
    const r = validateGeneratedQuestion(
      { prompt: "q", options: ["a", "b"], correct_option: 0, difficulty: "medium" },
      mc,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects MC with out-of-range correct_option", () => {
    const r = validateGeneratedQuestion(
      { prompt: "q", options: ["a", "b", "c"], correct_option: 5, difficulty: "medium" },
      mc,
    );
    expect(r.ok).toBe(false);
  });

  it("accepts type-answer with easy variants (R3, R4)", () => {
    const r = validateGeneratedQuestion(
      { prompt: "Who?", accepted_variants: ["kennedy", "john kennedy"], difficulty: "hard" },
      type,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.question.accepted_variants).toEqual(["kennedy", "john kennedy"]);
  });

  it("rejects type-answer whose variant violates the word rule (R3)", () => {
    const r = validateGeneratedQuestion(
      { prompt: "Who?", accepted_variants: ["john fitzgerald kennedy"], difficulty: "hard" },
      type,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects a question with no prompt", () => {
    expect(validateGeneratedQuestion({ options: ["a", "b", "c"], correct_option: 0 }, mc).ok).toBe(
      false,
    );
  });
});

describe("extractQuestionArray", () => {
  it("reads a bare array", () => {
    expect(extractQuestionArray([{ prompt: "x" }])).toHaveLength(1);
  });
  it("reads a { questions } object", () => {
    expect(extractQuestionArray({ questions: [{ prompt: "x" }] })).toHaveLength(1);
  });
  it("returns empty for anything else", () => {
    expect(extractQuestionArray({ foo: 1 })).toEqual([]);
    expect(extractQuestionArray("nope")).toEqual([]);
  });
});
