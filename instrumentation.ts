// Next.js instrumentation hook. `register()` loads the runtime-appropriate
// Sentry config once per server process; `onRequestError` forwards errors thrown
// in React Server Components, route handlers, and Server Actions to Sentry.

import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
