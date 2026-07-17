"use client";
// Countdown ring: a conic-gradient progress ring that shifts to red and shakes
// in the final seconds. Presentational only — the server-anchored `remaining`
// milliseconds are computed by useQuestionCountdown (KTD9) and passed in. The
// accessible seconds count is preserved via aria-label so screen readers and the
// existing e2e selectors keep working.

const URGENT_SECONDS = 3;

export function Countdown({
  remaining,
  total,
}: {
  remaining: number;
  total: number;
}) {
  const seconds = Math.ceil(remaining / 1000);
  const pct = total > 0 ? Math.max(0, Math.min(100, (remaining / total) * 100)) : 0;
  const urgent = seconds <= URGENT_SECONDS;

  return (
    <div
      className={`countdown-ring${urgent ? " is-urgent" : ""}`}
      style={{ ["--pct" as string]: pct }}
      role="timer"
      aria-label={`${seconds} seconds remaining`}
    >
      <span className="countdown-ring__face">{seconds}s</span>
    </div>
  );
}
