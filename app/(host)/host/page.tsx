"use client";
// U6. Host view — the pacing authority (KTD3). Host-only for v1 (resolved Open
// Question: the gamemaster hosts, does not also play), so this view is optimized
// for a larger, possibly shared screen: big room code, live roster/leaderboard,
// and start/advance controls. State is hydrated from Postgres and reconciled on
// every Broadcast delta (KTD8); the countdown is server-anchored (KTD9).

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { advance } from "@/app/actions/advance";
import { loadHostCredential } from "@/lib/clientSession";
import { useCountdown, useRoomState } from "@/lib/realtime/hooks";
import { ANSWER_TIMER_MS } from "@/lib/gameConfig";

function HostView() {
  const params = useSearchParams();
  const code = (params.get("code") ?? "").toUpperCase();
  const cred = loadHostCredential(code);
  const token = cred?.token ?? null;

  const { state, offset, error, loading } = useRoomState(code, token);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const game = state?.game ?? null;
  const timerMs = game ? ANSWER_TIMER_MS[game.answer_mode] : null;
  const remaining = useCountdown(
    game?.reveal_at ?? null,
    game && game.current_index >= 0 ? timerMs : null,
    offset,
    game?.paused ?? false,
  );

  async function handleAdvance(expectedIndex: number) {
    if (!token) return;
    setBusy(true);
    setActionError(null);
    try {
      await advance(code, token, expectedIndex);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  if (!cred) {
    return (
      <main>
        <h1>Host session not found</h1>
        <p>Re-create the game from the setup screen to get a host link.</p>
      </main>
    );
  }
  if (loading) return <main aria-busy="true"><p>Loading…</p></main>;
  if (error) return <main><p role="alert">{error}</p></main>;
  if (!game) return <main><p>Game not found.</p></main>;

  const leaderboard = state?.leaderboard ?? [];
  const started = game.current_index >= 0;

  return (
    <main>
      <header>
        <h1>Room {game.code}</h1>
        <p>{game.status === "lobby" ? "Waiting to start" : `Question ${game.current_index + 1} of ${game.question_count}`}</p>
      </header>

      {actionError && <p role="alert">{actionError}</p>}

      {!started && (
        <section>
          <h2>Players</h2>
          {leaderboard.length === 0 ? (
            <p>No players yet — share code {game.code} to invite them.</p>
          ) : (
            <ul>
              {leaderboard.map((p) => (
                <li key={p.id}>{p.username}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            disabled={busy || leaderboard.length === 0}
            onClick={() => handleAdvance(-1)}
          >
            Start game
          </button>
        </section>
      )}

      {started && state?.current_question && (
        <section aria-live="polite">
          <h2>{state.current_question.prompt}</h2>
          {remaining !== null && (
            <p aria-label={`${Math.ceil(remaining / 1000)} seconds remaining`}>
              {Math.ceil(remaining / 1000)}s
            </p>
          )}
          {state.current_question.mode === "multiple_choice" && (
            <ol>
              {(state.current_question.options ?? []).map((opt, i) => (
                <li key={i}>{opt}</li>
              ))}
            </ol>
          )}
          <button type="button" disabled={busy} onClick={() => handleAdvance(game.current_index)}>
            Next question
          </button>
        </section>
      )}

      {started && (
        <section>
          <h2>Leaderboard</h2>
          {leaderboard.length === 0 ? (
            <p>No scores yet.</p>
          ) : (
            <ol>
              {leaderboard.map((p) => (
                <li key={p.id}>
                  {p.username} — {p.score}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </main>
  );
}

export default function HostPage() {
  return (
    <Suspense>
      <HostView />
    </Suspense>
  );
}
