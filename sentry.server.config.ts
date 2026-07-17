// Sentry initialization for the Node.js server runtime (server actions, RSC,
// route handlers). Loaded via instrumentation.ts `register()`. No-ops when no
// DSN is configured, so local dev / preview run unchanged until SENTRY_DSN is
// set. Errors are always captured; `tracesSampleRate` controls performance
// tracing volume (tune down to 0 for errors-only).

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  // Send events only from real deployments, not local dev noise.
  enabled: process.env.NODE_ENV === "production",
});
