import { describe, expect, it } from "vitest";
import { answerKey, normalizedAnswerKey } from "../answerKey";
import { normalizeAnswer } from "../dedup";

// U2 / R1 / R3. The anchor must be exactly right or the whole dedup gate is
// wrong in one of two expensive ways: a key that is too loose manufactures
// duplicates and rejects good questions; a key that is too strict never
// anchors and silently degrades dedup to today's prompt-only behavior.

describe("answerKey (U2, R1)", () => {
  it("returns the option at correct_option, not the first option", () => {
    expect(
      answerKey({
        mode: "multiple_choice",
        options: ["Lyon", "Nice", "Paris", "Rome"],
        correct_option: 2,
      }),
    ).toBe("Paris");
  });

  it("returns the first accepted variant as the primary type-answer", () => {
    expect(
      answerKey({
        mode: "type_answer",
        accepted_variants: ["Kennedy", "john kennedy", "jfk"],
      }),
    ).toBe("Kennedy");
  });

  it("returns null when correct_option is past the end of the options", () => {
    expect(
      answerKey({ mode: "multiple_choice", options: ["Paris", "Lyon"], correct_option: 7 }),
    ).toBeNull();
  });

  it("returns null when correct_option is negative", () => {
    expect(
      answerKey({ mode: "multiple_choice", options: ["Paris"], correct_option: -1 }),
    ).toBeNull();
  });

  it("returns null when a multiple-choice row has no options", () => {
    expect(answerKey({ mode: "multiple_choice", options: null, correct_option: 0 })).toBeNull();
  });

  it("returns null when a type-answer row has no variants", () => {
    expect(answerKey({ mode: "type_answer", accepted_variants: [] })).toBeNull();
    expect(answerKey({ mode: "type_answer", accepted_variants: null })).toBeNull();
  });

  it("returns null for a blank answer rather than an empty key", () => {
    // An empty key would anchor against every other malformed row.
    expect(
      answerKey({ mode: "multiple_choice", options: ["   "], correct_option: 0 }),
    ).toBeNull();
  });
});

describe("normalizedAnswerKey (U2, R1)", () => {
  it("collapses casing and punctuation to one key", () => {
    expect(normalizeAnswer("The Beatles")).toBe(normalizeAnswer("the beatles!"));
    expect(
      normalizedAnswerKey({ mode: "type_answer", accepted_variants: ["The Beatles"] }),
    ).toBe(normalizedAnswerKey({ mode: "type_answer", accepted_variants: ["the beatles!"] }));
  });

  it("keeps answers that differ by a word distinct", () => {
    expect(normalizeAnswer("New York")).not.toBe(normalizeAnswer("York"));
  });

  it("normalizes the option at correct_option", () => {
    expect(
      normalizedAnswerKey({
        mode: "multiple_choice",
        options: ["Lyon", "  Paris! "],
        correct_option: 1,
      }),
    ).toBe("paris");
  });

  it("returns null when the answer normalizes away to nothing", () => {
    // Punctuation-only text survives answerKey (non-blank) but has no key.
    expect(
      normalizedAnswerKey({ mode: "type_answer", accepted_variants: ["!!!"] }),
    ).toBeNull();
  });

  it("propagates null from a malformed row", () => {
    expect(
      normalizedAnswerKey({
        mode: "multiple_choice",
        options: ["Paris", "Lyon"],
        correct_option: 9,
      }),
    ).toBeNull();
  });
});
