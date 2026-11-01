// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useScopedState } from "../useScopedState";
afterEach(cleanup);
it("retains values within a phase and clears them immediately on every transition", () => {
  const { result, rerender } = renderHook(({ scope }) => useScopedState<string | null>(scope, null), { initialProps: { scope: "q1:review" } });
  act(() => result.current[1]("answer"));
  const setter = result.current[1];
  rerender({ scope: "q1:review" });
  expect(result.current[0]).toBe("answer");
  rerender({ scope: "q2:play" });
  expect(result.current[0]).toBeNull();
  expect(result.current[1]).toBe(setter);
  rerender({ scope: "q1:review" });
  expect(result.current[0]).toBeNull();
});
