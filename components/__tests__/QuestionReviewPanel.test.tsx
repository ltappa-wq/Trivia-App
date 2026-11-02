// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { QuestionReviewPanel } from "../QuestionReviewPanel";
import type { QuestionReview } from "@/lib/questionReview";
afterEach(cleanup);
const review: QuestionReview = { categories: ["Geography"], regenerationsRemaining: 20, questions: [{ id: "q", index: 0, prompt: "Capital?", mode: "multiple_choice", difficulty: "easy", options: ["Paris", "Rome", "Tokyo"], correct_option: 0, accepted_variants: null, explanation: "Paris is the French capital." }] };
it("shows answer keys and explanation, freezes categories, and protects the last question", () => {
  const onEdit = vi.fn(); render(<QuestionReviewPanel review={review} busy={false} onEdit={onEdit} />);
  expect(screen.getByText("Paris — Correct answer")).toBeTruthy();
  expect(screen.getByText("Paris is the French capital.")).toBeTruthy();
  expect(screen.getByText(/suggestions can no longer/)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Remove question 1" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Regenerate question 1" }));
  expect(onEdit).toHaveBeenCalledWith("q", "regenerate");
});
it("disables regeneration at the room limit and all edits while busy", () => {
  const { rerender } = render(<QuestionReviewPanel review={{ ...review, regenerationsRemaining: 0 }} busy={false} onEdit={vi.fn()} />);
  expect((screen.getByRole("button", { name: "Regenerate question 1" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/limit of 20/)).toBeTruthy();
  rerender(<QuestionReviewPanel review={review} busy onEdit={vi.fn()} />);
  expect((screen.getByRole("button", { name: "Regenerate question 1" }) as HTMLButtonElement).disabled).toBe(true);
});
it("focuses the review on arrival and returns focus after removing a question", async () => {
  const second = { ...review.questions[0]!, id: "q2", index: 1, prompt: "Second question?" };
  const full = { ...review, questions: [...review.questions, second] };
  const onEdit = vi.fn(async () => true);
  const { rerender } = render(<QuestionReviewPanel review={full} busy={false} onEdit={onEdit} />);
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Review questions (2)" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove question 2" }));
  rerender(<QuestionReviewPanel review={full} busy onEdit={onEdit} />);
  rerender(<QuestionReviewPanel review={review} busy={false} onEdit={onEdit} />);
  const { waitFor } = await import("@testing-library/react");
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Review questions (1)" })));
  expect(screen.getByRole("status").textContent).toContain("edit finished");
});

it.each([false, "throw"])("announces failed edits without a contradictory success status (%s)", async outcome => {
  const onEdit = vi.fn(async () => { if (outcome === "throw") throw new Error("Offline"); return false; });
  render(<QuestionReviewPanel review={review} busy={false} onEdit={onEdit} />);
  fireEvent.click(screen.getByRole("button", { name: "Regenerate question 1" }));
  const { waitFor } = await import("@testing-library/react");
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Question edit failed."));
  expect(screen.queryByText(/Question edit finished/)).toBeNull();
});
