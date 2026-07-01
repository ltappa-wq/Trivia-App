"use client";
// U9. Player results view (R15) — phone-first. Shows final standings with the
// winner(s) highlighted and this player's placement. State hydrates from
// Postgres like every other view (KTD8); scores are the durable source of truth.

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { loadPlayerCredential } from "@/lib/clientSession";
import { useRoomState } from "@/lib/realtime/hooks";
import { sortStandings, winners } from "@/lib/results";

function ResultsView() {
  const params = useSearchParams();
  const code = (params.get("code") ?? "").toUpperCase();
  const cred = loadPlayerCredential(code);
  const token = cred?.token ?? null;

  const { state, error, loading } = useRoomState(code, token);

  if (!cred) return <main><p>Not in this game.</p></main>;
  if (loading) return <main aria-busy="true"><p>Tallying results…</p></main>;
  if (error) return <main><p role="alert">{error}</p></main>;

  const standings = sortStandings(state?.leaderboard ?? []);
  const winnerIds = new Set(winners(standings).map((w) => w.id));
  const myId = state?.player?.id;

  return (
    <main>
      <h1>Final results</h1>
      {winnerIds.size === 0 ? (
        <p>No winner this time — nobody scored.</p>
      ) : (
        <p>
          {winnerIds.size > 1 ? "Co-winners: " : "Winner: "}
          {winners(standings)
            .map((w) => w.username)
            .join(", ")}
          🎉
        </p>
      )}
      <ol>
        {standings.map((p, i) => (
          <li key={p.id}>
            <span>
              {i + 1}. {p.username} — {p.score}
            </span>
            {winnerIds.has(p.id) && <span> ★ winner</span>}
            {p.id === myId && <span> (you)</span>}
          </li>
        ))}
      </ol>
    </main>
  );
}

export default function ResultsPage() {
  return (
    <Suspense>
      <ResultsView />
    </Suspense>
  );
}
