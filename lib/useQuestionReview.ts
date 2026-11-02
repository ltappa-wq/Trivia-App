"use client";

import { useEffect, useSyncExternalStore } from "react";
import { getPreparedQuestionStatus, getQuestionReview } from "@/app/actions/questionReview";
import type { QuestionReview } from "./questionReview";
import { useScopedState } from "./useScopedState";

const consentEvent = "trivia:question-review-consent";
function subscribe(notify: () => void) {
  window.addEventListener(consentEvent, notify);
  return () => window.removeEventListener(consentEvent, notify);
}

/** Consent belongs to this host's browser session, not every screen in the room.
 * Persist it for reloads, but never infer it from the existence of questions. */
export function useQuestionReview({ code, token, gameId, lobby, starting, busy }: {
  code: string; token: string | null; gameId: string | null; lobby: boolean; starting: boolean; busy: boolean;
}) {
  const scope = `${gameId}:${token}`;
  const key = gameId ? `trivia:question-review:${gameId}` : null;
  const savedConsent = useSyncExternalStore(subscribe, () => {
    try { return key ? sessionStorage.getItem(key) === "1" : false; } catch { return false; }
  }, () => false);
  // Retain opt-in in memory if browser storage is unavailable.
  const [localConsent, setLocalConsent] = useScopedState(scope, false);
  const requested = savedConsent || localConsent;
  const [prepared, setPrepared] = useScopedState(scope, false);
  const [review, setReview] = useScopedState<QuestionReview | null>(scope, null);
  function requestReview() {
    setLocalConsent(true);
    try { if (key) sessionStorage.setItem(key, "1"); } catch { /* Memory consent still works. */ }
    window.dispatchEvent(new Event(consentEvent));
  }
  useEffect(() => {
    if (!token || !lobby) return;
    let active = true;
    async function refresh() {
      try {
        const exists = await getPreparedQuestionStatus(code, token!);
        if (!active) return;
        setPrepared(exists);
        if (!requested || !exists) { setReview(null); return; }
        const next = await getQuestionReview(code, token!);
        if (active) setReview(next.questions.length ? next : null);
      } catch { /* A concurrent Start can end lobby access; room state reconciles it. */ }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => { active = false; clearInterval(timer); };
  }, [code, token, lobby, starting, busy, requested, setPrepared, setReview]);
  return { review: requested ? review : null, prepared, requestReview, setReview };
}
