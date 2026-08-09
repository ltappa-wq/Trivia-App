import { describe, expect, it, vi } from "vitest";
import { generateQuestions, GenerationError } from "../xai";
import type { GenerationParams } from "../schema";
import type { BankExclusions } from "../bankQuery";
import * as similarity from "../similarity";

/** A bank exclusion set with only the parts a given test cares about. */
function bank(over: Partial<BankExclusions> = {}): BankExclusions {
  return {
    seen: over.seen ?? new Set(),
    promptsByAnswer: over.promptsByAnswer ?? new Map(),
    avoidPrompts: over.avoidPrompts ?? [],
  };
}

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
  // Unique correct answer per prompt so answer-dedup does not reject the batch.
  const answer = `ans-${prompt}`;
  return {
    prompt,
    options: [answer, "distractor-x", "distractor-y", "distractor-z"],
    correct_option: 0,
    difficulty: "easy",
  };
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

  it("excludes prompts already in the bank and regenerates (R7.2)", async () => {
    // First attempt returns a prompt that's already banked plus two fresh ones;
    // the banked one is rejected and the tail attempt fills the gap.
    const fetchImpl = mockFetch([[mc("Banked One"), mc("q2"), mc("q3")], [mc("q4")]]);
    const seen = new Set(["banked one"]); // normalized form of "Banked One"
    const out = await generateQuestions(mcParams, { apiKey: "k", fetchImpl }, bank({ seen }));
    expect(out).toHaveLength(3);
    expect(out.map((q) => q.prompt)).not.toContain("Banked One");
  });

  it("drops duplicates within a single batch, keeping one (R7)", async () => {
    // "q1" and "Q1?" normalize equal — only one survives; tail fills the rest.
    const fetchImpl = mockFetch([[mc("q1"), mc("Q1?"), mc("q2")], [mc("q3")]]);
    const out = await generateQuestions(mcParams, { apiKey: "k", fetchImpl });
    expect(out).toHaveLength(3);
    const norms = out.map((q) => q.prompt.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim());
    expect(new Set(norms).size).toBe(3);
  });

  it("throws when only duplicates are available (fails loud, R7.3)", async () => {
    const fetchImpl = mockFetch([[mc("dup")]]); // every attempt is the same banked prompt
    await expect(
      generateQuestions(
        mcParams,
        { apiKey: "k", fetchImpl, maxAttempts: 3 },
        bank({ seen: new Set(["dup"]) }),
      ),
    ).rejects.toBeInstanceOf(GenerationError);
  });

  it("rejects a repeated correct answer across questions and regenerates", async () => {
    // Two different prompts that both claim the same correct answer text.
    const sameAns = {
      prompt: "Q1?",
      options: ["Paris", "Lyon", "Nice", "Rome"],
      correct_option: 0,
      difficulty: "easy",
    };
    const sameAns2 = {
      prompt: "Q2?",
      options: ["Paris", "Madrid", "Berlin", "Oslo"],
      correct_option: 0,
      difficulty: "easy",
    };
    const fill = {
      prompt: "Q3?",
      options: ["Tokyo", "Osaka", "Kyoto", "Nara"],
      correct_option: 0,
      difficulty: "easy",
    };
    const fetchImpl = mockFetch([[sameAns, sameAns2], [fill, mc("q-extra")]]);
    const out = await generateQuestions(
      { ...mcParams, count: 2 },
      { apiKey: "k", fetchImpl },
    );
    expect(out).toHaveLength(2);
    const answers = out.map((q) => q.options?.[q.correct_option!]);
    expect(new Set(answers).size).toBe(2);
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

  it("reports an aborted request as a timeout", async () => {
    const fetchImpl = vi.fn(async () => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    });
    await expect(
      generateQuestions(mcParams, { apiKey: "k", fetchImpl, timeoutMs: 5 }),
    ).rejects.toThrow(/timed out/);
  });
});

