"use client";
// U8 / R1. A small, brief celebratory burst shown on a player's own device when
// their answer is judged correct. Purely presentational and non-blocking: it is
// absolutely positioned, aria-hidden, and unmounts itself after the animation so
// it never lingers in the DOM or intercepts taps (R1.2). Rendered inside
// AnswerPanel's correct-result branch, so both the player and host-plays views
// get it with no extra wiring (KTD5).

import { useEffect, useState } from "react";

const PARTICLES = 12;
const DURATION_MS = 1100;

export function Fireworks() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const id = setTimeout(() => setVisible(false), DURATION_MS);
    return () => clearTimeout(id);
  }, []);

  if (!visible) return null;

  return (
    <span className="fireworks" aria-hidden="true">
      {Array.from({ length: PARTICLES }).map((_, i) => (
        <span
          key={i}
          className="fireworks__particle"
          // Even spread around the burst origin; each particle flies outward.
          style={{ ["--angle" as string]: `${(360 / PARTICLES) * i}deg` }}
        />
      ))}
    </span>
  );
}
