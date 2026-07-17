"use client";
// Root error boundary. Next.js renders this in place of the whole document when
// an error escapes the root layout, so it must supply its own <html>/<body> and
// pull in global styling itself. It reports the error to Sentry and offers a
// retry. Regular route errors are handled closer to the page; this is the last
// resort for render-time failures.

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main>
          <h1>Something went wrong</h1>
          <p>An unexpected error broke this screen. It&rsquo;s been reported.</p>
          <button type="button" onClick={() => reset()}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
