// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useRoomState } from "../hooks";
import { ROOM_EVENTS } from "../events";
import type { RoomHandlers } from "../channel";

const mocks = vi.hoisted(() => ({
  hydrate: vi.fn(async (_token: string) => null),
  handlers: {} as RoomHandlers,
  subscribed: undefined as (() => void) | undefined,
  unsubscribe: vi.fn(),
}));
vi.mock("../channel", () => ({
  hydrate: mocks.hydrate,
  subscribeToRoom: (_code: string, handlers: RoomHandlers, subscribed: () => void) => {
    mocks.handlers = handlers;
    mocks.subscribed = subscribed;
    return mocks.unsubscribe;
  },
}));
vi.mock("@/app/actions/serverTime", () => ({ serverNow: vi.fn() }));
vi.mock("../clock", async (original) => ({
  ...await original<typeof import("../clock")>(), measureClockOffset: async () => 0,
}));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

it("coalesces broadcasts while keeping phase events, reconnect, and refresh immediate", async () => {
  vi.useFakeTimers();
  const { result, unmount } = renderHook(() => useRoomState("ABC123", "player"));
  await act(async () => {});
  expect(mocks.hydrate).toHaveBeenCalledWith("player");
  mocks.hydrate.mockClear();
  act(() => { for (let i = 0; i < 10; i++) mocks.handlers[ROOM_EVENTS.leaderboard]?.({}); });
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(mocks.hydrate).toHaveBeenCalledTimes(1);
  for (const event of [ROOM_EVENTS.question, ROOM_EVENTS.review, ROOM_EVENTS.pause,
    ROOM_EVENTS.resume, ROOM_EVENTS.void, ROOM_EVENTS.results]) {
    mocks.hydrate.mockClear();
    await act(async () => { mocks.handlers[event]?.({}); });
    expect(mocks.hydrate).toHaveBeenCalledTimes(1);
  }
  mocks.hydrate.mockClear();
  await act(async () => { mocks.subscribed?.(); });
  expect(mocks.hydrate).toHaveBeenCalledTimes(1);
  await act(async () => { await result.current.refresh(); });
  expect(mocks.hydrate).toHaveBeenCalledTimes(2);
  act(() => { mocks.handlers[ROOM_EVENTS.leaderboard]?.({}); });
  unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(mocks.hydrate).toHaveBeenCalledTimes(2);
  expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
});
