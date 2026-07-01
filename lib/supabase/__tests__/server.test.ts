import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// U1 smoke test: the server Supabase client instantiates from env, and fails
// loudly when env is missing. Uses module resets so the memoized singleton
// doesn't leak across cases.

const ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

describe("getServiceClient", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    vi.resetModules();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("instantiates a client when env is present", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
    const { getServiceClient } = await import("../server");
    const client = getServiceClient();
    expect(client).toBeTruthy();
    expect(typeof client.from).toBe("function");
  });

  it("throws when required env is missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { getServiceClient } = await import("../server");
    expect(() => getServiceClient()).toThrow(/Missing/);
  });
});
