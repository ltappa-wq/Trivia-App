/** Coalesce noisy events; urgent requests bypass timers but never overlap work.
 * The max wait bounds scheduling delay, not network latency. */
export function createReconciler(
  reconcile: () => Promise<void>,
  delay = 250,
  maxWait = 1000,
) {
  let trailing: ReturnType<typeof setTimeout> | undefined;
  let maximum: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | null = null;
  let pending = false;
  let disposed = false;

  function clearTimers() {
    clearTimeout(trailing);
    clearTimeout(maximum);
    trailing = maximum = undefined;
  }

  function immediate(): Promise<void> {
    if (disposed) return Promise.resolve();
    clearTimers();
    pending = true;
    if (!running) {
      // Start in a microtask so running is installed even for synchronous errors.
      running = Promise.resolve().then(async () => {
        try {
          while (pending && !disposed) {
            pending = false;
            await reconcile();
          }
        } finally {
          running = null;
        }
      });
    }
    return running;
  }

  function schedule() {
    if (disposed) return;
    if (running) {
      pending = true;
      return;
    }
    clearTimeout(trailing);
    const flush = () => { void immediate().catch(() => {}); };
    trailing = setTimeout(flush, delay);
    maximum ??= setTimeout(flush, maxWait);
  }

  return {
    immediate,
    schedule,
    dispose() {
      disposed = true;
      pending = false;
      clearTimers();
    },
  };
}
