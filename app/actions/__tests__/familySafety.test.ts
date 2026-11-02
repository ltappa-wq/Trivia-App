import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({}) }));
vi.mock("@/lib/serverAuth", () => ({ authorizeHostByCode: m.authorize }));
import { getFamilySafetySummary } from "../familySafety";
beforeEach(() => vi.clearAllMocks());
it("returns only the stored setting and count to the authorized host", async () => {
  m.authorize.mockResolvedValue({ family_friendly: true, family_replaced_count: 3, host_token_hash: "private" });
  expect(await getFamilySafetySummary("12345", "host")).toEqual({ enabled: true, replaced: 3 });
  expect(m.authorize).toHaveBeenCalledWith({}, "12345", "host");
});
it("rejects forged credentials and defaults old games off", async () => {
  m.authorize.mockRejectedValueOnce(new Error("Not authorized"));
  await expect(getFamilySafetySummary("12345", "player")).rejects.toThrow("Not authorized");
  m.authorize.mockResolvedValue({});
  expect(await getFamilySafetySummary("12345", "host")).toEqual({ enabled: false, replaced: 0 });
});
