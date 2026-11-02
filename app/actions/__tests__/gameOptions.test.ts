import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), player: vi.fn(), broadcast: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));
vi.mock("@/lib/serverAuth", () => ({ resolvePlayerByToken: mocks.player }));
vi.mock("@/lib/realtime/broadcast", () => ({ broadcastToRoom: mocks.broadcast }));
vi.mock("@/lib/rateLimit", () => ({ checkSharedRateLimit: async () => true }));
vi.mock("@/lib/serverRequest", () => ({ callerIp: async () => "test" }));
import { submitAnswer } from "../submitAnswer";
import { createGame } from "../createGame";
const game = { id: "g", code: "12345", current_index: 1, question_count: 2, answer_mode: "type_answer", answer_timer_ms: 60000, double_points_finale: true, reveal_at: new Date(0).toISOString(), paused: false, status: "active", reviewing: false };
beforeEach(() => { vi.clearAllMocks(); mocks.player.mockResolvedValue({ playerId: "p", gameId: "g", isSpectator: false }); mocks.rpc.mockResolvedValue({ data: false }); });
afterEach(() => { vi.useRealTimers(); });
function wireSubmit(settings: Omit<typeof game, "answer_timer_ms"> & { answer_timer_ms: number | null } = game, question = { id: "q", mode: "type_answer", accepted_variants: ["yes"], correct_option: 0, voided: false }) {
  mocks.from.mockImplementation((table: string) => {
    const chain = {
      select: () => chain, eq: () => chain,
      single: async () => ({ data: table === "games" ? settings : question }),
      then: (resolve: (value: unknown) => void) => Promise.resolve({ data: [] }).then(resolve),
    };
    return chain;
  });
}
it("submit uses the stored custom window and enabled finale multiplier", async () => {
  vi.useFakeTimers(); vi.setSystemTime(60000); wireSubmit();
  const result = await submitAnswer("player", "yes");
  expect(result.points).toBe(1000);
  expect(mocks.rpc).toHaveBeenCalledWith("commit_answer", expect.objectContaining({ p_player_id: "p", p_points: 1000, p_expected_index: 1 }));
});
it("submit gives zero outside the configured window", async () => {
  vi.useFakeTimers(); vi.setSystemTime(60001); wireSubmit();
  expect((await submitAnswer("player", "yes")).points).toBe(0);
});
it("a correct nonfinal answer receives the ordinary score", async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000); wireSubmit({ ...game, current_index: 0 });
  expect((await submitAnswer("player", "yes")).points).toBe(1000);
});
it("room creation persists the validated typed options", async () => {
  const insert = vi.fn(() => ({ select: () => ({ single: async () => ({ data: { id: "g" } }) }) }));
  mocks.from.mockReturnValue({ insert });
  await createGame({ categories: ["History"], questionCount: 2, answerMode: "multiple_choice", difficulty: "medium", answerTimerMs: 10000, autoAdvanceMs: 8000, doublePointsFinale: true }, { plays: false, name: "" });
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({ answer_timer_ms: 10000, auto_advance_ms: 8000, double_points_finale: true }));
});
it("legacy setup input persists defaults without changing the old timer", async () => {
  const insert = vi.fn(() => ({ select: () => ({ single: async () => ({ data: { id: "g" } }) }) }));
  mocks.from.mockReturnValue({ insert });
  await createGame({ categories: ["History"], questionCount: 2, answerMode: "type_answer", difficulty: "medium" }, { plays: false, name: "" });
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({ answer_timer_ms: null, auto_advance_ms: null, double_points_finale: false }));
});

it.each([["type_answer", "yes", 35000], ["true_false", "0", 15000]] as const)("mixed %s submission uses its question window", async (mode, raw, windowMs) => {
  vi.useFakeTimers(); vi.setSystemTime(windowMs);
  wireSubmit({ ...game, answer_mode: "mixed", answer_timer_ms: null }, { id: "q", mode, accepted_variants: ["yes"], correct_option: 0, voided: false });
  expect((await submitAnswer("player", raw)).points).toBe(1000);
});
