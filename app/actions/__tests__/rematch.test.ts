import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rpc: vi.fn(), broadcast: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ rpc: m.rpc }) }));
vi.mock("@/lib/serverRequest", () => ({ callerIp: async () => "ip" }));
vi.mock("@/lib/realtime/broadcast", () => ({ broadcastToRoom: m.broadcast }));
import { createRematch, joinRematch } from "../rematch";
beforeEach(() => vi.clearAllMocks());
it("passes the shared create limit key and broadcasts no credentials", async () => {
  m.rpc.mockResolvedValue({ data: { code: "54321", hostToken: "secret" }, error: null });
  await createRematch("12345", "host");
  expect(m.rpc).toHaveBeenCalledWith("create_rematch", { p_code: "12345", p_token: "host", p_rate_key: "create:ip" });
  expect(m.broadcast).toHaveBeenCalledWith("12345", "rematch", {});
});
it("never accepts a destination supplied by a player", async () => {
  m.rpc.mockResolvedValue({ data: { code: "54321", token: "new", playerId: "p", username: "Alex", isSpectator: false }, error: null });
  await joinRematch("12345", "old");
  expect(m.rpc).toHaveBeenCalledWith("join_rematch", { p_code: "12345", p_token: "old" });
  expect(m.broadcast.mock.calls[0][2]).not.toHaveProperty("token");
});
it("does not broadcast a rejected authorization", async () => {
  m.rpc.mockResolvedValue({ data: null, error: { message: "No authorized rematch" } });
  await expect(joinRematch("12345", "other-game")).rejects.toThrow("No authorized rematch");
  expect(m.broadcast).not.toHaveBeenCalled();
});
