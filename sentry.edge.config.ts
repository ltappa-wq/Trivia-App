// Sentry initialization for the Edge runtime (middleware and any edge routes).
// This app has no edge middleware today, but the config is wired for parity so
// anything that later runs on the edge is covered. Loaded via instrumentation.ts.

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  enabled: process.env.NODE_ENV === "production",
});
