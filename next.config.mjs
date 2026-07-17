import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Allow Server Actions when the app is reached through a proxied host
    // (e.g. GitHub Codespaces / port forwarding), where the forwarded host
    // differs from the origin. Safe for local dev.
    serverActions: {
      allowedOrigins: ["*.app.github.dev", "localhost:3000"],
    },
  },
};

// Wrap with Sentry: uploads source maps at build time when SENTRY_AUTH_TOKEN /
// SENTRY_ORG / SENTRY_PROJECT are set (otherwise it just skips upload with a
// warning — the build still succeeds). Runtime error capture is driven by the
// DSN in the sentry.*.config / instrumentation-client files.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Quiet during local builds; verbose in CI (where CI is set).
  silent: !process.env.CI,
  // Upload a wider set of client source maps for better stack traces.
  widenClientFileUpload: true,
});
