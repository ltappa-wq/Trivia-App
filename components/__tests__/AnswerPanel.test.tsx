// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AnswerPanel } from "../AnswerPanel";
import type { ClientQuestion } from "@/lib/db/types";

vi.mock("@/app/actions/submitAnswer", () => ({ submitAnswer: vi.fn() }));
vi.mock("@/components/Fireworks", () => ({ Fireworks: () => null }));
afterEach(cleanup);
const question: ClientQuestion = {
  index: 0, mode: "multiple_choice", prompt: "Capital?",
  options: ["Paris", "Rome"], voided: false,
};

describe("restored answer", () => {
  it("locks a reloaded answer and restores points, choice and streak", () => {
    render(<AnswerPanel token="player" question={question} currentIndex={0} timeUp={false}
      myAnswer={{ raw_answer: "0", is_correct: true, points: 900, streak: 3 }} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/Correct/).textContent).toContain("+900");
    expect(screen.getByText(/Your answer: Paris/)).toBeTruthy();
    expect(screen.getByText(/3 in a row/)).toBeTruthy();
  });

  it("locks a wrong typed answer even after time expires", () => {
    render(<AnswerPanel token="player" question={{ ...question, mode: "type_answer" }}
      currentIndex={0} timeUp myAnswer={{ raw_answer: "London", is_correct: false, points: 0, streak: 0 }} />);
    expect(screen.getByText(/Answer locked in/)).toBeTruthy();
    expect(screen.getByText(/Your answer: London/)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("accepts an answer arriving after mount and unlocks the next question", () => {
    const { rerender } = render(<AnswerPanel token="player" question={question} currentIndex={0} timeUp={false} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    rerender(<AnswerPanel token="player" question={question} currentIndex={0} timeUp={false}
      myAnswer={{ raw_answer: "1", is_correct: false, points: 0, streak: 0 }} />);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<AnswerPanel token="player" question={{ ...question, index: 1 }} currentIndex={1} timeUp={false} myAnswer={null} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });
});

it("resets draft and pending submit state when the question changes", async () => {
  const { fireEvent } = await import("@testing-library/react");
  const props = { token: "player", question: { ...question, mode: "type_answer" as const }, currentIndex: 0, timeUp: false };
  const { rerender } = render(<AnswerPanel {...props} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Paris" } });
  rerender(<AnswerPanel {...props} currentIndex={1} question={{ ...props.question, index: 1 }} />);
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
  expect((screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement).disabled).toBe(true);
});

it("renders exactly two named binary tile buttons and restores their labels", () => {
  const binary = { ...question, mode: "true_false" as const, options: ["True", "False"] };
  const { rerender } = render(<AnswerPanel token="p" question={binary} currentIndex={0} timeUp={false} />);
  expect(screen.getAllByRole("button")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "True" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "False" })).toBeTruthy();
  rerender(<AnswerPanel token="p" question={binary} currentIndex={0} timeUp={false} myAnswer={{ raw_answer: "1", is_correct: true, points: 800, streak: 1 }} />);
  expect(screen.getByText(/Your answer: False/)).toBeTruthy();
});
