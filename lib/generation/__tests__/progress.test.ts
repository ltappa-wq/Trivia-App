import { expect, it } from "vitest";
import { generationProgress, GENERATION_LEASE_MS } from "../progress";

it("recovers stored progress while generation is in flight", () => {
  expect(generationProgress({ question_count: 100, generation_progress: 36,
    generation_started_at: new Date(1000).toISOString() }, 2000))
    .toEqual({ completed: 36, total: 100, running: true, error: null });
});

it("offers retry when an invocation was interrupted and its lease expired", () => {
  const result = generationProgress({ question_count: 100, generation_progress: 36,
    generation_started_at: new Date(1000).toISOString() }, 1000 + GENERATION_LEASE_MS);
  expect(result.running).toBe(false);
  expect(result.error).toMatch(/interrupted.*retry/);
});
