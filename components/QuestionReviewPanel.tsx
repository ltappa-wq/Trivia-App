"use client";
import { useEffect, useRef, useState } from "react";
import type { QuestionReview } from "@/lib/questionReview";

export function QuestionReviewPanel({ review, busy, onEdit }: { review: QuestionReview; busy: boolean; onEdit: (id: string, operation: "regenerate" | "remove") => Promise<boolean> }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const panel = useRef<HTMLElement>(null);
  const pending = useRef<{ id: string; operation: "regenerate" | "remove" } | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  // Parent commits updated data and reenables controls before focus is restored.
  useEffect(() => {
    if (busy || !pending.current) return;
    const { id } = pending.current;
    pending.current = null;
    const question = Array.from(panel.current?.querySelectorAll<HTMLElement>("[data-review-question]") ?? [])
      .find(el => el.dataset.reviewQuestion === id);
    (question ?? heading.current)?.focus({ preventScroll: true });
  }, [busy, review]);
  async function edit(id: string, operation: "regenerate" | "remove") {
    pending.current = { id, operation };
    setMessage(operation === "regenerate" ? "Regenerating question. Please wait." : "Removing question. Please wait.");
    try {
      const success = await onEdit(id, operation);
      setMessage(success ? "Question edit finished. Review the updated question list." : "Question edit failed.");
    } catch { setMessage("Question edit failed."); }
  }
  return <section ref={panel} aria-label="Question review">
    <h2 ref={heading} tabIndex={-1}>Review questions ({review.questions.length})</h2>
    <p role="status" aria-atomic="true">{message}</p>
    <p>Only the host can see these answers. Category suggestions can no longer change this set.</p>
    <p>{review.regenerationsRemaining} regenerations remaining (20 per room). Failed attempts also count.</p>
    <p>Categories: {review.categories.join(", ")}</p>
    {busy && <p>Updating questions… Please wait before starting.</p>}
    <ol className="question-review__list">{review.questions.map((q) => <li key={q.id}>
      <h3 tabIndex={-1} data-review-question={q.id}>{q.index + 1}. {q.prompt}</h3>
      {q.options && <ul>{q.options.map((option, index) => <li key={index}>{option}{index === q.correct_option ? " — Correct answer" : ""}</li>)}</ul>}
      {q.accepted_variants && <p>Accepted answers: {q.accepted_variants.join(", ")}</p>}
      {q.explanation && <p>{q.explanation}</p>}
      <button type="button" aria-label={`Regenerate question ${q.index + 1}`} disabled={busy || review.regenerationsRemaining === 0} onClick={() => void edit(q.id, "regenerate")}>Regenerate</button>
      <button type="button" aria-label={`Remove question ${q.index + 1}`} disabled={busy || review.questions.length <= 1} onClick={() => void edit(q.id, "remove")}>Remove</button>
    </li>)}</ol>
    {review.regenerationsRemaining === 0 && <p role="status">This room has reached its limit of 20 regenerations.</p>}
  </section>;
}
