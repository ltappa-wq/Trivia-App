"use client";
// U6. Host view — the pacing authority (KTD3). Optimized for a larger, possibly
// shared screen: big room code, live roster/leaderboard, and start/advance
// controls. The gamemaster may optionally play too (chosen at setup): when they
// do, this view shows an AnswerPanel; when they host only, it shows the current
// question read-only. State is hydrated from Postgres and reconciled on every
// Broadcast delta (KTD8); the countdown is server-anchored (KTD9).

import { DisplayLink } from "@/components/DisplayLink";
import { JoinQrCode } from "@/components/JoinQrCode";
import { Suspense, useMemo, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { LobbyAccessibility } from "@/components/LobbyAccessibility";
import { SaveHostLink, SessionRecovery } from "@/components/SessionRecovery";
import { useSearchParams } from "next/navigation";
import { useScopedState } from "@/lib/useScopedState";
import { ReviewAutoAdvance } from "@/components/ReviewAutoAdvance";
import { setReviewAutoAdvance } from "@/app/actions/autoAdvance";
import { advance } from "@/app/actions/advance";
import { GenerationProgressButton } from "@/components/GenerationProgressButton";
import { getQuestionReview, editQuestionReview } from "@/app/actions/questionReview";
import { QuestionReviewPanel } from "@/components/QuestionReviewPanel";
import { useQuestionReview } from "@/lib/useQuestionReview";
import { startGame } from "@/app/actions/startGame";
import { closeQuestion } from "@/app/actions/closeQuestion";
import { adjudicate, type Ruling } from "@/app/actions/adjudicate";
import { endGame } from "@/app/actions/endGame";
import { challenge } from "@/app/actions/challenge";
import { consumeHostRecovery, loadHostCredential } from "@/lib/clientSession";
import {
  answerDistribution,
  listCategorySuggestions,
  listOpenChallenges,
  revealAnswer,
} from "@/lib/realtime/channel";
import { aggregateSuggestions, type AggregatedSuggestion } from "@/lib/suggestions";
import {
  useIsGetReady,
  useJoinAnnouncements,
  useQuestionCountdown,
  useRoomState,
} from "@/lib/realtime/hooks";
import { isLastIndex } from "@/lib/gameFlow";
import { answerTimerMs, questionMultiplier } from "@/lib/gameConfig";
import { useAutoAdvance } from "@/lib/realtime/useAutoAdvance";
import { useAutoClose } from "@/lib/realtime/useAutoClose";
import { AnswerProgress } from "@/components/AnswerProgress";
import { derivePhase } from "@/lib/gamePhase";
import { formatNumber } from "@/lib/formatScore";
import { JoinToast } from "@/components/JoinToast";
import { Rematch } from "@/components/Rematch";
import { GameOver } from "@/components/GameOver";
import { GameFeedback, SoundToggle } from "@/components/GameFeedback";
import { RoundRecap, useRoundSnapshot } from "@/components/RoundRecap";
import { RoundLeaderboard } from "@/components/RoundLeaderboard";
import { GameStage } from "@/components/GameStage";
import { SuggestionsPanel } from "@/components/SuggestionsPanel";
import type { ChallengeKind } from "@/lib/challenge";
import type {
  AnswerDistribution as AnswerDistributionData,
  OpenChallenge,
  RevealedAnswer,
} from "@/lib/db/types";

// Assumes Vercel Fluid Compute (including Hobby: maximum 300 seconds).
// Next 16 applies page maxDuration to Server Actions invoked from this page.
export const maxDuration = 300;

const subscribeOrigin = () => () => {};
const readOrigin = () => window.location.origin;

function HostView() {
  const params = useSearchParams();
  const code = (params.get("code") ?? "").toUpperCase();
  const [recovered, setRecovered] = useState(false);
  useEffect(() => {
    consumeHostRecovery(code);
    // Wait for fragment consumption before exposing credentials to the room hook.
    queueMicrotask(() => setRecovered(true));
  }, [code]);
  const cred = useMemo(() => recovered ? loadHostCredential(code) : null, [code, recovered]);
  const token = cred?.token ?? null;

  // Lobby join announcements (U9): fed by the single room channel via onPlayerJoined.
  const { items: joinAnnouncements, announce: announceJoin } = useJoinAnnouncements();
  // Room state is also readable with the playing host’s player token, which
  // restores their own answer. Host-only actions/RPCs still use `token`.
  const { state, offset, error, loading } = useRoomState(code, cred?.playerToken ?? token, announceJoin);
  const [busy, setBusy] = useState(false);
  // Separate from `busy`: starting runs generation, so it is a long, blocking
  // operation the lobby reports on its own rather than a quick pacing action.
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Player-suggested categories the host has accepted (U10, R8). Nothing a
  // player submits reaches generation until it appears in here.
  const [accepted, setAccepted] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<AggregatedSuggestion[]>([]);

  function toggleAccepted(category: string) {
    setAccepted((prev) =>
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category],
    );
  }
  const game = state?.game ?? null;
  const { review: questionReview, prepared: questionsPrepared, requestReview, setReview: setQuestionReview } = useQuestionReview({
    code, token, gameId: game?.id ?? null, lobby: game?.status === "lobby", starting, busy,
  });
  const challengeScope = `${token}:${game?.current_index}:${game?.paused}`;
  const reviewScope = `${token}:${game?.current_index}:${game?.reviewing}`;
  const [challenges, setChallenges] = useScopedState<OpenChallenge[]>(challengeScope, []);
  const [reveal, setReveal] = useScopedState<RevealedAnswer | null>(reviewScope, null);
  const [dist, setDist] = useScopedState<AnswerDistributionData | null>(reviewScope, null);
  const [copied, setCopied] = useState(false);
  const origin = useSyncExternalStore(subscribeOrigin, readOrigin, () => "");
  const joinUrl = origin && game?.code ? `${origin}/join?code=${game.code}` : "";
  const [challengeError, setChallengeError] = useState<string | null>(null);
  const [challenging, setChallenging] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  function copyJoinLink() {
    const link =
      joinUrl || (game?.code ? `${window.location.origin}/join?code=${game.code}` : "");
    if (!link) return;
    // Optimistic UI: flip to "Copied" regardless of clipboard permission, which
    // fails silently in sandboxed/insecure contexts.
    try {
      navigator.clipboard?.writeText(link).catch(() => {});
    } catch {
      /* no clipboard API — still show the optimistic confirmation */
    }
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1600);
  }

  // U10. Load player category suggestions while the room is still in the lobby.
  // Keyed on `state` so it re-reads whenever the room reconciles — a join
  // broadcasts player_joined, which reconciles state, so a suggestion arriving
  // after the host opened the lobby appears without a manual refresh.
  useEffect(() => {
    if (!token || game?.status !== "lobby") return;
    let active = true;
    listCategorySuggestions(token)
      .then((rows) => {
        if (active) setSuggestions(aggregateSuggestions(rows));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [token, game?.status, state]);

  // While paused, load authoritative open challenges (KTD8) and refresh whenever
  // room state reconciles (after a ruling broadcasts leaderboard/resume).
  useEffect(() => {
    if (!token || !game?.paused) return;
    let active = true;
    listOpenChallenges(token)
      .then((c) => {
        if (active) setChallenges(c);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [token, game?.paused, state, setChallenges]);

  // R1/R5. Once the room enters review, fetch the correct answer and the per-
  // option answer distribution for the shared screen (both phase-gated RPCs).
  // Clear them when the question changes or review ends. The distribution RPC may
  // not exist until migration 0008 is applied, so a failure degrades to no bar.
  useEffect(() => {
    if (!token || !game?.reviewing) return;
    let active = true;
    revealAnswer(token)
      .then((r) => {
        if (active) setReveal(r);
      })
      .catch(() => {});
    answerDistribution(token)
      .then((d) => {
        if (active) setDist(d);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [token, game?.reviewing, game?.current_index, setReveal, setDist]);

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
  // Ticking heartbeat so the view re-renders when the 3s get-ready window ends
  // (must run every render, before early returns). derivePhase below is the
  // authority on what that means — this hook only supplies the clock.
  useIsGetReady(game && game.current_index >= 0 ? game.reveal_at : null, offset);

  useAutoAdvance(code, token, game, offset);
  useAutoClose(code, token, game, offset, true);

  async function handleCloseNow() {
    if (!token || !game) return;
    setBusy(true);
    setActionError(null);
    try {
      await closeQuestion(code, token, game.current_index, true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not close question");
    } finally {
      setBusy(false);
    }
  }

  async function handleAutoAdvance(enabled: boolean) {
    if (!token || !game) return;
    setBusy(true);
    setActionError(null);
    try { await setReviewAutoAdvance(code, token, game.current_index, enabled); }
    catch (err) { setActionError(err instanceof Error ? err.message : "Could not update auto-advance"); }
    finally { setBusy(false); }
  }

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

  // U8 / AE8. Start now carries generation, so it is the long operation and it
  // can fail. On failure the room stays in the lobby with its players seated and
  // the host free to retry — nothing is torn down.
  async function handleStart(reviewFirst = false) {
    if (!token) return;
    if (reviewFirst) requestReview();
    setStarting(true);
    setActionError(null);
    try {
      // Only the accepted suggestions travel; startGame merges them with the
      // host's stored categories server-side.
      const result = await startGame(code, token, accepted, reviewFirst);
      if (result.status === "ready") setQuestionReview(await getQuestionReview(code, token));
      if (result.status === "generation_failed") setActionError(result.message);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Could not start the game — please retry.",
      );
    } finally {
      setStarting(false);
    }
  }

  async function handleQuestionEdit(id: string, operation: "remove" | "regenerate") {
    if (!token) return false;
    setBusy(true); setActionError(null);
    try {
      const result = await editQuestionReview(code, token, id, operation);
      if (result.error) setActionError(result.error);
      if (result.review) setQuestionReview(result.review);
      return !result.error;
    } catch { setActionError("Could not edit questions. Please retry."); return false; }
    finally { setBusy(false); }
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

  async function raiseChallenge(type: ChallengeKind) {
    if (!cred?.playerToken) return;
    setChallenging(true);
    setChallengeError(null);
    try {
      await challenge(cred.playerToken, type);
    } catch (err) {
      setChallengeError(err instanceof Error ? err.message : "Could not challenge");
    } finally {
      setChallenging(false);
    }
  }

  const experiencePhase = game ? derivePhase(game, state?.current_question ?? null, offset).phase : "lobby";
  const roundBaseline = useRoundSnapshot(state, experiencePhase);

  if (!recovered) return <main aria-busy="true"><p>Loading…</p></main>;
  if (!cred) {
    return (
      <main>
        <h1>Host session not found</h1>
        <p>Open your saved private host link to recover this room, or use the browser where you hosted it.</p>
        <SessionRecovery />
        <Link href="/">Home</Link> · <Link href={`/join?code=${code}`}>Join this room as a player</Link>
      </main>
    );
  }
  if (loading) return <main aria-busy="true"><p>Loading…</p></main>;
  if (error) return <main><p role="alert">{error}</p></main>;
  if (!game) return <main><p>This saved session is no longer valid. Open a private host recovery link or join the room again.</p><Link href={`/join?code=${code}`}>Join room {code}</Link> · <Link href="/">Home</Link></main>;

  const leaderboard = state?.leaderboard ?? [];
  const question = state?.current_question ?? null;
  const phase = derivePhase(game, question, offset);
  const started = phase.phase !== "lobby";
  const ended = phase.phase === "ended";
  const getReady = phase.phase === "get_ready";
  const onLastQuestion = isLastIndex(game.current_index, game.question_count);

  // Pacing authority stays here — the shared stage renders it, but only the host
  // decides when the room moves on.
  const pacingControls = onLastQuestion ? (
    <button type="button" disabled={busy} onClick={handleFinish}>
      Finish game
    </button>
  ) : (
    <button type="button" disabled={busy} onClick={() => handleAdvance(game.current_index)}>
      Next question
    </button>
  );

  return (
    <main className="host-view">
      <header>
        <h1 tabIndex={-1}>Room {game.code}</h1>
        <p>
          {game.status === "lobby"
            ? "Waiting to start"
            : getReady
              ? `Get ready — Question ${formatNumber(game.current_index + 1)} of ${formatNumber(game.question_count)}`
              : `Question ${formatNumber(game.current_index + 1)} of ${formatNumber(game.question_count)}`}
        </p>
        {phase.phase !== "ended" && <SoundToggle />}
        <DisplayLink key={token} code={code} token={token!} />
      </header>
      {phase.phase === "lobby" && <LobbyAccessibility code={game.code} />}
      <GameFeedback phase={phase.phase} remaining={remaining}
        roundKey={`${game.id}:${game.current_index}`} answer={state?.my_answer ?? null}
        voided={state?.current_question?.voided ?? false} spectating={state?.role === "spectator" || !state?.player} />

      {game.status === "lobby" && <SaveHostLink credential={cred} />}
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
                    <p>Q{formatNumber(q.index + 1)}: {q.prompt}</p>
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
          <div style={{ display: "flex", alignItems: "center", gap: "2rem", flexWrap: "wrap" }}>
          {joinUrl && <JoinQrCode url={joinUrl} />}
          <p>
            Room code: <span className="room-code">{game.code}</span>
          </p>
          </div>
          <div className="copy-link">
            <span className="copy-link__url">{joinUrl || `…/join?code=${game.code}`}</span>
            <button
              type="button"
              className={copied ? "is-copied" : undefined}
              onClick={copyJoinLink}
            >
              {copied ? "✓ Copied" : "Copy link"}
            </button>
          </div>
          <h2>Players</h2>
          {leaderboard.length === 0 ? (
            <p>No players yet — share the code above to invite them.</p>
          ) : (
            <ul>
              {leaderboard.map((p) => (
                <li key={p.id}>{p.username}</li>
              ))}
            </ul>
          )}
          {!questionsPrepared && !questionReview && <SuggestionsPanel
            suggestions={suggestions}
            accepted={accepted}
            onToggle={toggleAccepted}
          />}
          {questionsPrepared && !questionReview && <p>Questions are prepared. Category suggestions can no longer change this set. Choose review to show answers on this screen.</p>}
          {questionReview && <QuestionReviewPanel review={questionReview} busy={busy || starting} onEdit={handleQuestionEdit} />}
          {/* U8: Start now generates the question set, so it is a long operation
              with a real failure mode — reported here, in the lobby, instead of
              on the setup form it used to block. */}
          <GenerationProgressButton
            code={code}
            token={token}
            total={game.question_count}
            starting={starting}
            disabled={busy || leaderboard.length === 0}
            onStart={() => handleStart()}
            onReview={() => handleStart(true)}
            prepared={Boolean(questionReview)}
            reviewDisabled={busy}
          />
        </section>
      )}

      {phase.phase === "question" && (
        <section>
          <AnswerProgress state={state} token={token} isHost />
          <button type="button" disabled={busy} onClick={handleCloseNow}>End question now</button>
        </section>
      )}
      <div className="host-live">
      <GameStage
        timerMs={answerTimerMs(game)}
        doublePoints={questionMultiplier(game) === 2}
        phase={phase}
        question={question}
        currentIndex={game.current_index}
        revealAt={game.reveal_at}
        offset={offset}
        remaining={remaining}
        isHost
        // The host is never a spectator: they hold the room, not a seat taken
        // mid-game. A host who plays answers through their own player token.
        spectating={false}
        myAnswer={state?.my_answer}
        playerToken={cred.playerToken ?? null}
        reveal={reveal}
        distribution={dist}
        challenging={challenging}
        challengeError={challengeError}
        showAnswerDispute={false}
        onChallenge={(t) => void raiseChallenge(t)}
        controls={<>{pacingControls}<ReviewAutoAdvance game={game} offset={offset} busy={busy} onToggle={handleAutoAdvance} /></>}
      />

      {phase.phase === "review" && state && <RoundRecap state={state} baseline={roundBaseline} />}

      {started && !ended && (
        <section>
          <h2>Leaderboard</h2>
          {leaderboard.length === 0 ? (
            <p>No scores yet.</p>
          ) : (
            <RoundLeaderboard standings={leaderboard} baseline={roundBaseline} reviewing={phase.phase === "review"} />
          )}
        </section>
      )}
      </div>

      {ended && (
        <>
          <GameOver
            recapToken={cred?.playerToken ?? token}
            standings={leaderboard}
            myPlayerId={state?.player?.id}
            roomCode={game.code}
          />
          <Rematch code={game.code} rematchCode={state?.game.rematch_code} host />
        </>
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
