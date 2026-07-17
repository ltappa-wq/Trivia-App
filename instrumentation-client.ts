// Sentry initialization for the browser. Uses the public DSN (inlined at build).
// No-ops without a DSN, so the client bundle is unaffected until configured.

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  enabled: process.env.NODE_ENV === "production",
});

// Instrument App Router client-side navigations (Next.js 15.3+).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
