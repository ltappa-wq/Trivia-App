// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useAutoAdvance } from "../useAutoAdvance";
import type { ClientGame } from "@/lib/db/types";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/app/actions/autoAdvance", () => ({ autoAdvance: request }));
const game: ClientGame = { id: "g", code: "12345", status: "active", answer_mode: "multiple_choice", difficulty: "medium", question_count: 3, current_index: 0, reveal_at: null, paused: false, reviewing: true, auto_advance_ms: 8000, auto_advance_at: new Date(8000).toISOString() };
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); request.mockReset(); });
it("a participant advances a due review without a host tab and retries failures", async () => {
  vi.useFakeTimers(); vi.setSystemTime(0); vi.spyOn(Math, "random").mockReturnValue(0);
  request.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(true);
  renderHook(() => useAutoAdvance("12345", "player-token", game, 0));
  await act(async () => { await vi.advanceTimersByTimeAsync(7999); });
  expect(request).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(request).toHaveBeenCalledWith("12345", "player-token", 0);
  await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
  expect(request).toHaveBeenCalledTimes(2);
});
it("cancels when paused and starts from a new server deadline on resume", async () => {
  vi.useFakeTimers(); vi.setSystemTime(0); vi.spyOn(Math, "random").mockReturnValue(0);
  request.mockResolvedValue(true);
  const { rerender } = renderHook(({ value }) => useAutoAdvance("12345", "player", value, 0), { initialProps: { value: game } });
  rerender({ value: { ...game, paused: true } });
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(request).not.toHaveBeenCalled();
  rerender({ value: { ...game, auto_advance_at: new Date(18000).toISOString() } });
  await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
  expect(request).toHaveBeenCalledTimes(1);
});
