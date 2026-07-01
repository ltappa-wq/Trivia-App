"use client";
// U6. Player view — phone-first (UI conventions). Shows the lobby wait, the
// active question with a server-anchored countdown (KTD9), and the between-
// question leaderboard. State hydrates from Postgres and reconciles on every
// Broadcast delta (KTD8). Answer submission is wired in U7 and the challenge
// affordance in U8; this unit establishes the question/timer/leaderboard shell.

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { submitAnswer, type SubmitResult } from "@/app/actions/submitAnswer";
import { challenge } from "@/app/actions/challenge";
import { loadPlayerCredential } from "@/lib/clientSession";
import { useQuestionCountdown, useRoomState } from "@/lib/realtime/hooks";
import type { ChallengeKind } from "@/lib/challenge";

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

  // Answer lifecycle, reset per question by keying on the current index.
  const [answeredIndex, setAnsweredIndex] = useState<number | null>(null);
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const game = state?.game ?? null;
  const remaining = useQuestionCountdown(game, offset);

  const [challengeError, setChallengeError] = useState<string | null>(null);
  const [challenging, setChallenging] = useState(false);

  const currentIndex = game?.current_index ?? -1;
  const locked = answeredIndex === currentIndex;
  const timeUp = remaining !== null && remaining <= 0;
  const paused = game?.paused ?? false;
  // Mid-game joiners are seated as spectators until the next question (U5) and
  // can't score the in-progress one — the server returns { spectating: true }.
  const spectating = state?.role === "spectator";
  const markedWrong = locked && result !== null && !result.correct && !result.spectating;

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

  async function submit(answer: string) {
    if (!token || locked) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await submitAnswer(token, answer);
      setResult(res);
      setAnsweredIndex(currentIndex);
      setTyped("");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not submit");
    } finally {
      setSubmitting(false);
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
          {remaining !== null && (
            <p aria-label={`${Math.ceil(remaining / 1000)} seconds remaining`}>
              {Math.ceil(remaining / 1000)}s
            </p>
          )}
          {submitError && <p role="alert">{submitError}</p>}

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
          ) : locked ? (
            <p className={`result ${result?.correct ? "correct" : "wrong"}`} aria-live="assertive">
              {result?.correct ? "✓ Correct" : "✗ Answer locked in"}
              {result && result.points > 0 ? ` — +${result.points}` : ""}
            </p>
          ) : timeUp ? (
            <p>Time’s up — waiting for the next question.</p>
          ) : question.mode === "multiple_choice" ? (
            <ul>
              {(question.options ?? []).map((opt, i) => (
                <li key={i}>
                  <button type="button" disabled={submitting} onClick={() => submit(String(i))}>
                    {opt}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (typed.trim()) void submit(typed.trim());
              }}
            >
              <label>
                Your answer
                <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
              </label>
              <button type="submit" disabled={submitting || !typed.trim()}>
                Submit
              </button>
            </form>
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
