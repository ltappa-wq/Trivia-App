// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Podium } from "../Podium";
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("preserves reveals for identical hydration and restarts for rescored standings", () => {
  vi.useFakeTimers();
  const standings = [{ id: "a", username: "Ada", score: 100 }];
  const { container, rerender } = render(<Podium standings={standings} />);
  act(() => vi.advanceTimersByTime(900));
  expect(container.querySelectorAll(".is-revealed")).toHaveLength(1);
  rerender(<Podium standings={standings.map(p => ({ ...p }))} />);
  expect(container.querySelectorAll(".is-revealed")).toHaveLength(1);
  rerender(<Podium standings={[{ ...standings[0]!, score: 200 }]} />);
  expect(container.querySelectorAll(".is-revealed")).toHaveLength(0);
  act(() => vi.advanceTimersByTime(900));
  expect(container.querySelectorAll(".is-revealed")).toHaveLength(1);
});
