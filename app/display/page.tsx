"use client";
import { Suspense, useEffect, useState, useSyncExternalStore } from "react";
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
  const token = credential?.token ?? null;
  const { state, offset, loading, error, refresh } = useRoomState(code, token);
  const game = state?.game;
  const phase = game ? derivePhase(game, state.current_question, offset).phase : "lobby";
  const remaining = useQuestionCountdown(game ?? null, offset, state?.current_question);
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
  if (!credential || loading) return <main className="tv-display" aria-busy="true"><h1>Connecting TV display…</h1></main>;
  if (!token || (!state && !error)) return <main className="tv-display"><h1>TV display link required</h1><p>Ask the host to open or regenerate the TV display link.</p></main>;
  if (error) return <main className="tv-display"><h1>Reconnecting…</h1><p>Waiting for the room connection.</p></main>;
  if (!state || state.role !== "display" || state.game.code !== code) return <main className="tv-display"><h1>Invalid TV display link</h1></main>;
  return <DisplayStage state={state} token={token!} origin={origin} offset={offset} remaining={remaining}
    reveal={review?.reveal ?? null} distribution={review?.distribution ?? null} baseline={baseline} />;
}
function DisplayRoute() {
  const params = useSearchParams();
  const code = params.get("code") ?? "";
  return <DisplayRoom key={code} code={code} />;
}
export default function DisplayPage() {
  return <Suspense fallback={<main className="tv-display"><h1>Connecting TV display…</h1></main>}><DisplayRoute /></Suspense>;
}
