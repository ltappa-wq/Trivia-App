// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GenerationProgressButton } from "../GenerationProgressButton";

const fetchProgress = vi.fn();
function progress(completed: number, running = true, error: string | null = null) {
  return { ok: true, json: async () => ({ completed, total: 100, running, error }) };
}
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

it("recovers progress after mount/reload, polls incrementally, and allows Retry on failure", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchProgress);
  fetchProgress.mockResolvedValueOnce(progress(36))
    .mockResolvedValueOnce(progress(72))
    .mockResolvedValue(progress(72, false, "Provider timed out. Please retry."));
  const onStart = vi.fn(async () => {});
  await act(async () => { render(<GenerationProgressButton code="12345" token="host" total={100} starting={false} disabled={false} onStart={onStart} />); });
  expect((screen.getByRole("button", { name: "Writing questions… 36/100" }) as HTMLButtonElement).disabled).toBe(true);
  expect(fetchProgress).toHaveBeenCalledWith("/api/generation-progress?code=12345", expect.objectContaining({
    headers: { Authorization: "Bearer host" }, cache: "no-store",
  }));
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(screen.getByRole("button", { name: "Writing questions… 72/100" })).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(screen.getByRole("alert").textContent).toContain("Please retry");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(onStart).toHaveBeenCalledOnce();
});

it("advances HTTP progress while the host's own Start action is still pending", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchProgress);
  let finishStart!: () => void;
  const startGame = vi.fn(() => new Promise<void>((resolve) => { finishStart = resolve; }));
  let finished = false;
  function Lobby() {
    const [starting, setStarting] = useState(false);
    return <GenerationProgressButton code="12345" token="host" total={100} starting={starting} disabled={false}
      onStart={async () => {
        setStarting(true);
        await startGame(); // Holds the action queue until the test releases it.
        finished = true;
        setStarting(false);
      }} />;
  }
  fetchProgress.mockResolvedValueOnce(progress(0, false))
    .mockResolvedValueOnce(progress(0))
    .mockResolvedValueOnce(progress(36))
    .mockResolvedValue(progress(72));
  await act(async () => { render(<Lobby />); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Start game" })); });
  expect(startGame).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Writing questions… 0/100" })).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(screen.getByRole("button", { name: "Writing questions… 36/100" })).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(screen.getByRole("button", { name: "Writing questions… 72/100" })).toBeTruthy();
  expect(finished).toBe(false);
  expect(fetchProgress).toHaveBeenCalledTimes(4);
  await act(async () => { finishStart(); });
  expect(finished).toBe(true);
});

it("keeps polling after an HTTP failure without enabling a second Start", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchProgress);
  fetchProgress.mockResolvedValueOnce({ ok: false }).mockResolvedValue(progress(36));
  await act(async () => { render(<GenerationProgressButton code="12345" token="host" total={100} starting={true} disabled={false} onStart={vi.fn()} />); });
  expect(screen.getByText(/Reconnecting/)).toBeTruthy();
  expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(screen.getByRole("button", { name: "Writing questions… 36/100" })).toBeTruthy();
  expect(screen.queryByText(/Reconnecting/)).toBeNull();
});

it.each(["HTTP", "network"])("enables Start after an initial %s progress failure, even if polling keeps failing", async (failure) => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchProgress);
  let failFirstRead!: () => void;
  fetchProgress.mockImplementationOnce(() => new Promise((resolve, reject) => {
    failFirstRead = () => failure === "HTTP" ? resolve({ ok: false }) : reject(new Error("Network unavailable"));
  })).mockRejectedValue(new Error("Still unavailable"));
  const onStart = vi.fn(async () => {});
  await act(async () => { render(<GenerationProgressButton code="12345" token="host" total={100} starting={false} disabled={false} onStart={onStart} />); });
  const button = screen.getByRole("button", { name: "Start game" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  await act(async () => { failFirstRead(); });
  expect(screen.getByText(/Reconnecting/)).toBeTruthy();
  expect(button.disabled).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(fetchProgress).toHaveBeenCalledTimes(2);
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  expect(onStart).toHaveBeenCalledOnce();
});

it("offers optional review beside default Start, and hides it once prepared", async () => {
  vi.stubGlobal("fetch", fetchProgress); fetchProgress.mockResolvedValue(progress(0, false));
  const onReview = vi.fn(async () => {});
  const props = { code: "12345", token: "host", total: 2, starting: false, disabled: false, onStart: vi.fn(), onReview };
  const view = await act(async () => render(<GenerationProgressButton {...props} />));
  expect(screen.getByRole("button", { name: "Start game" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Review questions first" }));
  expect(onReview).toHaveBeenCalledOnce();
  view.rerender(<GenerationProgressButton {...props} prepared />);
  expect(screen.queryByRole("button", { name: "Review questions first" })).toBeNull();
});
it("allows review before players join and preserves review mode on Retry", async () => {
  vi.stubGlobal("fetch", fetchProgress);
  fetchProgress.mockResolvedValue(progress(0, false, "Please retry"));
  const onReview = vi.fn(async () => {}); const onStart = vi.fn(async () => {});
  const props = { code: "12345", token: "host", total: 2, starting: false, disabled: true, reviewDisabled: false, onStart, onReview };
  const view = await act(async () => render(<GenerationProgressButton {...props} />));
  expect((screen.getByRole("button", { name: "Review questions first" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Review questions first" }));
  await act(async () => { view.rerender(<GenerationProgressButton {...props} starting disabled={false} />); });
  await act(async () => { view.rerender(<GenerationProgressButton {...props} disabled={false} />); });
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(onReview).toHaveBeenCalledTimes(2); expect(onStart).not.toHaveBeenCalled();
});
