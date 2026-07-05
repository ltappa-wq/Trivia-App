import { describe, expect, it } from "vitest";
import { formatAnswerKey } from "../reviewAnswer";
import type { RevealedAnswer } from "../db/types";

function reveal(over: Partial<RevealedAnswer>): RevealedAnswer {
  return {
    index: 0,
    mode: "multiple_choice",
    options: null,
    correct_option: null,
    accepted_variants: null,
    correction: null,
    ...over,
  };
}

describe("formatAnswerKey (R1 review-phase reveal)", () => {
  it("returns the correct option text for multiple choice", () => {
    expect(
      formatAnswerKey(reveal({ mode: "multiple_choice", options: ["A", "B", "C"], correct_option: 2 })),
    ).toBe("C");
  });

  it("falls back to an em dash when correct_option is out of range or null", () => {
    expect(
      formatAnswerKey(reveal({ mode: "multiple_choice", options: ["A", "B"], correct_option: 5 })),
    ).toBe("—");
    expect(
      formatAnswerKey(reveal({ mode: "multiple_choice", options: ["A", "B"], correct_option: null })),
    ).toBe("—");
  });

  it("joins accepted variants for type-answer questions", () => {
    expect(
      formatAnswerKey(reveal({ mode: "type_answer", accepted_variants: ["Paris", "paris"] })),
    ).toBe("Paris, paris");
  });

  it("falls back to an em dash when there are no accepted variants", () => {
    expect(formatAnswerKey(reveal({ mode: "type_answer", accepted_variants: [] }))).toBe("—");
    expect(formatAnswerKey(reveal({ mode: "type_answer", accepted_variants: null }))).toBe("—");
  });

  it("returns an em dash for a null reveal (question still answerable)", () => {
    expect(formatAnswerKey(null)).toBe("—");
  });
});
