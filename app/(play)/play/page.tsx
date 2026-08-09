"use client";
// U6 / U7. Player view — phone-first (UI conventions). This page owns the
// player's shell: identity header, the lobby waiting state, the leaderboard and
// the end screen. Everything between get-ready and review is rendered by the
// shared GameStage, from the phase derived in lib/gamePhase — the same module
// and the same components the host uses, so the two can no longer drift (R5).
//
// The game-ended path renders GameOver in place rather than pushing to
// /results (R6): the redirect was the only way a player reached the final
// screen, so it depended on this view being mounted and reconciling in time,
// and it re-mounted and re-hydrated the whole app to show standings this page
// already holds. /results remains for direct links and refreshes.

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { challenge } from "@/app/actions/challenge";
import type { SubmitResult } from "@/app/actions/submitAnswer";
import { loadPlayerCredential } from "@/lib/clientSession";
import { revealAnswer } from "@/lib/realtime/channel";
import { useIsGetReady, useQuestionCountdown, useRoomState } from "@/lib/realtime/hooks";
import { derivePhase } from "@/lib/gamePhase";
import { formatScore } from "@/lib/formatScore";
import { GameOver } from "@/components/GameOver";
import { GameStage } from "@/components/GameStage";
import type { ChallengeKind } from "@/lib/challenge";
import type { RevealedAnswer } from "@/lib/db/types";

function PlayView() {
  const params = useSearchParams();
  const code = (params.get("code") ?? "").toUpperCase();
  const cred = loadPlayerCredential(code);
  const token = cred?.token ?? null;

  const { state, offset, error, loading } = useRoomState(code, token);

  const [result, setResult] = useState<SubmitResult | null>(null);
  const [challengeError, setChallengeError] = useState<string | null>(null);
  const [challenging, setChallenging] = useState(false);
  const [reveal, setReveal] = useState<RevealedAnswer | null>(null);

  const game = state?.game ?? null;
  const remaining = useQuestionCountdown(game, offset);

  const reviewing = game?.reviewing ?? false;
  const spectating = state?.role === "spectator";
  const currentIndex = game?.current_index ?? -1;
  // Ticking heartbeat: re-renders this view when the 3s get-ready window ends so
  // derivePhase below is re-evaluated and the question appears. The hook is the
  // clock; derivePhase remains the authority on which phase that means.
  useIsGetReady(game && currentIndex >= 0 ? game.reveal_at : null, offset);

  // The player was marked wrong on their answer -> offer the "wrongly marked"
  // challenge variant. A spectator's non-scoring result doesn't count.
  const markedWrong = result !== null && !result.correct && !result.spectating;

  // R1. Once the room enters review, fetch the correct answer (gated RPC) to show
  // it; clear it when the question changes or review ends so it never bleeds into
  // the next question. R5: reset the persisted submit result on a new question so
  // `markedWrong` reflects this question, not a stale prior answer.
  useEffect(() => {
    if (!token || !reviewing) {
      setReveal(null);
      return;
    }
    let active = true;
    revealAnswer(token)
      .then((r) => {
        if (active) setReveal(r);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [token, reviewing, currentIndex]);

  useEffect(() => {
    setResult(null);
  }, [currentIndex]);

  async function raiseChallenge(type: ChallengeKind) {
    if (!token) return;
    setChallenging(true);
    setChallengeError(null);
    try {
      await challenge(token, type);
    } catch (err) {
      setChallengeError(err instanceof Error ? err.message : "Could not challenge");
    } finally {
      setChallenging(false);
    }
  }

  if (!cred) {
    return (
      <main>
        <h1>Not in this game</h1>
        <p>Join from the code screen to play.</p>
      </main>
    );
  }
  if (loading) return <main aria-busy="true"><p>Loading…</p></main>;
  if (error) return <main><p role="alert">{error}</p></main>;
  if (!game) return <main><p>Game not found.</p></main>;

  const question = state?.current_question ?? null;
  const phase = derivePhase(game, question, offset);
  const started = phase.phase !== "lobby";
  const leaderboard = state?.leaderboard ?? [];

  return (
    <main>
      <header>
        <h1>{cred.username}</h1>
        <p>Room {game.code}</p>
      </header>

      {phase.phase === "lobby" && (
        <div className="waiting" aria-live="polite">
          <span className="waiting__emoji" aria-hidden="true">
            🎮
          </span>
          <p>
            Waiting for the host to start
            <span className="waiting__dots" aria-hidden="true">
              <span className="waiting__dot" />
              <span className="waiting__dot" />
              <span className="waiting__dot" />
            </span>
          </p>
        </div>
      )}

      <GameStage
        phase={phase}
        question={question}
        currentIndex={game.current_index}
        revealAt={game.reveal_at}
        offset={offset}
        remaining={remaining}
        isHost={false}
        spectating={spectating}
        playerToken={cred.token}
        reveal={reveal}
        distribution={null}
        challenging={challenging}
        challengeError={challengeError}
        showAnswerDispute={markedWrong}
        onChallenge={(t) => void raiseChallenge(t)}
        onResult={setResult}
      />

      {started && phase.phase !== "ended" && (
        <section>
          <h2>Leaderboard</h2>
          <ol>
            {leaderboard.map((p) => (
              <li key={p.id}>
                {p.username} — {formatScore(p.score)}
              </li>
            ))}
          </ol>
        </section>
      )}

      {phase.phase === "ended" && (
        <GameOver
          standings={leaderboard}
          myPlayerId={state?.player?.id}
          roomCode={game.code}
        />
      )}
    </main>
  );
}

export default function PlayPage() {
  return (
    <Suspense>
      <PlayView />
    </Suspense>
  );
}
