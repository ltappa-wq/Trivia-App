"use client";
// U6. Host view — the pacing authority (KTD3). Optimized for a larger, possibly
// shared screen: big room code, live roster/leaderboard, and start/advance
// controls. The gamemaster may optionally play too (chosen at setup): when they
// do, this view shows an AnswerPanel; when they host only, it shows the current
// question read-only. State is hydrated from Postgres and reconciled on every
// Broadcast delta (KTD8); the countdown is server-anchored (KTD9).

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { advance } from "@/app/actions/advance";
import { closeQuestion } from "@/app/actions/closeQuestion";
import { adjudicate, type Ruling } from "@/app/actions/adjudicate";
import { endGame } from "@/app/actions/endGame";
import { loadHostCredential } from "@/lib/clientSession";
import { listOpenChallenges, revealAnswer } from "@/lib/realtime/channel";
import { useJoinAnnouncements, useQuestionCountdown, useRoomState } from "@/lib/realtime/hooks";
import { isLastIndex, shouldAutoClose } from "@/lib/gameFlow";
import { describeWinners, sortStandings } from "@/lib/results";
import { AnswerPanel } from "@/components/AnswerPanel";
import { JoinToast } from "@/components/JoinToast";
import { Podium } from "@/components/Podium";
import { AnswerReveal } from "@/components/AnswerReveal";
import type { OpenChallenge, RevealedAnswer } from "@/lib/db/types";

