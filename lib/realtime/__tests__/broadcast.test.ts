import { describe, expect, it, vi } from "vitest";
import { broadcastToRoom } from "../broadcast";
import { roomChannel, ROOM_EVENTS } from "../events";

const config = { url: "https://x.supabase.co", serviceKey: "svc" };

describe("broadcastToRoom (KTD8 delta layer)", () => {
  it("posts to the realtime broadcast endpoint with the room topic", async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) => ({ ok: true }) as Response,
    );
    const ok = await broadcastToRoom(
      "ab2xk9",
      ROOM_EVENTS.playerJoined,
      { username: "Ada" },
      { ...config, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://x.supabase.co/realtime/v1/api/broadcast");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.messages[0].topic).toBe(roomChannel("AB2XK9"));
    expect(body.messages[0].event).toBe(ROOM_EVENTS.playerJoined);
    expect(body.messages[0].payload).toEqual({ username: "Ada" });
  });

  it("returns false (never throws) when the emit fails — the delta self-heals on hydrate", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    await expect(
      broadcastToRoom("ab2xk9", ROOM_EVENTS.pause, {}, { ...config, fetchImpl }),
    ).resolves.toBe(false);
  });

  it("returns false when env/config is missing", async () => {
    expect(await broadcastToRoom("ab2xk9", ROOM_EVENTS.resume, {}, {})).toBe(false);
  });
});
