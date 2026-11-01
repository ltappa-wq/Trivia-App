// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useDisplayPage } from "../useDisplayPage";
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("rotates all presentation pages without changing game state and resets with the phase", () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(({ scope, count }) => useDisplayPage(count, 8, scope), { initialProps: { scope: "q0:review", count: 18 } });
  expect(result.current).toEqual({ start: 0, page: 1, pages: 3 });
  act(() => vi.advanceTimersByTime(8000)); expect(result.current.start).toBe(8);
  act(() => vi.advanceTimersByTime(8000)); expect(result.current.start).toBe(16);
  act(() => vi.advanceTimersByTime(8000)); expect(result.current.start).toBe(0);
  rerender({ scope: "q1:review", count: 18 }); expect(result.current.start).toBe(0);
  act(() => vi.advanceTimersByTime(8000)); expect(result.current.start).toBe(8);
  rerender({ scope: "q1:review", count: 2 }); expect(result.current).toEqual({ start: 0, page: 1, pages: 1 });
});
