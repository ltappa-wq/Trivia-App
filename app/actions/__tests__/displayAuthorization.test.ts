import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashToken } from "@/lib/codes";
const { rpc, from, broadcast, lookup, update } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), broadcast: vi.fn(), lookup: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ rpc, from }) }));
vi.mock("@/lib/realtime/broadcast", () => ({ broadcastToRoom: broadcast }));
import { closeQuestion } from "../closeQuestion";
import { autoAdvance, setReviewAutoAdvance } from "../autoAdvance";
import { advance } from "../advance";
import { endGame } from "../endGame";
import { startGame } from "../startGame";
import { adjudicate } from "../adjudicate";
import { challenge } from "../challenge";
import { submitAnswer } from "../submitAnswer";
import { updateDisplayLink } from "../displayLink";
vi.mock("next/headers", () => ({ headers: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: [{ game_id: "g", role: "display", player_id: null }], error: null });
  lookup.mockResolvedValue({ data: [{ id: "g", code: "12345", host_token_hash: hashToken("host-secret") }], error: null });
  from.mockReturnValue({ select: () => ({ eq: Object.assign(lookup, { maybeSingle: undefined }) }), update });
});
describe("display tokens cannot invoke game mutation actions", () => {
  it.each([
    ["close", () => closeQuestion("12345", "display", 0)],
    ["force close", () => closeQuestion("12345", "display", 0, true)],
    ["auto advance", () => autoAdvance("12345", "display", 0)],
    ["change schedule", () => setReviewAutoAdvance("12345", "display", 0, true)],
  ] as const)("rejects %s before invoking a mutation RPC", async (_, action) => {
    await expect(action()).rejects.toThrow("Not authorized");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("resolve_token", { p_token: "display" });
    expect(broadcast).not.toHaveBeenCalled();
  });
  it.each([null, "unknown", undefined])("rejects future/missing role %s", async role => {
    rpc.mockResolvedValue({ data: [{ role }] });
    await expect(autoAdvance("12345", "t", 0)).rejects.toThrow("Not authorized");
    expect(rpc).toHaveBeenCalledOnce();
  });
  it.each(["host", "player", "spectator"])("preserves %s participant pacing", async role => {
    rpc.mockImplementation((name: string) => Promise.resolve({ data: name === "resolve_token" ? [{ role }] : true }));
    expect(await autoAdvance("12345", "participant", 0)).toBe(true);
    expect(rpc).toHaveBeenCalledWith("auto_advance_question", expect.anything());
  });
  it.each([
    ["advance", () => advance("12345", "display", 0)],
    ["end", () => endGame("12345", "display")],
    ["start", () => startGame("12345", "display", [])],
    ["adjudicate", () => adjudicate("12345", "display", "c", "reject")],
    ["mint display", () => updateDisplayLink("12345", "display")],
    ["revoke display", () => updateDisplayLink("12345", "display", true)],
  ] as const)("rejects %s through the real host-hash gate", async (_, action) => {
    await expect(action()).rejects.toThrow("Not authorized");
    expect(rpc).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
  });
  it.each([
    ["answer", () => submitAnswer("display", "0")],
    ["challenge", () => challenge("display", "question")],
  ] as const)("rejects %s through the real player-hash gate", async (_, action) => {
    from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) });
    await expect(action()).rejects.toThrow("Invalid player token");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("host can mint hashed credentials and revoke them", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null }); update.mockReturnValue({ eq });
    const token = await updateDisplayLink("12345", "host-secret");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(update).toHaveBeenCalledWith({ display_token_hash: hashToken(token!) });
    expect(eq).toHaveBeenCalledWith("id", "g");
    expect(await updateDisplayLink("12345", "host-secret", true)).toBeNull();
    expect(update).toHaveBeenLastCalledWith({ display_token_hash: null });
  });
});
