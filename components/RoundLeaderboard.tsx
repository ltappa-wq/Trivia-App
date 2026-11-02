"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import type { LeaderboardEntry } from "@/lib/db/types";
import { rankedStandings, rankDeltas } from "@/lib/roundRecap";
import { formatScore } from "@/lib/formatScore";

export function RoundLeaderboard({ standings, baseline, reviewing, pageStart = 0, pageSize = standings.length }: {
  standings: LeaderboardEntry[]; baseline: LeaderboardEntry[] | null; reviewing: boolean;
  pageStart?: number; pageSize?: number;
}) {
  const ranked = useMemo(() => rankedStandings(standings), [standings]);
  const deltas = useMemo(() => rankDeltas(ranked, baseline), [ranked, baseline]);
  const list = useRef<HTMLOListElement>(null);
  const positions = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const next = new Map<string, number>();
    for (const row of list.current?.children ?? []) {
      const element = row as HTMLElement;
      const id = element.dataset.player!;
      const top = element.getBoundingClientRect().top;
      next.set(id, top);
      const previous = positions.current.get(id);
      if (previous !== undefined && previous !== top && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        element.animate?.([{ transform: `translateY(${previous - top}px)` }, { transform: "translateY(0)" }], { duration: 450, easing: "ease-out" });
      }
    }
    positions.current = next;
  }, [standings]);
  return <ol ref={list} className="round-leaderboard">
    {ranked.slice(pageStart, pageStart + pageSize).map((p) => {
      const delta = reviewing ? deltas.get(p.id) : null;
      return <li key={p.id} data-player={p.id} value={p.rank}>
        {p.username} — {formatScore(p.score)}
        {delta != null && delta !== 0 && <span className="rank-movement" role="img" aria-label={`${delta > 0 ? "Up" : "Down"} ${Math.abs(delta)} ranks`}> {delta > 0 ? "↑" : "↓"}{Math.abs(delta)}</span>}
      </li>;
    })}
  </ol>;
}
