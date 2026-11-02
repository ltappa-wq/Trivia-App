vi.mock("@/lib/participantAuth", () => ({ authorizePacingToken: vi.fn().mockResolvedValue(undefined) }));
import { beforeEach, describe, expect, it, vi } from "vitest";
const { rpc, broadcast } = vi.hoisted(() => ({ rpc: vi.fn(), broadcast: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ rpc }) }));
vi.mock("@/lib/realtime/broadcast", () => ({ broadcastToRoom: broadcast }));
import { autoAdvance, setReviewAutoAdvance } from "../autoAdvance";

beforeEach(() => { vi.clearAllMocks(); rpc.mockResolvedValue({ data: true }); });
describe("review auto-advance actions", () => {
  it("passes participant credentials and expected index to the deadline-gated RPC", async () => {
    expect(await autoAdvance("12345", "player", 2)).toBe(true);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("auto_advance_question", { p_code: "12345", p_token: "player", p_expected_index: 2 });
    expect(broadcast).toHaveBeenCalledWith("12345", "question", { index: 3 });
  });
  it("does not broadcast an early, paused, final, or stale no-op", async () => {
    rpc.mockResolvedValue({ data: false });
    expect(await autoAdvance("12345", "player", 2)).toBe(false);
    expect(broadcast).not.toHaveBeenCalled();
  });
  it("delegates schedule changes to the atomic host-token gate", async () => {
    expect(await setReviewAutoAdvance("12345", "host", 2, false)).toBe(true);
    expect(rpc).toHaveBeenCalledWith("set_review_auto_advance", { p_code: "12345", p_token: "host", p_expected_index: 2, p_enabled: false });
    expect(broadcast).toHaveBeenCalledWith("12345", "review", { index: 2 });
  });
  it("reports authorization errors without broadcasting", async () => {
    rpc.mockResolvedValue({ error: { message: "Host token required" } });
    await expect(setReviewAutoAdvance("12345", "player", 2, false)).rejects.toThrow("Host token required");
    expect(broadcast).not.toHaveBeenCalled();
  });
  it("rejects invalid indices before a database request", async () => {
    expect(await autoAdvance("12345", "player", -1)).toBe(false);
    expect(await setReviewAutoAdvance("12345", "host", 0.5, true)).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
