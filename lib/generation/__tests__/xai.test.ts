import { describe, expect, it, vi } from "vitest";
import { generateQuestions, GenerationError } from "../xai";
import type { GenerationParams } from "../schema";

// A fetch stub that returns a queued xAI completion per call, so a test can
// script a first (short/invalid) response followed by a tail-fill response.
function mockFetch(payloads: unknown[][]) {
  let call = 0;
  return vi.fn(async () => {
    const questions = payloads[Math.min(call, payloads.length - 1)];
    call += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ questions }) } }],
      }),
    } as unknown as Response;
  });
}

const mcParams: GenerationParams = {
  categories: ["History"],
  count: 3,
  mode: "multiple_choice",
  difficulty: "medium",
};

function mc(prompt: string) {
  return { prompt, options: ["a", "b", "c", "d"], correct_option: 1, difficulty: "easy" };
}

describe("generateQuestions", () => {
  it("returns exactly N questions with valid MC shapes", async () => {
    const fetchImpl = mockFetch([[mc("q1"), mc("q2"), mc("q3")]]);
    const out = await generateQuestions(mcParams, { apiKey: "k", fetchImpl });
    expect(out).toHaveLength(3);
    expect(out.every((q) => q.mode === "multiple_choice" && q.options?.length === 4)).toBe(true);
  });

  it("records the requested difficulty on every question (R16)", async () => {
    const fetchImpl = mockFetch([[mc("q1"), mc("q2"), mc("q3")]]);
    const out = await generateQuestions(mcParams, { apiKey: "k", fetchImpl });
    expect(out.every((q) => q.difficulty === "medium")).toBe(true);
  });

  it("regenerates the tail when the first response is short/truncated (KTD10)", async () => {
    // First attempt yields 2 valid; second attempt fills the missing 1.
    const fetchImpl = mockFetch([[mc("q1"), mc("q2")], [mc("q3")]]);
    const out = await generateQuestions(mcParams, { apiKey: "k", fetchImpl });
    expect(out).toHaveLength(3);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("drops constraint-violating type answers and regenerates (R3)", async () => {
    const params: GenerationParams = { ...mcParams, mode: "type_answer", count: 2 };
    const bad = { prompt: "q", accepted_variants: ["john fitzgerald kennedy"], difficulty: "hard" };
    const good1 = { prompt: "q1", accepted_variants: ["paris"], difficulty: "hard" };
    const good2 = { prompt: "q2", accepted_variants: ["kennedy", "john kennedy"], difficulty: "hard" };
    const fetchImpl = mockFetch([[bad, good1], [good2]]);
    const out = await generateQuestions(params, { apiKey: "k", fetchImpl });
    expect(out).toHaveLength(2);
    expect(out.every((q) => q.accepted_variants && q.accepted_variants.length > 0)).toBe(true);
  });

  it("throws GenerationError when the set can't be filled within maxAttempts", async () => {
    const fetchImpl = mockFetch([[]]); // every attempt truncated to nothing
    await expect(
      generateQuestions(mcParams, { apiKey: "k", fetchImpl, maxAttempts: 3 }),
    ).rejects.toBeInstanceOf(GenerationError);
  });

  it("surfaces a handled failure on an xAI HTTP error rather than a partial set", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response);
    await expect(generateQuestions(mcParams, { apiKey: "k", fetchImpl })).rejects.toBeInstanceOf(
      GenerationError,
    );
  });

  it("surfaces a handled failure on a network/timeout error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ETIMEDOUT");
    });
    await expect(generateQuestions(mcParams, { apiKey: "k", fetchImpl })).rejects.toBeInstanceOf(
      GenerationError,
    );
  });
});
