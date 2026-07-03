"use client";
// U6. Player view — phone-first (UI conventions). Shows the lobby wait, the
// active question with a server-anchored countdown (KTD9), and the between-
// question leaderboard. Answering is delegated to the shared AnswerPanel; the
// challenge affordance (U8) reacts to that panel's result. State hydrates from
// Postgres and reconciles on every Broadcast delta (KTD8).

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { challenge } from "@/app/actions/challenge";
import type { SubmitResult } from "@/app/actions/submitAnswer";
import { loadPlayerCredential } from "@/lib/clientSession";
import { revealAnswer } from "@/lib/realtime/channel";
import { useQuestionCountdown, useRoomState } from "@/lib/realtime/hooks";
import { AnswerPanel } from "@/components/AnswerPanel";
import { AnswerReveal } from "@/components/AnswerReveal";
import type { ChallengeKind } from "@/lib/challenge";
import type { RevealedAnswer } from "@/lib/db/types";

function PlayView() {
  const router = useRouter();
  const params = useSearchParams();
  const code = (params.get("code") ?? "").toUpperCase();
  const cred = loadPlayerCredential(code);
  const token = cred?.token ?? null;

  const { state, offset, error, loading } = useRoomState(code, token);

  // When the host ends the game, send players to the results view.
  const ended = state?.game?.status === "ended";
  useEffect(() => {
    if (ended) router.push(`/results?code=${code}`);
  }, [ended, code, router]);

  const [result, setResult] = useState<SubmitResult | null>(null);
  const [challengeError, setChallengeError] = useState<string | null>(null);
  const [challenging, setChallenging] = useState(false);
  const [reveal, setReveal] = useState<RevealedAnswer | null>(null);

  const game = state?.game ?? null;
  const remaining = useQuestionCountdown(game, offset);

  const paused = game?.paused ?? false;
  const reviewing = game?.reviewing ?? false;
  const spectating = state?.role === "spectator";
  const timeUp = remaining !== null && remaining <= 0;
  const currentIndex = game?.current_index ?? -1;
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
  const started = game.current_index >= 0;

  return (
    <main>
      <header>
        <h1>{cred.username}</h1>
        <p>Room {game.code}</p>
      </header>

      {!started && <p>Waiting for the host to start…</p>}

      {started && question && (
        <section aria-live="polite">
          <h2>{question.prompt}</h2>
          {!reviewing && remaining !== null && (
            <p aria-label={`${Math.ceil(remaining / 1000)} seconds remaining`}>
              {Math.ceil(remaining / 1000)}s
            </p>
          )}

          {question.voided ? (
            <p className="overlay" aria-live="assertive">
              This question was voided — waiting for the host.
            </p>
          ) : spectating ? (
            <p className="overlay" aria-live="polite">
              You joined mid-game — sitting out this question. You’ll play from the next one.
            </p>
          ) : paused ? (
            <p className="overlay" aria-live="assertive">
              ⏸ Paused for review — answering is disabled.
            </p>
          ) : reviewing ? (
            <>
              <p className="overlay" aria-live="polite">
                ⏱ Answers locked — here’s the correct answer.
              </p>
              <AnswerReveal reveal={reveal} />
            </>
          ) : (
            <AnswerPanel
              token={cred.token}
              question={question}
              currentIndex={game.current_index}
              timeUp={timeUp}
              onResult={setResult}
            />
          )}

          {!paused && !question.voided && !spectating && (
            <div>
              {challengeError && <p role="alert">{challengeError}</p>}
              <button
                type="button"
                className="ghost"
                disabled={challenging}
                onClick={() => raiseChallenge("question")}
              >
                Challenge this question
              </button>
              {markedWrong && (
                <button
                  type="button"
                  className="ghost"
                  disabled={challenging}
                  onClick={() => raiseChallenge("answer")}
                >
                  My answer was wrongly marked
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {started && (
        <section>
          <h2>Leaderboard</h2>
          <ol>
            {(state?.leaderboard ?? []).map((p) => (
              <li key={p.id}>
                {p.username} — {p.score}
              </li>
            ))}
          </ol>
        </section>
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
