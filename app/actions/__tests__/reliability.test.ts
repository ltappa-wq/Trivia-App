vi.mock("@/lib/participantAuth", () => ({ authorizePacingToken: vi.fn().mockResolvedValue(undefined) }));
import { beforeEach, describe, expect, it, vi } from "vitest";
const { rpc, authorize, broadcast } = vi.hoisted(() => ({ rpc: vi.fn(), authorize: vi.fn(), broadcast: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ rpc }) }));
vi.mock("@/lib/serverAuth", () => ({ authorizeHostByCode: authorize }));
vi.mock("@/lib/realtime/broadcast", () => ({ broadcastToRoom: broadcast }));
import { closeQuestion } from "../closeQuestion";
import { endGame } from "../endGame";

beforeEach(() => { vi.clearAllMocks(); rpc.mockResolvedValue({ data: true, error: null }); authorize.mockResolvedValue({ id: "g", code: "12345" }); });
describe("closeQuestion", () => {
  it("passes participant credentials to the atomic authorization/deadline RPC", async () => {
    expect(await closeQuestion("12345", "player-token", 2)).toEqual({ status: "reviewing", index: 2 });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("close_question", { p_token: "player-token", p_code: "12345", p_expected_index: 2, p_force: false });
    expect(broadcast).toHaveBeenCalledOnce();
  });
  it("an early or stale request is a silent no-op without broadcasting", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await closeQuestion("12345", "p", 0)).toEqual({ status: "noop" });
    expect(broadcast).not.toHaveBeenCalled();
  });
  it("passes early-close requests through the RPC's host gate", async () => {
    rpc.mockResolvedValue({ error: { message: "Host token required" } });
    await expect(closeQuestion("12345", "player", 0, true)).rejects.toThrow("Host token required");
    expect(broadcast).not.toHaveBeenCalled();
  });
  it("rejects invalid indexes without touching the database", async () => {
    await closeQuestion("12345", "p", -1);
    await closeQuestion("12345", "p", 0.5);
    expect(rpc).not.toHaveBeenCalled();
  });
});
describe("endGame", () => {
  it("authorizes the host then uses a single atomic write RPC", async () => {
    await endGame("12345", "host");
    expect(authorize).toHaveBeenCalledWith(expect.anything(), "12345", "host");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("end_game", { p_game_id: "g" });
    expect(broadcast).toHaveBeenCalledOnce();
  });
  it("already-ended is idempotent without a broadcast", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(endGame("12345", "h")).resolves.toEqual({ ended: true });
    expect(broadcast).not.toHaveBeenCalled();
  });
  it("does not write for an unauthorized token", async () => {
    authorize.mockRejectedValueOnce(new Error("Not authorized"));
    await expect(endGame("12345", "p")).rejects.toThrow("Not authorized");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("does not broadcast failed transactions", async () => {
    rpc.mockResolvedValue({ error: { message: "transaction failed" } });
    await expect(endGame("12345", "h")).rejects.toThrow("transaction failed");
    expect(broadcast).not.toHaveBeenCalled();
  });
});
