import { afterEach, describe, expect, it, vi } from "vitest";
import { createReconciler } from "../reconcile";

afterEach(() => vi.useRealTimers());

describe("room reconciliation", () => {
  it("coalesces ten leaderboard events into one trailing hydrate", async () => {
    vi.useFakeTimers();
    const hydrate = vi.fn(async () => {});
    const queue = createReconciler(hydrate);
    for (let i = 0; i < 10; i++) queue.schedule();
    await vi.advanceTimersByTimeAsync(249);
    expect(hydrate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(hydrate).toHaveBeenCalledTimes(1);
  });

  it("bounds continuous chatter to a maximum one-second scheduling delay", async () => {
    vi.useFakeTimers();
    const hydrate = vi.fn(async () => {});
    const queue = createReconciler(hydrate);
    for (let i = 0; i < 10; i++) {
      queue.schedule();
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(hydrate).toHaveBeenCalledTimes(1);
  });

  it("flushes phase changes and reconnects immediately, cancelling trailing work", async () => {
    vi.useFakeTimers();
    const hydrate = vi.fn(async () => {});
    const queue = createReconciler(hydrate);
    queue.schedule();
    await queue.immediate();
    expect(hydrate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(hydrate).toHaveBeenCalledTimes(1);
  });

  it("queues only one follow-up for events arriving during a slow hydrate", async () => {
    let finish!: () => void;
    const hydrate = vi.fn().mockImplementationOnce(() => new Promise<void>((r) => { finish = r; }))
      .mockResolvedValue(undefined);
    const queue = createReconciler(hydrate);
    const done = queue.immediate();
    await Promise.resolve();
    for (let i = 0; i < 10; i++) queue.schedule();
    void queue.immediate();
    expect(hydrate).toHaveBeenCalledTimes(1);
    finish();
    await done;
    expect(hydrate).toHaveBeenCalledTimes(2);
  });

  it("cancels pending work on teardown, including an in-flight follow-up", async () => {
    vi.useFakeTimers();
    const hydrate = vi.fn(async () => {});
    const queue = createReconciler(hydrate);
    queue.schedule();
    queue.dispose();
    await vi.advanceTimersByTimeAsync(1500);
    await queue.immediate();
    expect(hydrate).not.toHaveBeenCalled();
  });
});
