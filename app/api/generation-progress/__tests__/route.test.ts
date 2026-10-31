import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "../route";

const { authorize, client } = vi.hoisted(() => ({ authorize: vi.fn(), client: {} }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => client }));
vi.mock("@/lib/serverAuth", () => ({ authorizeHostByCode: authorize }));

function request(token?: string, code = "12345") {
  return new Request(`http://localhost/api/generation-progress?code=${code}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(() => { vi.resetAllMocks(); });

it("returns only progress for the authorized host and forbids caching", async () => {
  authorize.mockResolvedValue({ question_count: 100, generation_progress: 36,
    generation_started_at: new Date().toISOString(), host_token_hash: "private" });
  const response = await GET(request("host-token"));
  expect(authorize).toHaveBeenCalledWith(client, "12345", "host-token");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ completed: 36, total: 100, running: true, error: null });
});

it("rejects missing credentials before querying the database", async () => {
  const response = await GET(request());
  expect(response.status).toBe(401);
  expect(authorize).not.toHaveBeenCalled();
  expect(response.headers.get("cache-control")).toContain("no-store");
});

it("rejects an invalid room code before querying the database", async () => {
  expect((await GET(request("host-token", "bad"))).status).toBe(400);
  expect(authorize).not.toHaveBeenCalled();
});

it.each(["Not authorized", "Game not found", "Lookup failed: private detail"])("does not disclose %s", async (message) => {
  authorize.mockRejectedValue(new Error(message));
  const response = await GET(request("wrong-or-player-token"));
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "Could not load generation progress" });
  expect(response.headers.get("cache-control")).toContain("no-store");
});