// U4 / R1 / R2 / R4. The answer-anchored gate: reject rewordings of banked
// questions, keep genuinely different questions that share an answer, and do
// neither at the cost of the existing tail-regeneration behavior.
describe("answer-anchored duplicate detection (U4)", () => {
  /** A banked "What is the capital of France?" indexed under its answer. */
  function franceBank(): BankExclusions {
    return bank({
      seen: new Set(["what is the capital of france"]),
      promptsByAnswer: new Map([["paris", ["what is the capital of france"]]]),
    });
  }

  /** An MC question with an explicit correct answer, so the anchor is known. */
  function withAnswer(prompt: string, answer: string) {
    return {
      prompt,
      options: [answer, "distractor-x", "distractor-y", "distractor-z"],
      correct_option: 0,
      difficulty: "easy",
    };
  }

  it("AE1: rejects a reworded banked question sharing its answer", async () => {
    const fetchImpl = mockFetch([
      [withAnswer("Which city is France's capital?", "Paris"), mc("q2"), mc("q3")],
      [mc("q4")],
    ]);

    const out = await generateQuestions(mcParams, { apiKey: "k", fetchImpl }, franceBank());

    expect(out).toHaveLength(3);
    expect(out.map((q) => q.prompt)).not.toContain("Which city is France's capital?");
  });

  it("AE2: keeps a different question that happens to share the same answer", async () => {
    const fetchImpl = mockFetch([
      [withAnswer("Which city hosts the Louvre?", "Paris"), mc("q2"), mc("q3")],
    ]);

    const out = await generateQuestions(mcParams, { apiKey: "k", fetchImpl }, franceBank());

    expect(out).toHaveLength(3);
    // R2: same answer, dissimilar prompt — this is a keeper, not a duplicate.
    expect(out.map((q) => q.prompt)).toContain("Which city hosts the Louvre?");
  });

  it("skips the similarity comparison entirely when the answer anchors nothing", async () => {
    const spy = vi.spyOn(similarity, "isNearDuplicate");
    try {
      // Every candidate's answer ("ans-qN") is absent from the bank index.
      const fetchImpl = mockFetch([[mc("q1"), mc("q2"), mc("q3")]]);

      const out = await generateQuestions(mcParams, { apiKey: "k", fetchImpl }, franceBank());

      expect(out).toHaveLength(3);
      // The anchor must actually be doing the narrowing — if this fires, every
      // candidate is being compared against the bank and the anchor is decorative.
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("R4: still rejects a second question reusing an answer within the same set", async () => {
    // Prompts are wildly dissimilar, so only the within-set answer rule can
    // reject the second one. That rule stays strict across the set (KTD4).
    const fetchImpl = mockFetch([
      [
        withAnswer("Which city hosts the Louvre?", "Paris"),
        withAnswer("Who wrote Hamlet?", "Paris"),
      ],
      [withAnswer("Which planet is largest?", "Jupiter")],
    ]);

    const out = await generateQuestions(
      { ...mcParams, count: 2 },
      { apiKey: "k", fetchImpl },
      bank(),
    );

    expect(out).toHaveLength(2);
    const answers = out.map((q) => q.options?.[q.correct_option!]);
    expect(new Set(answers).size).toBe(2);
  });

  it("still rejects an identical banked prompt whose answer differs", async () => {
    // The cheap exact-prompt pre-filter runs regardless of the anchor.
    const fetchImpl = mockFetch([
      [withAnswer("What is the capital of France?", "Lyon"), mc("q2"), mc("q3")],
      [mc("q4")],
    ]);

    const out = await generateQuestions(mcParams, { apiKey: "k", fetchImpl }, franceBank());

    expect(out).toHaveLength(3);
    expect(out.map((q) => q.prompt)).not.toContain("What is the capital of France?");
  });

  it("compares later candidates against questions accepted earlier in the same run", async () => {
    // Nothing banked; the first candidate seeds the anchor index itself.
    const fetchImpl = mockFetch([
      [
        withAnswer("Which city is the capital of France?", "Paris"),
        withAnswer("What is France's capital city?", "Paris"),
        mc("q2"),
      ],
      [mc("q3")],
    ]);

    const out = await generateQuestions(mcParams, { apiKey: "k", fetchImpl }, bank());

    expect(out).toHaveLength(3);
    expect(out.map((q) => q.prompt)).not.toContain("What is France's capital city?");
  });

  it("fills the requested count despite a batch that is half near-duplicates", async () => {
    const fetchImpl = mockFetch([
      [
        withAnswer("Which city is France's capital?", "Paris"),
        withAnswer("What is the capital of France today?", "Paris"),
        mc("keep1"),
        mc("keep2"),
      ],
      [mc("keep3")],
    ]);

    const out = await generateQuestions(mcParams, { apiKey: "k", fetchImpl }, franceBank());

    // Rejections drive tail regeneration rather than shrinking the set.
    expect(out).toHaveLength(3);
  });

  it("names near-duplicate among the rejection reasons when attempts run out", async () => {
    // Every attempt returns only rewordings of the same banked question.
    const fetchImpl = mockFetch([[withAnswer("Which city is France's capital?", "Paris")]]);

    await expect(
      generateQuestions(
        mcParams,
        { apiKey: "k", fetchImpl, maxAttempts: 3 },
        franceBank(),
      ),
    ).rejects.toThrow(/near-duplicate/);
  });
});
