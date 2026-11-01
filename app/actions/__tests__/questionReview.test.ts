import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ authorize: vi.fn(), from: vi.fn(), rpc: vi.fn(), generate: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ from: m.from, rpc: m.rpc }) }));
vi.mock("@/lib/serverAuth", () => ({ authorizeHostByCode: m.authorize }));
vi.mock("@/lib/rateLimit", () => ({ checkSharedRateLimit: m.rate }));
vi.mock("../generate", () => ({ generateAndPersistQuestions: m.generate }));
import { editQuestionReview, getQuestionReview } from "../questionReview";
const q = { id: "q", index: 0, prompt: "Capital?", mode: "type_answer", accepted_variants: ["Paris"], difficulty: "easy" };
beforeEach(() => {
  vi.clearAllMocks();
  m.authorize.mockResolvedValue({ id: "g", status: "lobby", current_index: -1, categories: ["Geography"], answer_mode: "type_answer", difficulty: "easy", regeneration_count: 0 });
  const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), order: vi.fn(async () => ({ data: [q, { ...q, id: "q2", index: 1 }], error: null })) };
  m.from.mockReturnValue(chain); m.rate.mockResolvedValue(true);
  m.rpc.mockResolvedValue({ data: { lease: "lease", attempt: 1 }, error: null });
  m.generate.mockResolvedValue(1);
});
it.each(["forged", "player-token"])("rejects %s for both reads and writes before touching questions", async token => {
  m.authorize.mockRejectedValue(new Error("Not authorized"));
  await expect(getQuestionReview("12345", token)).rejects.toThrow("Not authorized");
  await expect(editQuestionReview("12345", token, "q", "regenerate")).rejects.toThrow("Not authorized");
  expect(m.from).not.toHaveBeenCalled(); expect(m.rpc).not.toHaveBeenCalled(); expect(m.generate).not.toHaveBeenCalled();
});
it("rejects review once Start wins", async () => {
  m.authorize.mockResolvedValue({ status: "active", current_index: 0 });
  await expect(getQuestionReview("12345", "host")).rejects.toThrow(/before Start/);
  expect(m.from).not.toHaveBeenCalled();
});
it("claims a lease, seeds dedup with the locked set, commits via RPC, and releases", async () => {
  m.generate.mockImplementation(async (_id, _params, _progress, replacement) => { await replacement.persist(q); return 1; });
  const result = await editQuestionReview("12345", "host", "q", "regenerate");
  expect(result.error).toBeUndefined();
  expect(m.generate).toHaveBeenCalledWith("g", expect.objectContaining({ count: 1, categories: ["Geography"] }), undefined, expect.objectContaining({ fixtureOffset: 100, existing: expect.arrayContaining([expect.objectContaining({ accepted_variants: ["Paris"] })]) }));
  expect(m.rpc.mock.calls.map(c => c[1].p_operation)).toEqual(["claim", "replace", "release"]);
  expect(m.rpc.mock.calls[1][1]).toMatchObject({ p_game_id: "g", p_host_token: "host", p_question_id: "q", p_lease: "lease" });
});
it.each(["This room has reached its limit of 20 regenerations.", "Questions are being prepared in another tab. Please wait.", "Question review is available only before Start."])("surfaces atomic claim failure: %s", async message => {
  m.rpc.mockResolvedValue({ data: null, error: { message } });
  expect(await editQuestionReview("12345", "host", "q", "regenerate")).toEqual({ error: message });
  expect(m.generate).not.toHaveBeenCalled();
});
it("does not commit after a lease or Start race and releases after provider failure", async () => {
  m.generate.mockRejectedValue(new Error("Provider unavailable"));
  expect(await editQuestionReview("12345", "host", "q", "regenerate")).toEqual({ error: "Provider unavailable" });
  expect(m.rpc.mock.calls.map(c => c[1].p_operation)).toEqual(["claim", "release"]);
});
it("rate-limits before spending a regeneration attempt", async () => {
  m.rate.mockResolvedValue(false);
  expect((await editQuestionReview("12345", "host", "q", "regenerate")).error).toMatch(/wait a minute/);
  expect(m.rpc).not.toHaveBeenCalled(); expect(m.generate).not.toHaveBeenCalled();
});
it("removes through the atomic host-token RPC", async () => {
  await editQuestionReview("12345", "host", "q", "remove");
  expect(m.rpc).toHaveBeenCalledWith("edit_review_question", expect.objectContaining({ p_operation: "remove", p_question_id: "q", p_host_token: "host" }));
  expect(m.generate).not.toHaveBeenCalled();
});
