"use client";
import { Suspense, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { DisplayStage } from "@/components/DisplayStage";
import { useRoundSnapshot } from "@/components/RoundRecap";
import { clearDisplayToken, consumeDisplayToken } from "@/lib/displaySession";
import { useQuestionCountdown, useRoomState } from "@/lib/realtime/hooks";
import { answerDistribution, revealAnswer } from "@/lib/realtime/channel";
import { derivePhase } from "@/lib/gamePhase";
import { useScopedState } from "@/lib/useScopedState";
import type { AnswerDistribution, RevealedAnswer } from "@/lib/db/types";
import "./display.css";

function DisplayMessage({ title, children, busy }: { title: string; children?: ReactNode; busy?: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [title]);
  return <main className="tv-display" aria-busy={busy || undefined}>
    <h1 ref={heading} tabIndex={-1}>{title}</h1>{children}
  </main>;
}

const subscribeOrigin = () => () => {};
const readOrigin = () => window.location.origin;
function DisplayRoom({ code }: { code: string }) {
  const [credential, setCredential] = useState<{ token: string | null } | null>(null);
  useEffect(() => {
    const consume = () => {
      const token = consumeDisplayToken(code);
      queueMicrotask(() => setCredential({ token }));
    };
    consume();
    window.addEventListener("hashchange", consume);
    return () => window.removeEventListener("hashchange", consume);
  }, [code]);
  if (!credential) return <DisplayMessage title="Connecting TV display…" busy />;
  if (!credential.token) return <DisplayMessage title="TV display link required"><p>Ask the host to open or regenerate the TV display link.</p></DisplayMessage>;
  // Hydration/revocation state belongs to one credential. A regenerated link
  // must not inherit a previous token's null state or clear the new credential.
  return <DisplaySession key={credential.token} code={code} token={credential.token} />;
}
function DisplaySession({ code, token }: { code: string; token: string }) {
  const { state, offset, loading, error, refresh } = useRoomState(code, token);
  const game = state?.game;
  const phase = game ? derivePhase(game, state.current_question, offset).phase : "lobby";
  const remaining = useQuestionCountdown(game ?? null, offset);
  const baseline = useRoundSnapshot(state, phase);
  const origin = useSyncExternalStore(subscribeOrigin, readOrigin, () => "");
  const scope = `${token}:${game?.current_index}:${game?.reviewing}:${game?.paused}`;
  const [review, setReview] = useScopedState<{ reveal: RevealedAnswer | null; distribution: AnswerDistribution | null } | null>(scope, null);
  useEffect(() => {
    if (!token || phase !== "review") return;
    let active = true;
    Promise.all([revealAnswer(token), answerDistribution(token)]).then(([reveal, distribution]) => {
      if (active) setReview({ reveal, distribution });
    }).catch(() => {});
    return () => { active = false; };
  }, [token, phase, state, setReview]);
  // Read-only reconciliation also detects a revoked link if its broadcast was lost.
  useEffect(() => {
    if (!token) return;
    const timer = setInterval(() => void refresh(), 15000);
    return () => clearInterval(timer);
  }, [token, refresh]);
  useEffect(() => {
    if (token && !loading && !error && !state) clearDisplayToken(code);
  }, [token, loading, error, state, code]);
  if (loading) return <DisplayMessage title="Connecting TV display…" busy />;
  if (!state && !error) return <DisplayMessage title="TV display link required"><p>Ask the host to open or regenerate the TV display link.</p></DisplayMessage>;
  if (error) return <DisplayMessage title="Reconnecting…"><p>Waiting for the room connection.</p></DisplayMessage>;
  if (!state || state.role !== "display" || state.game.code !== code) return <DisplayMessage title="Invalid TV display link" />;
  return <DisplayStage state={state} token={token!} origin={origin} offset={offset} remaining={remaining}
    reveal={review?.reveal ?? null} distribution={review?.distribution ?? null} baseline={baseline} />;
}
function DisplayRoute() {
  const params = useSearchParams();
  const code = params.get("code") ?? "";
  return <DisplayRoom key={code} code={code} />;
}
export default function DisplayPage() {
  return <Suspense fallback={<DisplayMessage title="Connecting TV display…" busy />}><DisplayRoute /></Suspense>;
}
