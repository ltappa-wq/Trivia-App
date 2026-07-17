"use client";
// U9. Player results view (R15) — phone-first. Shows final standings with the
// winner(s) highlighted and this player's placement. State hydrates from
// Postgres like every other view (KTD8); scores are the durable source of truth.

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { loadPlayerCredential } from "@/lib/clientSession";
import { useRoomState } from "@/lib/realtime/hooks";
import { describeWinners, sortStandings } from "@/lib/results";

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
  const { winnerIds, label } = describeWinners(standings);
  const myId = state?.player?.id;
  const myRank = myId ? standings.findIndex((p) => p.id === myId) + 1 : 0;
  const iWon = myId ? winnerIds.has(myId) : false;

  return (
    <main>
      <h1>Final results</h1>
      <p>{label ? `${label} 🎉` : "No winner this time — nobody scored."}</p>

      {myRank > 0 && (
        <div className={`placement-card${iWon ? " placement-card--winner" : ""}`}>
          <span className="placement-card__rank">
            {iWon ? "🏆 You won!" : `You placed ${ordinal(myRank)}!`}
          </span>
          <p className="placement-card__sub">
            out of {standings.length} player{standings.length === 1 ? "" : "s"}
          </p>
        </div>
      )}

      <ol className="results-list">
        {standings.map((p, i) => (
          <li
            key={p.id}
            className={`${p.id === myId ? "is-you " : ""}${
              winnerIds.has(p.id) ? "is-winner" : ""
            }`.trim()}
          >
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

// 1st / 2nd / 3rd / 4th … English ordinal for the placement card.
function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export default function ResultsPage() {
  return (
    <Suspense>
      <ResultsView />
    </Suspense>
  );
}
