// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QuestionReviewPanel } from "@/components/QuestionReviewPanel";
import { useQuestionReview } from "../useQuestionReview";
const m = vi.hoisted(() => ({ status: vi.fn(), review: vi.fn() }));
vi.mock("@/app/actions/questionReview", () => ({ getPreparedQuestionStatus: m.status, getQuestionReview: m.review }));
const args = { code: "12345", token: "host", gameId: "game", lobby: true, starting: false, busy: false };
function Lobby({ gameId = "game" }: { gameId?: string }) {
  const { review, prepared, requestReview } = useQuestionReview({ ...args, gameId });
  return <>
    {prepared && <p>Questions prepared</p>}
    <button onClick={requestReview}>Review questions first</button>
    {review && <QuestionReviewPanel review={review} busy={false} onEdit={vi.fn()} />}
  </>;
}
beforeEach(() => {
  vi.useFakeTimers(); sessionStorage.clear();
  m.status.mockResolvedValue(true);
  m.review.mockResolvedValue({ categories: ["Geography"], regenerationsRemaining: 20, questions: [{ id: "q", index: 0, prompt: "Capital?", mode: "type_answer", accepted_variants: ["Paris"], explanation: "Secret explanation." }] });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); sessionStorage.clear(); });
it("never fetches or renders answers for default Start with prepared questions, including polls and reload", async () => {
  const view = await act(async () => render(<Lobby />));
  expect(screen.getByText("Questions prepared")).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
  expect(m.status).toHaveBeenCalledTimes(4);
  expect(m.review).not.toHaveBeenCalled();
  expect(screen.queryByRole("region", { name: "Question review" })).toBeNull();
  expect(screen.queryByText(/Paris|Secret explanation/)).toBeNull();
  view.unmount();
  await act(async () => { render(<Lobby />); });
  expect(m.review).not.toHaveBeenCalled();
  expect(screen.queryByRole("region", { name: "Question review" })).toBeNull();
});
it("fetches answers only after opt-in and restores that choice on reload", async () => {
  const view = await act(async () => render(<Lobby />));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Review questions first" })); });
  expect(screen.getByText("Accepted answers: Paris")).toBeTruthy();
  expect(sessionStorage.getItem("trivia:question-review:game")).toBe("1");
  view.unmount();
  await act(async () => { render(<Lobby />); });
  expect(screen.getByText("Secret explanation.")).toBeTruthy();
});
it("does not carry consent into another room", async () => {
  sessionStorage.setItem("trivia:question-review:game", "1");
  const view = await act(async () => render(<Lobby />));
  expect(screen.getByText("Accepted answers: Paris")).toBeTruthy();
  m.review.mockClear();
  await act(async () => { view.rerender(<Lobby gameId="other-game" />); });
  expect(screen.queryByRole("region", { name: "Question review" })).toBeNull();
  expect(m.review).not.toHaveBeenCalled();
});
