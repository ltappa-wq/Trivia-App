"use client";
// U6. Between-question "get ready" lead-in. Shown by the host and play views for
// the brief window after a question is revealed but before its answer window
// opens (LEAD_IN_MS). The prompt and answer affordances stay hidden until the
// count reaches zero, so everyone gets the question at the same moment. The
// remaining time is server-anchored (useLeadInCountdown) so the 3-2-1 lands in
// step across devices.

export function LeadIn({ remaining }: { remaining: number }) {
  const seconds = Math.max(1, Math.ceil(remaining / 1000));
  return (
    <div className="lead-in" aria-live="assertive">
      <p className="lead-in__label">Get ready…</p>
      <p className="lead-in__count" key={seconds} aria-hidden="true">
        {seconds}
      </p>
      <p className="sr-only">Next question in {seconds} seconds</p>
    </div>
  );
}
