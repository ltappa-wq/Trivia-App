import { describe, expect, it } from "vitest";
import { normalizePrompt } from "../dedup";

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
