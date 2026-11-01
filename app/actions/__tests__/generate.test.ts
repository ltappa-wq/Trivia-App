import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  insert: vi.fn(async (_rows: unknown[]) => ({ error: null })),
  from: vi.fn(), generate: vi.fn(), bank: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ from: mocks.from }) }));
vi.mock("@/lib/generation/xai", () => ({ generateQuestions: mocks.generate }));
vi.mock("@/lib/generation/bankQuery", () => ({ fetchBankEntries: mocks.bank, buildBankExclusions: vi.fn() }));
import { generateAndPersistQuestions } from "../generate";
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.clearAllMocks(); });
it("persists deterministic fixtures without a key, provider call, or bank access", async () => {
  vi.stubEnv("GENERATION_MODE", "fixture");
  vi.stubEnv("XAI_API_KEY", undefined);
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.from.mockReturnValue({ insert: mocks.insert });
  const progress = vi.fn(async () => {});
  expect(await generateAndPersistQuestions("game", { categories: ["History"], count: 100, mode: "type_answer", difficulty: "easy" }, progress)).toBe(100);
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(mocks.bank).not.toHaveBeenCalled();
  expect(mocks.from.mock.calls).toEqual([["questions"]]);
  expect(mocks.insert.mock.calls[0]?.[0]).toEqual(expect.arrayContaining([expect.objectContaining({ game_id: "game", index: 0, prompt: "Fixture 1: spell the number 0.", accepted_variants: ["zero"] })]));
  expect(progress).toHaveBeenCalledWith(100);
  expect(warning).toHaveBeenCalledWith(expect.stringContaining("FIXTURE MODE ACTIVE"));
});
it("refuses production fixtures without the explicit E2E flag", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("GENERATION_MODE", "fixture");
  vi.stubEnv("E2E_TEST_MODE", undefined);
  vi.stubEnv("XAI_API_KEY", undefined);
  await expect(generateAndPersistQuestions("game", { categories: [], count: 1, mode: "multiple_choice", difficulty: "easy" })).rejects.toThrow("Missing XAI_API_KEY");
  expect(mocks.insert).not.toHaveBeenCalled();
});