function HostView() {
  const params = useSearchParams();
  const code = (params.get("code") ?? "").toUpperCase();
  const cred = loadHostCredential(code);
  const token = cred?.token ?? null;

  // Lobby join announcements (U9): fed by the single room channel via onPlayerJoined.
  const { items: joinAnnouncements, announce: announceJoin } = useJoinAnnouncements();
  const { state, offset, error, loading } = useRoomState(code, token, announceJoin);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [challenges, setChallenges] = useState<OpenChallenge[]>([]);
  const [reveal, setReveal] = useState<RevealedAnswer | null>(null);

  const game = state?.game ?? null;

  // While paused, load authoritative open challenges (KTD8) and refresh whenever
  // room state reconciles (after a ruling broadcasts leaderboard/resume).
  useEffect(() => {
    if (!token || !game?.paused) {
      setChallenges([]);
      return;
    }
    let active = true;
    listOpenChallenges(token)
      .then((c) => {
        if (active) setChallenges(c);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [token, game?.paused, state]);

  // R1. Fetch the correct answer for the shared screen once the room enters
  // review (gated RPC); clear it when the question changes or review ends.
  useEffect(() => {
    if (!token || !game?.reviewing) {
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
  }, [token, game?.reviewing, game?.current_index]);

  async function rule(challengeId: string, ruling: Ruling) {
    if (!token) return;
    setBusy(true);
    setActionError(null);
    try {
      await adjudicate(code, token, challengeId, ruling);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Adjudication failed");
    } finally {
      setBusy(false);
    }
  }
  const remaining = useQuestionCountdown(game, offset);

  // R5.1 timer path: when the answer window elapses without everyone answering,
  // the host (the pacing authority) closes the question into review. Fired once
  // per question via a ref keyed on current_index; the server CAS makes a race
  // with the all-answered path in submitAnswer a safe no-op.
  const closedForIndex = useRef<number | null>(null);
  useEffect(() => {
    if (!token || !game || game.status === "ended" || game.paused || game.reviewing) return;
    // Decide from reveal_at directly (shouldAutoClose), not the async `remaining`
    // value: on the commit right after advance, `remaining` can still hold the
    // previous question's stale 0 and would otherwise close the fresh question
    // the instant it appears (R4). `remaining` stays in the deps purely as a
    // ~250ms heartbeat so genuine timer expiry re-evaluates.
    if (!shouldAutoClose(game, offset)) return;
    if (closedForIndex.current === game.current_index) return;
    closedForIndex.current = game.current_index;
    // Reset on failure so the next countdown tick retries rather than leaving the
    // question stuck out of review.
    void closeQuestion(code, token, game.current_index).catch(() => {
      closedForIndex.current = null;
    });
  }, [remaining, offset, token, code, game]);

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

  async function handleFinish() {
    if (!token) return;
    setBusy(true);
    setActionError(null);
    try {
      await endGame(code, token);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not end game");
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
  const ended = game.status === "ended";
  const reviewing = game.reviewing;
  const onLastQuestion = isLastIndex(game.current_index, game.question_count);

  return (
    <main className="host-view">
      <header>
        <h1>Room {game.code}</h1>
        <p>{game.status === "lobby" ? "Waiting to start" : `Question ${game.current_index + 1} of ${game.question_count}`}</p>
      </header>

      {actionError && <p role="alert">{actionError}</p>}

      {game.paused && (
        <section aria-live="assertive">
          <h2>Paused — challenge{challenges.length === 1 ? "" : "s"} to review</h2>
          {challenges.length === 0 ? (
            <p>Loading challenge…</p>
          ) : (
            <ol className="adjudication">
              {challenges.map((c) => {
                const q = c.question;
                const answerKey =
                  q.mode === "multiple_choice"
                    ? q.options?.[q.correct_option ?? -1] ?? "—"
                    : (q.accepted_variants ?? []).join(", ");
                return (
                  <li key={c.id}>
                    <p>
                      <strong>{c.challenger}</strong> disputes{" "}
                      {c.type === "answer" ? "their marked-wrong answer" : "this question"}.
                    </p>
                    <p>Q{q.index + 1}: {q.prompt}</p>
                    <p>Accepted answer: {answerKey}</p>
                    {c.type === "answer" && <p>Their answer: {c.submitted_text}</p>}
                    <button
                      type="button"
                      className="uphold"
                      disabled={busy}
                      onClick={() => rule(c.id, "uphold")}
                    >
                      Uphold
                    </button>
                    <button
                      type="button"
                      className="reject"
                      disabled={busy}
                      onClick={() => rule(c.id, "reject")}
                    >
                      Reject
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      )}

      {!started && (
        <section>
          <JoinToast items={joinAnnouncements} />
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

      <div className="host-live">
      {started && !ended && !game.paused && !reviewing && state?.current_question && (
        <section aria-live="polite">
          <h2>{state.current_question.prompt}</h2>
          {remaining !== null && (
            <p aria-label={`${Math.ceil(remaining / 1000)} seconds remaining`}>
              {Math.ceil(remaining / 1000)}s
            </p>
          )}
          {cred.playerToken ? (
            <AnswerPanel
              token={cred.playerToken}
              question={state.current_question}
              currentIndex={game.current_index}
              timeUp={remaining !== null && remaining <= 0}
            />
          ) : (
            // Host-only gamemaster: show the question read-only on the shared
            // screen. Multiple-choice options are listed; type-answer shows just
            // the prompt/timer above.
            state.current_question.mode === "multiple_choice" && (
              <ol>
                {(state.current_question.options ?? []).map((opt, i) => (
                  <li key={i}>{opt}</li>
                ))}
              </ol>
            )
          )}
          {onLastQuestion ? (
            <button type="button" disabled={busy} onClick={handleFinish}>
              Finish game
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => handleAdvance(game.current_index)}>
              Next question
            </button>
          )}
        </section>
      )}

      {started && !ended && reviewing && !game.paused && (
        <section aria-live="polite" className="review">
          <h2>Time&apos;s up — Question {game.current_index + 1} review</h2>
          <p>Answers are locked. Here&apos;s where things stand.</p>
          <AnswerReveal reveal={reveal} />
          {onLastQuestion ? (
            <button type="button" disabled={busy} onClick={handleFinish}>
              Finish game
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => handleAdvance(game.current_index)}>
              Next question
            </button>
          )}
        </section>
      )}

      {started && !ended && (
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
      </div>

      {ended && (
        <section aria-live="polite">
          <h2>Final results</h2>
          {(() => {
            const standings = sortStandings(leaderboard);
            const { winnerIds, label } = describeWinners(standings);
            return (
              <>
                <Podium standings={standings} />
                <p>{label ? `${label} 🎉` : "No winner — nobody scored."}</p>
                <ol>
                  {standings.map((p) => (
                    <li key={p.id}>
                      {p.username} — {p.score}
                      {winnerIds.has(p.id) && " ★"}
                    </li>
                  ))}
                </ol>
              </>
            );
          })()}
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
