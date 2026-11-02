"use client";
// Shared answer UI for the current question, used by both the player view and
// (now that the host plays too) the host view. Owns submit + locked/result
// state, resetting when the question changes. Reports the result via onResult so
// a parent can drive dependent affordances (e.g. the player's "my answer was
// wrongly marked" challenge). Scoring/judging happen server-side (KTD4).

import { useEffect, useRef, useState } from "react";
import { submitAnswer, type SubmitResult } from "@/app/actions/submitAnswer";
import { gameSound } from "@/lib/sound";
import { Fireworks } from "@/components/Fireworks";
import { answerKeyIndex } from "@/lib/accessibility";
import { TILE_SHAPES, TILE_SHAPE_NAMES } from "@/lib/answerShapes";
import type { ClientQuestion, MyAnswer } from "@/lib/db/types";
import { formatNumber } from "@/lib/formatScore";

// Show the "in a row" badge only once it is worth celebrating (2+).
const STREAK_BADGE_MIN = 2;

type AnswerPanelProps = {
  token: string;
  myAnswer?: MyAnswer | null;
  question: ClientQuestion;
  currentIndex: number;
  timeUp: boolean;
  onResult?: (result: SubmitResult | null) => void;
};

export function AnswerPanel(props: AnswerPanelProps) {
  return <QuestionAnswerPanel key={`${props.token}:${props.currentIndex}`} {...props} />;
}

function QuestionAnswerPanel({
  token,
  myAnswer,
  question,
  currentIndex,
  timeUp,
  onResult,
}: AnswerPanelProps) {
  const tiles = useRef<HTMLUListElement>(null);
  const [answeredIndex, setAnsweredIndex] = useState<number | null>(null);
  const [localResult, setResult] = useState<SubmitResult | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const restoredResult = myAnswer ? { correct: myAnswer.is_correct, points: myAnswer.points, streak: myAnswer.streak } : null;
  const result = restoredResult ?? localResult;
  const locked = !!myAnswer || answeredIndex === currentIndex;

  async function submit(answer: string) {
    if (locked || submitting) return;
    gameSound.unlock();
    setSubmitting(true);
    setError(null);
    try {
      const res = await submitAnswer(token, answer);
      gameSound.haptic("lock");
      setResult(res);
      setAnsweredIndex(currentIndex);
      setTyped("");
      onResult?.(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit");
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (question.mode === "type_answer" || locked || timeUp || submitting) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target as HTMLElement;
      if (!tiles.current?.contains(target) && !target.matches("[data-question-heading]")) return;
      const buttons = Array.from(tiles.current?.querySelectorAll("button") ?? []);
      const current = buttons.indexOf(target as HTMLButtonElement);
      const next = answerKeyIndex(event.key, current, buttons.length);
      if (next === null) return;
      event.preventDefault();
      buttons[next]?.focus();
      if (/^[1-9]$/.test(event.key)) buttons[next]?.click();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [question.mode, locked, timeUp, submitting]);

  if (locked) {
    return (
      <p className={`result ${result?.correct ? "correct" : "wrong"}`} aria-live="assertive">
        {/* Celebrate a correct answer on this device only (R1). */}
        {result?.correct && <Fireworks />}
        {result?.correct ? "✓ Correct" : "✗ Answer locked in"}
        {myAnswer && <span> — Your answer: {question.mode !== "type_answer" ? question.options?.[Number(myAnswer.raw_answer)] ?? myAnswer.raw_answer : myAnswer.raw_answer}</span>}
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
      {question.mode !== "type_answer" ? (
        <ul ref={tiles} className={`answer-tiles${question.mode === "true_false" ? " answer-tiles--true-false" : ""}`} aria-label={`Answer choices. Use arrow keys to move, Enter to choose, or number keys 1 to ${question.options?.length ?? 0}.`}>
          {(question.options ?? []).map((opt, i) => (
            <li key={i}>
              <button type="button" aria-label={`${String.fromCharCode(65 + i)}, ${TILE_SHAPE_NAMES[i % TILE_SHAPE_NAMES.length]}: ${opt}`} disabled={submitting} onClick={() => submit(String(i))}>
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
