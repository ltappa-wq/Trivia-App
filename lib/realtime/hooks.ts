"use client";
// U6. Client hooks for the live loop.
// useRoomState: hydrate on mount + on every Broadcast delta (hydrate-then-delta,
// KTD8) and run the clock-offset handshake once (KTD9). Re-hydrating on each
// event is a little chatty but is self-healing and correct for the ≤10-player
// target — a dropped pause/resume/void reconciles on the next event.
// useCountdown: render remaining time from the server-anchored reveal, corrected
// by the measured offset.

import { useCallback, useEffect, useState } from "react";
import { serverNow } from "@/app/actions/serverTime";
import { ANSWER_TIMER_MS } from "@/lib/gameConfig";
import type { HydratedState } from "@/lib/db/types";
import { hydrate, subscribeToRoom } from "./channel";
import { measureClockOffset, remainingMs } from "./clock";
import { ROOM_EVENTS } from "./events";

export interface RoomState {
  state: HydratedState | null;
  offset: number;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useRoomState(code: string, token: string | null): RoomState {
  const [state, setState] = useState<HydratedState | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      setState(await hydrate(token));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load game state");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    let active = true;
    measureClockOffset(() => serverNow())
      .then((o) => {
        if (active) setOffset(o);
      })
      .catch(() => {});
    void refresh();

    const reconcile = () => {
      if (active) void refresh();
    };
    const unsubscribe = subscribeToRoom(
      code,
      {
        [ROOM_EVENTS.playerJoined]: reconcile,
        [ROOM_EVENTS.question]: reconcile,
        [ROOM_EVENTS.leaderboard]: reconcile,
        [ROOM_EVENTS.pause]: reconcile,
        [ROOM_EVENTS.resume]: reconcile,
        [ROOM_EVENTS.void]: reconcile,
        [ROOM_EVENTS.results]: reconcile,
      },
      // Re-hydrate on every (re)subscribe so a reconnect recovers missed deltas.
      reconcile,
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [code, token, refresh]);

  return { state, offset, error, loading, refresh };
}

/**
 * Countdown for the current question, shared by the host and play views. Derives
 * the per-mode timer from the game and only ticks once a question is live
 * (current_index >= 0), server-anchored and offset-corrected (KTD9).
 */
export function useQuestionCountdown(
  game: HydratedState["game"] | null,
  offset: number,
): number | null {
  const active = !!game && game.current_index >= 0;
  const timerMs = game && active ? ANSWER_TIMER_MS[game.answer_mode] : null;
  return useCountdown(game?.reveal_at ?? null, timerMs, offset, game?.paused ?? false);
}

/** Ticking remaining-milliseconds for the current question, or null when no
 * timer is active (lobby, between questions, paused). */
export function useCountdown(
  revealAt: string | null,
  timerMs: number | null,
  offset: number,
  paused: boolean,
): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!revealAt || timerMs === null) {
      setRemaining(null); // lobby / between questions
      return;
    }
    if (paused) {
      // Freeze the last displayed value: stop ticking without resetting.
      return;
    }
    const revealMs = new Date(revealAt).getTime();
    const tick = () => setRemaining(remainingMs(revealMs, timerMs, offset));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [revealAt, timerMs, offset, paused]);

  return remaining;
}
