import { afterEach, describe, expect, it, vi } from "vitest";
import { FAMILY_SAFETY_RULES, parseSafetyVerdicts } from "@/lib/familySafety";
import { buildMessages, generateQuestions } from "../xai";
import { fixtureSafetyFetch } from "../fixture";
import { probeCategoryViability } from "../categoryProbe";

const params = { categories: ["History"], count: 2, mode: "multiple_choice" as const, difficulty: "medium" as const, familyFriendly: true };
const response = (output: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }));
afterEach(() => vi.restoreAllMocks());

describe("shared safety policy", () => {
  it("covers every generated field and excluded subject and keeps history factual", () => {
    for (const text of ["question", "option", "accepted answer", "explanation", "sexual", "graphic violence", "drugs", "alcohol", "slurs", "hate", "self-harm", "gambling", "crude", "Historical", "non-graphic"]) expect(FAMILY_SAFETY_RULES).toContain(text);
  });
  it("adds constraints only when enabled", () => {
    expect(buildMessages(params, 2)[1].content).toContain(FAMILY_SAFETY_RULES);
    expect(buildMessages({ ...params, familyFriendly: false }, 2)[1].content).not.toContain(FAMILY_SAFETY_RULES);
  });
  it("requires one boolean per index, independently of verdict order", () => {
    expect(parseSafetyVerdicts({ verdicts: [{ index: 1, safe: false }, { index: 0, safe: true }] }, 2)).toEqual([true, false]);
    for (const raw of [null, {}, { verdicts: [] }, { verdicts: [{ index: 0, safe: true }, { index: 0, safe: false }] }, { verdicts: [{ index: 0, safe: "true" }, { index: 1, safe: true }] }, { verdicts: [{ index: -1, safe: true }, { index: 1, safe: true }] }]) expect(() => parseSafetyVerdicts(raw, 2)).toThrow();
  });
});

it("batches moderation, removes flagged content, and fills the tail without xAI", async () => {
  const fetchImpl = vi.fn(fixtureSafetyFetch(params));
  const onSafetyRejections = vi.fn();
  const result = await generateQuestions(params, { apiKey: "fixture", fetchImpl, onSafetyRejections });
  expect(result).toHaveLength(2);
  expect(result.every(q => !q.prompt.includes("flagged"))).toBe(true);
  expect(onSafetyRejections.mock.calls.flat().reduce((a, b) => a + b, 0)).toBe(1);
  const bodies = fetchImpl.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
  expect(bodies).toHaveLength(4);
  expect(bodies[1].messages[0].content).toContain(FAMILY_SAFETY_RULES);
  expect(JSON.parse(bodies[1].messages[1].content)).toHaveLength(2);
});

it.each(["provider", "malformed", "missing", "timeout"])("fails closed when moderation fails: %s", async failure => {
  const fixture = fixtureSafetyFetch(params);
  const fetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (body.response_format.type !== "json_schema") return fixture(url, init);
    if (failure === "provider") return new Response("busy", { status: 503 });
    if (failure === "timeout") throw new DOMException("timeout", "AbortError");
    return failure === "missing" ? response({ verdicts: [{ index: 0, safe: true }] }) : response({ verdicts: "bad" });
  });
  await expect(generateQuestions(params, { apiKey: "fixture", fetchImpl, maxAttempts: 1 })).rejects.toThrow(/Family safety check/);
});

it("does not classify or change provider call count when off", async () => {
  const off = { ...params, familyFriendly: false };
  const fetchImpl = vi.fn(async () => response({ questions: [
    { prompt: "First", options: ["A", "B", "C"], correct_option: 0 },
    { prompt: "Second", options: ["D", "E", "F"], correct_option: 0 },
  ] }));
  await generateQuestions(off, { apiKey: "fixture", fetchImpl });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it("charges moderation to the same deadline and never calls it after time expires", async () => {
  let now = 0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const fixture = fixtureSafetyFetch(params);
  const fetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    now += 101;
    return fixture(url, init);
  });
  await expect(generateQuestions(params, { apiKey: "fixture", fetchImpl, budgetMs: 100 })).rejects.toThrow(/timed out/);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it("shares moderation and generation time across all mixed phases", async () => {
  const mixed = { ...params, mode: "mixed" as const, count: 4 };
  let now = 0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const fixture = fixtureSafetyFetch(mixed);
  const timeouts = vi.spyOn(globalThis, "setTimeout");
  const fetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0], init?: RequestInit) => { now += 10; return fixture(url, init); });
  const result = await generateQuestions(mixed, { apiKey: "fixture", fetchImpl, budgetMs: 1000, timeoutMs: 1000 });
  expect(new Set(result.map(q => q.mode)).size).toBe(3);
  expect(timeouts.mock.calls.map(([, ms]) => ms)).toEqual([1000, 990, 980, 970, 960, 950]);
});

it("family category probes require an explicit suitability verdict with friendly rejection", async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => response({ viable: true, estimated_questions: 50, reason: "Looks good", family_suitable: false }));
  expect(await probeCategoryViability("Cocktails", { apiKey: "k", familyFriendly: true, fetchImpl })).toMatchObject({ ok: false, familySuitable: false, reason: "Please choose a topic suitable for family play." });
  const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
  expect(body.messages[1].content).toContain(FAMILY_SAFETY_RULES);
  await expect(probeCategoryViability("Topic", { apiKey: "k", familyFriendly: true, fetchImpl: async () => response({ viable: true, estimated_questions: 50 }) })).rejects.toThrow(/incomplete/);
  expect(await probeCategoryViability("Topic", { apiKey: "k", fetchImpl: async () => response({ viable: true, estimated_questions: 50 }) })).toMatchObject({ ok: true });
});

it("aborts a hung moderation call and accepts none of that batch", async () => {
  vi.useFakeTimers();
  const fixture = fixtureSafetyFetch(params);
  const onProgress = vi.fn();
  const fetchImpl: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.response_format.type !== "json_schema") return fixture(url, init);
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
  };
  try {
    const pending = generateQuestions(params, { apiKey: "fixture", fetchImpl, maxAttempts: 1, timeoutMs: 100, onProgress });
    const rejected = expect(pending).rejects.toThrow(/Family safety check/);
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(onProgress).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
it("exposes family suitability independently while setup still rejects a low viability estimate", async () => {
  const probe = await probeCategoryViability("90s cartoons", {
    apiKey: "k", familyFriendly: true,
    fetchImpl: async () => response({ viable: false, estimated_questions: 3, family_suitable: true, reason: "Not enough unique questions for this topic" }),
  });
  expect(probe).toMatchObject({ ok: false, familySuitable: true, estimatedQuestions: 3 });
});
