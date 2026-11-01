"use client";

import { useEffect } from "react";
import type { ClientGame } from "@/lib/db/types";
import { autoAdvance } from "@/app/actions/autoAdvance";
import { canAutoAdvance } from "./autoAdvance";

/** Every participant can advance a due review while the host tab sleeps. */
export function useAutoAdvance(code: string, token: string | null, game: ClientGame | null, offset: number): void {
  useEffect(() => {
    if (!token || !game || !game.reviewing || game.paused || !game.auto_advance_at) return;
    let active = true;
    let inFlight = false;
    let nextAt = 0;
    let done = false;
    const jitter = Math.floor(Math.random() * 500);
    const tick = () => {
      const now = Date.now() + offset;
      if (!active || inFlight || done || now < nextAt || !canAutoAdvance(game, now - jitter)) return;
      inFlight = true;
      nextAt = now + 2000;
      void autoAdvance(code, token, game.current_index)
        .then(result => { done = result; })
        .catch(() => {})
        .finally(() => { inFlight = false; });
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => { active = false; clearInterval(timer); };
  }, [code, token, game, offset]);
}
