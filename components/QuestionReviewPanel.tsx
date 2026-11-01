"use client";
import type { QuestionReview } from "@/lib/questionReview";

export function QuestionReviewPanel({ review, busy, onEdit }: { review: QuestionReview; busy: boolean; onEdit: (id: string, operation: "regenerate" | "remove") => Promise<void> }) {
  return <section aria-label="Question review">
    <h2>Review questions ({review.questions.length})</h2>
    <p>Only the host can see these answers. Category suggestions can no longer change this set.</p>
    <p>{review.regenerationsRemaining} regenerations remaining (20 per room). Failed attempts also count.</p>
    <p>Categories: {review.categories.join(", ")}</p>
    {busy && <p role="status">Updating questions… Please wait before starting.</p>}
    <ol>{review.questions.map((q) => <li key={q.id}>
      <h3>{q.index + 1}. {q.prompt}</h3>
      {q.options && <ul>{q.options.map((option, index) => <li key={index}>{option}{index === q.correct_option ? " — Correct answer" : ""}</li>)}</ul>}
      {q.accepted_variants && <p>Accepted answers: {q.accepted_variants.join(", ")}</p>}
      {q.explanation && <p>{q.explanation}</p>}
      <button type="button" disabled={busy || review.regenerationsRemaining === 0} onClick={() => void onEdit(q.id, "regenerate")}>Regenerate</button>
      <button type="button" disabled={busy || review.questions.length <= 1} onClick={() => void onEdit(q.id, "remove")}>Remove</button>
    </li>)}</ol>
    {review.regenerationsRemaining === 0 && <p role="status">This room has reached its limit of 20 regenerations.</p>}
  </section>;
}
