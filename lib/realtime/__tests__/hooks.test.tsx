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
    ROOM_EVENTS.resume, ROOM_EVENTS.void, ROOM_EVENTS.results, ROOM_EVENTS.rematch]) {
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

it("updates the join callback without resubscribing and handles an absent token", async () => {
  const first = vi.fn();
  const next = vi.fn();
  const { result, rerender } = renderHook(({ callback, token }) => useRoomState("ABC123", token, callback), { initialProps: { callback: first, token: "player" as string | null } });
  await act(async () => {});
  const handlers = mocks.handlers;
  rerender({ callback: next, token: "player" });
  act(() => mocks.handlers[ROOM_EVENTS.playerJoined]?.({ username: "Ada" }));
  expect(first).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalledWith({ username: "Ada" });
  expect(mocks.handlers).toBe(handlers);
  rerender({ callback: next, token: null });
  expect(result.current.loading).toBe(false);
});

it("derives get-ready and countdown resets while freezing the paused display", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  const { useCountdown, useIsGetReady } = await import("../hooks");
  const reveal = new Date(Date.now() + 1000).toISOString();
  const { result, rerender } = renderHook(({ at, paused }) => ({
    ready: useIsGetReady(at, 0),
    remaining: useCountdown(at, 10_000, 0, paused),
  }), { initialProps: { at: reveal as string | null, paused: false } });
  expect(result.current.ready).toBe(true);
  expect(result.current.remaining).toBe(10_000);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(result.current.ready).toBe(false);
  expect(result.current.remaining).toBe(9000);
  rerender({ at: reveal, paused: true });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(result.current.remaining).toBe(9000);
  rerender({ at: null, paused: true });
  expect(result.current.ready).toBe(false);
  expect(result.current.remaining).toBeNull();
  rerender({ at: new Date(Date.now() + 1000).toISOString(), paused: false });
  expect(result.current.ready).toBe(true);
  expect(result.current.remaining).toBe(10_000);
});
