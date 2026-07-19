"use client";
// Shared answer UI for the current question, used by both the player view and
// (now that the host plays too) the host view. Owns submit + locked/result
// state, resetting when the question changes. Reports the result via onResult so
// a parent can drive dependent affordances (e.g. the player's "my answer was
// wrongly marked" challenge). Scoring/judging happen server-side (KTD4).

import { useEffect, useRef, useState } from "react";
import { submitAnswer, type SubmitResult } from "@/app/actions/submitAnswer";
import { Fireworks } from "@/components/Fireworks";
import { TILE_SHAPES } from "@/lib/answerShapes";
import type { ClientQuestion } from "@/lib/db/types";
import { formatNumber } from "@/lib/formatScore";

// Show the "in a row" badge only once it is worth celebrating (2+).
const STREAK_BADGE_MIN = 2;

export function AnswerPanel({
  token,
  question,
  currentIndex,
  timeUp,
  onResult,
}: {
  token: string;
  question: ClientQuestion;
  currentIndex: number;
  timeUp: boolean;
  onResult?: (result: SubmitResult | null) => void;
}) {
  const [answeredIndex, setAnsweredIndex] = useState<number | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const locked = answeredIndex === currentIndex;

  // Reset per question. Ref keeps the effect from re-firing on onResult identity.
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  useEffect(() => {
    setResult(null);
    setTyped("");
    setError(null);
    onResultRef.current?.(null);
  }, [currentIndex]);

  async function submit(answer: string) {
    if (locked || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await submitAnswer(token, answer);
      setResult(res);
      setAnsweredIndex(currentIndex);
      setTyped("");
      onResultRef.current?.(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit");
    } finally {
      setSubmitting(false);
    }
  }

  if (locked) {
    return (
      <p className={`result ${result?.correct ? "correct" : "wrong"}`} aria-live="assertive">
        {/* Celebrate a correct answer on this device only (R1). */}
        {result?.correct && <Fireworks />}
        {result?.correct ? "✓ Correct" : "✗ Answer locked in"}
        {result && result.points > 0 ? ` — +${formatNumber(result.points)}` : ""}
        {result?.correct && (result.streak ?? 0) >= STREAK_BADGE_MIN && (
          <span className="streak-badge">
            🔥 {formatNumber(result.streak ?? 0)} in a row!
          </span>
        )}
      </p>
    );
  }
  if (timeUp) return <p>Time’s up — waiting for the next question.</p>;

  return (
    <>
      {error && <p role="alert">{error}</p>}
      {question.mode === "multiple_choice" ? (
        <ul className="answer-tiles">
          {(question.options ?? []).map((opt, i) => (
            <li key={i}>
              <button type="button" disabled={submitting} onClick={() => submit(String(i))}>
                <span className="answer-tile__shape" aria-hidden="true">
                  {TILE_SHAPES[i % TILE_SHAPES.length]}
                </span>
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
    </>
  );
}
