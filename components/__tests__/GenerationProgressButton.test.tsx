// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GenerationProgressButton } from "../GenerationProgressButton";

const getProgress = vi.hoisted(() => vi.fn());
vi.mock("@/app/actions/startGame", () => ({ getGenerationProgress: getProgress }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

it("recovers progress after mount/reload, polls incrementally, and allows Retry on failure", async () => {
  vi.useFakeTimers();
  getProgress.mockResolvedValueOnce({ completed: 36, total: 100, running: true, error: null })
    .mockResolvedValueOnce({ completed: 72, total: 100, running: true, error: null })
    .mockResolvedValue({ completed: 72, total: 100, running: false, error: "Provider timed out. Please retry." });
  const onStart = vi.fn(async () => {});
  await act(async () => { render(<GenerationProgressButton code="12345" token="host" total={100} starting={false} disabled={false} onStart={onStart} />); });
  expect((screen.getByRole("button", { name: "Writing questions… 36/100" }) as HTMLButtonElement).disabled).toBe(true);
  expect(getProgress).toHaveBeenCalledWith("12345", "host");
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(screen.getByRole("button", { name: "Writing questions… 72/100" })).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(screen.getByRole("alert").textContent).toContain("Please retry");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(onStart).toHaveBeenCalledOnce();
});
