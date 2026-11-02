import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { validateGeneratedQuestion, correctAnswerKeys } from "../schema";
import { fixtureQuestions } from "../fixture";
import { normalizedAnswerKey } from "../answerKey";
import { generateQuestions } from "../xai";
import { normalizePrompt } from "../dedup";
const params = { categories: ["Science"], count: 4, mode: "mixed" as const, difficulty: "easy" as const };
const tf = { prompt: "Venus is closer to the Sun than Earth.", answer: true, mode: "true_false" };
describe("mixed generation", () => {
  it("validates boolean answers into two canonical options without shuffling", () => {
    for (const answer of [true, false]) {
      const result = validateGeneratedQuestion({ ...tf, answer }, params);
      expect(result).toMatchObject({ ok: true, question: { mode: "true_false", options: ["True", "False"], correct_option: answer ? 0 : 1 } });
      if (result.ok) { expect(correctAnswerKeys(result.question)).toEqual([]); expect(normalizedAnswerKey(result.question)).toBeNull(); }
    }
    for (const answer of ["true", 1, null, undefined]) expect(validateGeneratedQuestion({ ...tf, answer }, params).ok).toBe(false);
    expect(validateGeneratedQuestion({ ...tf, mode: "mixed" }, params).ok).toBe(false);
  });
  it("provides repeatable mixed fixtures and all three modes even for three questions", () => {
    const questions = fixtureQuestions(params);
    expect(questions).toEqual(fixtureQuestions(params));
    expect(questions.map(q => q.mode)).toEqual(["multiple_choice", "type_answer", "true_false", "multiple_choice"]);
    expect(new Set(fixtureQuestions({ ...params, count: 3 }).map(q => q.mode)).size).toBe(3);
    for (const q of fixtureQuestions({ ...params, count: 100 })) {
      expect(validateGeneratedQuestion({ ...q, answer: q.correct_option === 0 }, { ...params, mode: q.mode }).ok).toBe(true);
    }
  });
  it("allows repeated TF answers, but rejects prompt-only bank near duplicates", async () => {
    const repeated = { ...tf, prompt: "Penguins are flightless birds." };
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ questions: [tf, repeated] }) } }] })));
    const config = { apiKey: "fixture", fetchImpl, maxAttempts: 1 };
    const request = { ...params, mode: "true_false" as const, count: 2 };
    expect(await generateQuestions(request, config)).toHaveLength(2);
    const prompt = normalizePrompt(tf.prompt);
    await expect(generateQuestions({ ...request, count: 1 }, { ...config, fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ questions: [{ ...tf, prompt: tf.prompt + " Really?" }] }) } }] }))) }, { seen: new Set([prompt]), promptsByAnswer: new Map(), avoidPrompts: [] })).rejects.toThrow(/near-duplicate/);
  });
});

it("requests each type, enforces the ratio and interleaves live output", async () => {
  const fetched: string[] = [];
  const progress: number[] = [];
  const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    const prompt: string = request.messages[1].content;
    const mode = prompt.includes('"answer" boolean') ? "true_false" : prompt.includes("Each question is multiple choice") ? "multiple_choice" : "type_answer";
    fetched.push(mode);
    const questions = mode === "multiple_choice"
      ? [{ prompt: "Which city is the capital of France?", options: ["Paris", "Rome", "Oslo"], correct_option: 0 }, { prompt: "Which element has the symbol Au?", options: ["Gold", "Silver", "Iron"], correct_option: 0 }]
      : mode === "type_answer" ? [{ prompt: "Name the largest ocean.", accepted_variants: ["Pacific"] }] : [{ prompt: "Penguins are flightless birds.", answer: true }];
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ questions }) } }] }));
  });
  const result = await generateQuestions(params, { apiKey: "test", fetchImpl, onProgress: n => { progress.push(n); } });
  expect(fetched).toEqual(["multiple_choice", "type_answer", "true_false"]);
  expect(result.map(q => q.mode)).toEqual(["multiple_choice", "type_answer", "true_false", "multiple_choice"]);
  expect(progress).toEqual([2, 3, 4]);
});

it.each([undefined, 120_000])("shares the overall mixed deadline across retries and later phases (budget=%s)", async (budgetMs) => {
  const budget = budgetMs ?? 240_000;
  let now = 0;
  const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
  const timers = vi.spyOn(globalThis, "setTimeout");
  // MC needs a second request after spending more than a third of the budget.
  const batches = [
    [{ prompt: "Which city is the capital of France?", options: ["Paris", "Rome", "Oslo"], correct_option: 0 }],
    [{ prompt: "Which element has the symbol Au?", options: ["Gold", "Silver", "Iron"], correct_option: 0 }],
    [{ prompt: "Name the largest ocean.", accepted_variants: ["Pacific"] }],
    [{ prompt: "Penguins are flightless birds.", answer: true }],
  ];
  const spent = [budget * 0.375, budget / 24, budget / 24, 1000];
  let call = 0;
  const fetchImpl = vi.fn(async () => {
    const index = call++;
    now += spent[index];
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ questions: batches[index] }) } }] }));
  });
  try {
    const result = await generateQuestions(params, { apiKey: "test", fetchImpl, budgetMs, timeoutMs: budget });
    expect(result.map(q => q.mode)).toEqual(["multiple_choice", "type_answer", "true_false", "multiple_choice"]);
    expect(timers.mock.calls.map(([, timeout]) => timeout)).toEqual([
      budget,
      budget - spent[0],
      budget - spent[0] - spent[1],
      budget - spent[0] - spent[1] - spent[2],
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  } finally {
    clock.mockRestore();
    timers.mockRestore();
  }
});
