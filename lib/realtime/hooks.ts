"use client";
// U6. Client hooks for the live loop.
// useRoomState: hydrate on mount + on every Broadcast delta (hydrate-then-delta,
// KTD8) and run the clock-offset handshake once (KTD9). Re-hydrating on each
// event is a little chatty but is self-healing and correct for the ≤10-player
// target — a dropped pause/resume/void reconciles on the next event.
// useCountdown: render remaining time from the server-anchored reveal, corrected
// by the measured offset.

import { useCallback, useEffect, useRef, useState } from "react";
import { serverNow } from "@/app/actions/serverTime";
import { ANSWER_TIMER_MS } from "@/lib/gameConfig";
import type { HydratedState } from "@/lib/db/types";
import { hydrate, subscribeToRoom } from "./channel";
import { measureClockOffset, remainingMs, untilRevealMs } from "./clock";
import { ROOM_EVENTS } from "./events";

export interface RoomState {
  state: HydratedState | null;
  offset: number;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useRoomState(
  code: string,
  token: string | null,
  // Optional side-channel for the player_joined payload (U9), routed through this
  // one room subscription so the lobby toast never opens a second channel on the
  // same topic (which can perturb this load-bearing hydration channel).
  onPlayerJoined?: (payload: Record<string, unknown>) => void,
): RoomState {
  const [state, setState] = useState<HydratedState | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Ref so a changing callback identity doesn't re-subscribe the channel.
  const onPlayerJoinedRef = useRef(onPlayerJoined);
  onPlayerJoinedRef.current = onPlayerJoined;

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
        [ROOM_EVENTS.playerJoined]: (payload) => {
          reconcile();
          onPlayerJoinedRef.current?.(payload);
        },
        [ROOM_EVENTS.question]: reconcile,
        [ROOM_EVENTS.leaderboard]: reconcile,
        [ROOM_EVENTS.review]: reconcile,
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

export interface JoinAnnouncement {
  key: number;
  username: string;
}

/**
 * U9/R2. Transient "X joined" announcements for the host lobby. A pure queue:
 * `announce` (wired to useRoomState's onPlayerJoined so it reuses the single room
 * channel, KTD6) pushes a toast that auto-expires after a short window, so rapid
 * joins stack instead of overwriting one another (R2.3). Rendering is gated to
 * the lobby by the caller.
 */
export function useJoinAnnouncements(): {
  items: JoinAnnouncement[];
  announce: (payload: Record<string, unknown>) => void;
} {
  const [items, setItems] = useState<JoinAnnouncement[]>([]);
  const seq = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const announce = useCallback((payload: Record<string, unknown>) => {
    const username = typeof payload.username === "string" ? payload.username : "A player";
    const key = ++seq.current;
    setItems((prev) => [...prev, { key, username }]);
    timers.current.push(
      setTimeout(() => setItems((prev) => prev.filter((it) => it.key !== key)), 1600),
    );
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending) clearTimeout(t);
    };
  }, []);

  return { items, announce };
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

/**
 * Between-question "get ready" lead-in (U6). Returns the ticking milliseconds
 * until the current question's answer window opens (`reveal_at` in the future),
 * or null when no lead-in is in effect — lobby, review, paused, ended, or once
 * answering is already live. Server-anchored and offset-corrected like the
 * answer countdown, so the 3-2-1 lands together across devices.
 */
export function useLeadInCountdown(
  game: HydratedState["game"] | null,
  offset: number,
): number | null {
  const revealAt = game?.reveal_at ?? null;
  const eligible =
    !!game &&
    game.current_index >= 0 &&
    game.status === "active" &&
    !game.paused &&
    !game.reviewing;
  // Re-render heartbeat only. The value is derived synchronously below so the
  // first render after `reveal_at` moves into the future already reflects the
  // lead-in — no one-frame flash of the question before the "get ready" mounts.
  const [, tick] = useState(0);

  useEffect(() => {
    if (!eligible || !revealAt) return;
    const revealMs = new Date(revealAt).getTime();
    // Already open — nothing to count down; the answer countdown takes over.
    if (untilRevealMs(revealMs, offset) <= 0) return;
    let id: ReturnType<typeof setInterval> | null = setInterval(() => {
      tick((n) => n + 1);
      // Once answering opens, stop ticking.
      if (untilRevealMs(revealMs, offset) <= 0 && id) {
        clearInterval(id);
        id = null;
      }
    }, 100);
    return () => {
      if (id) clearInterval(id);
    };
  }, [eligible, revealAt, offset]);

  if (!eligible || !revealAt) return null;
  return untilRevealMs(new Date(revealAt).getTime(), offset);
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
