"use client";
// Get-ready 3–2–1 interstitial before a question becomes answerable.
// Server-anchored via reveal_at (advance stamps now + GET_READY_MS); the ring
// fills over each second and resets when the digit changes.

import { useEffect, useState } from "react";
import { msUntilReveal } from "@/lib/realtime/clock";

export function GetReady({
  revealAt,
  offset,
}: {
  revealAt: string;
  offset: number;
}) {
  const [until, setUntil] = useState(() =>
    msUntilReveal(new Date(revealAt).getTime(), offset),
  );

  useEffect(() => {
    const revealMs = new Date(revealAt).getTime();
    const tick = () => setUntil(msUntilReveal(revealMs, offset));
    tick();
    const id = setInterval(tick, 50);
    return () => clearInterval(id);
  }, [revealAt, offset]);

  // Digits 3,2,1 while time remains; clamp so we never show 0 as a "ready" digit.
  const secondsLeft = Math.ceil(until / 1000);
  const digit = Math.max(1, Math.min(3, secondsLeft || 1));
  // Progress within the current second (100% at second start → 0% at tick).
  const msInSecond = until % 1000;
  const pctInSecond =
    until <= 0 ? 0 : msInSecond === 0 ? 100 : (msInSecond / 1000) * 100;

  return (
    <div className="get-ready" aria-live="polite" role="timer" aria-label={`${digit}`}>
      <p className="get-ready__label">Get ready</p>
      <div
        className="get-ready__ring"
        style={{ ["--pct" as string]: pctInSecond }}
        key={digit}
      >
        <span className="get-ready__digit">{digit}</span>
      </div>
      <p className="get-ready__hint">Next question in…</p>
    </div>
  );
}
