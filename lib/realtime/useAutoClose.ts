"use client";

import { startTransition, useEffect, useRef } from "react";
import { closeQuestion } from "@/app/actions/closeQuestion";
import type { ClientGame } from "@/lib/db/types";
import {
  AUTO_CLOSE_MAX_ATTEMPTS,
  AUTO_CLOSE_RETRY_MS,
  canAutoClose,
  autoCloseDelay,
  type AutoCloseGame,
} from "./autoClose";

/** Independent of countdown rendering (whose value stays zero after expiry).
 * Every foreground participant can carry the room if the host tab is asleep. */
export function useAutoClose(
  code: string,
  token: string | null,
  game: ClientGame | null,
  offset: number,
  isHost: boolean,
): void {
  const budget = useRef({ key: "", attempts: 0, nextAt: 0, done: false });
  const { id, current_index, reveal_at, answer_mode, status, paused, reviewing } = game ?? {};
  useEffect(() => {
    if (!token || !id || current_index == null || !answer_mode || !status) return;
    const snapshot: AutoCloseGame = {
      current_index,
      reveal_at: reveal_at ?? null,
      answer_mode,
      status,
      paused: !!paused,
      reviewing: !!reviewing,
    };
    const key = `${token}:${id}:${current_index}:${reveal_at}`;
    if (budget.current.key !== key) {
      budget.current = { key, attempts: 0, nextAt: 0, done: false };
    }
    const delay = autoCloseDelay(isHost, Math.random());
    let active = true;
    let inFlight = false;
    const tick = () => {
      const now = Date.now() + offset;
      const b = budget.current;
      if (
        !active || inFlight || b.done || b.attempts >= AUTO_CLOSE_MAX_ATTEMPTS ||
        now < b.nextAt || !canAutoClose(snapshot, now, delay)
      ) return;
      b.attempts++;
      b.nextAt = now + AUTO_CLOSE_RETRY_MS;
      inFlight = true;
      startTransition(() => {
        void closeQuestion(code, token, current_index)
          .then((result) => {
            if (budget.current === b && result.status === "reviewing") b.done = true;
          })
          .catch(() => {})
          .finally(() => { inFlight = false; });
      });
    };
    tick();
    const timer = setInterval(tick, 100);
    return () => { active = false; clearInterval(timer); };
  }, [code, token, id, current_index, reveal_at, answer_mode, status, paused, reviewing, offset, isHost]);
}
