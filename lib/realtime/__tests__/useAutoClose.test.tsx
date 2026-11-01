// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientGame } from "@/lib/db/types";
import { useAutoClose } from "../useAutoClose";

const close = vi.hoisted(() => vi.fn());
vi.mock("@/app/actions/closeQuestion", () => ({ closeQuestion: close }));
const game: ClientGame = { id: "g", code: "12345", status: "active", paused: false, reviewing: false, current_index: 0, reveal_at: new Date(0).toISOString(), answer_mode: "multiple_choice", question_count: 3, difficulty: "medium" };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(20000);
  close.mockReset().mockResolvedValue({ status: "reviewing", index: 0 });
  vi.spyOn(Math, "random").mockReturnValue(0.99);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

describe("useAutoClose", () => {
  it.each([0, 0.99])("lets a player close after the fallback delay without a host (jitter %s)", async (random) => {
    vi.mocked(Math.random).mockReturnValue(random);
    renderHook(() => useAutoClose("12345", "player", game, 0, false));
    await advance(1900);
    expect(close).not.toHaveBeenCalled();
    await advance(random === 0 ? 100 : 1100);
    expect(close).toHaveBeenCalledExactlyOnceWith("12345", "player", 0);
    await advance(10000);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("host also closes after grace without player jitter", async () => {
    renderHook(() => useAutoClose("12345", "host", game, 0, true));
    await advance(800);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("lets the host close first and cancels every player's pending fallback on review", async () => {
    vi.mocked(Math.random).mockReturnValue(0);
    const { rerender } = renderHook(({ g }) => {
      useAutoClose("12345", "host", g, 0, true);
      useAutoClose("12345", "player-1", g, 0, false);
      useAutoClose("12345", "player-2", g, 0, false);
    }, { initialProps: { g: game } });
    await advance(700);
    expect(close).not.toHaveBeenCalled();
    await advance(100);
    expect(close).toHaveBeenCalledExactlyOnceWith("12345", "host", 0);
    // Existing room reconciliation receives the host's review broadcast.
    rerender({ g: { ...game, reviewing: true } });
    await advance(10000);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("retries early no-ops and failures but bounds calls per question", async () => {
    close.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ status: "noop" });
    renderHook(() => useAutoClose("12345", "player", game, 0, false));
    await advance(20000);
    expect(close).toHaveBeenCalledTimes(6);
  });
  it("suppresses paused/review/ended and resets on the next question", async () => {
    const { rerender } = renderHook(({ g }) => useAutoClose("12345", "p", g, 0, false), { initialProps: { g: { ...game, paused: true } } });
    await advance(3100);
    expect(close).not.toHaveBeenCalled();
    rerender({ g: { ...game, paused: false } });
    await advance(100);
    expect(close).toHaveBeenCalledTimes(1);
    rerender({ g: { ...game, paused: false, reviewing: true } });
    await advance(2000);
    expect(close).toHaveBeenCalledTimes(1);
    rerender({ g: { ...game, paused: false, status: "ended" } });
    await advance(2000);
    expect(close).toHaveBeenCalledTimes(1);
    rerender({ g: { ...game, paused: false, current_index: 1, reveal_at: new Date(Date.now()).toISOString() } });
    await advance(23000);
    expect(close).toHaveBeenLastCalledWith("12345", "p", 1);
  });
  it("uses the corrected clock and cancels on unmount", async () => {
    const { unmount } = renderHook(() => useAutoClose("12345", "p", game, -5000, false));
    await advance(1000);
    expect(close).not.toHaveBeenCalled();
    unmount();
    await advance(10000);
    expect(close).not.toHaveBeenCalled();
  });
});
