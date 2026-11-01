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
  expect((screen.getByRole("button", { name: "Remove" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
  expect(onEdit).toHaveBeenCalledWith("q", "regenerate");
});
it("disables regeneration at the room limit and all edits while busy", () => {
  const { rerender } = render(<QuestionReviewPanel review={{ ...review, regenerationsRemaining: 0 }} busy={false} onEdit={vi.fn()} />);
  expect((screen.getByRole("button", { name: "Regenerate" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("status").textContent).toContain("limit of 20");
  rerender(<QuestionReviewPanel review={review} busy onEdit={vi.fn()} />);
  expect((screen.getByRole("button", { name: "Regenerate" }) as HTMLButtonElement).disabled).toBe(true);
});
