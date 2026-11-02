// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DisplayStage } from "../DisplayStage";
import type { HydratedState } from "@/lib/db/types";
vi.mock("@/lib/supabase/browser", () => ({ getBrowserClient: () => ({ rpc: async () => ({ data: { answered_count: 1, active_count: 2, answered_player_ids: [] } }) }) }));
afterEach(cleanup);
const state: HydratedState = {
  role: "display", player: null, my_answer: null,
  game: { id: "g", code: "12345", status: "active", answer_mode: "multiple_choice", difficulty: "easy", question_count: 2, current_index: 0, reveal_at: new Date(Date.now() - 1000).toISOString(), paused: false, reviewing: false },
  current_question: { index: 0, prompt: "Capital of France?", mode: "multiple_choice", options: ["Paris", "Rome"], voided: false },
  leaderboard: [{ id: "b", username: "Bob", score: 100 }, { id: "a", username: "Alice", score: 0 }],
};
const reveal = { index: 0, mode: "multiple_choice" as const, options: ["Paris", "Rome"], correct_option: 0, accepted_variants: null, correction: null, explanation: "Paris is on the Seine." };
function show(over: Partial<HydratedState["game"]> = {}, extra: Partial<HydratedState> = {}) {
  return render(<DisplayStage state={{ ...state, ...extra, game: { ...state.game, ...over } }} token="display"
    origin="http://localhost" offset={0} remaining={15000} reveal={reveal}
    distribution={{ ...reveal, total: 2, counts: [1, 1] }}
    baseline={[{ id: "a", username: "Alice", score: 100 }, { id: "b", username: "Bob", score: 0 }]} />);
}
function noControls() {
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("link")).toBeNull();
}
describe("read-only TV phases", () => {
  it("shows lobby join QR, code and joining players", () => {
    show({ status: "lobby", current_index: -1 });
    expect(screen.getByRole("img", { name: "Scan to join this trivia game" })).toBeTruthy();
    expect(screen.getByText("12345")).toBeTruthy();
    expect(screen.getByText("Alice")).toBeTruthy(); noControls();
  });
  it("hides the question and answer key during 3-2-1", () => {
    show({ reveal_at: new Date(Date.now() + 2900).toISOString() });
    expect(screen.getByText("Get ready")).toBeTruthy();
    expect(screen.queryByText("Capital of France?")).toBeNull();
    expect(screen.queryByText("Paris")).toBeNull(); noControls();
  });
  it("shows prompt, options, timer and anonymous answered counter", async () => {
    show();
    expect(screen.getByRole("heading", { name: "Capital of France?" })).toBeTruthy();
    expect(screen.getByText("Rome", { exact: false })).toBeTruthy();
    expect(await screen.findByText("1 of 2 answered")).toBeTruthy();
    expect(screen.queryByText("Correct answer:")).toBeNull();
    expect(screen.queryByText("Paris is on the Seine.")).toBeNull(); noControls();
  });
  it("shows typed questions without answer input", () => {
    show({}, { current_question: { ...state.current_question!, mode: "type_answer", options: null } });
    expect(screen.getByText("Type your answer on your phone.")).toBeTruthy(); noControls();
  });
  it("shows review answer, distribution, explanation and rank movement", () => {
    show({ reviewing: true });
    expect(screen.getByText("Correct answer:")).toBeTruthy();
    expect(screen.getByText("Paris is on the Seine.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Round leaderboard" })).toBeTruthy();
    expect(screen.getByLabelText("Up 1 ranks")).toBeTruthy(); noControls();
  });
  it("hides all challenge details and review keys when paused", () => {
    show({ paused: true, reviewing: true });
    expect(screen.getByRole("heading", { name: "Paused" })).toBeTruthy();
    expect(screen.getByText("The host is reviewing a challenge.")).toBeTruthy();
    expect(screen.queryByText("Correct answer:")).toBeNull();
    expect(screen.queryByText("Capital of France?")).toBeNull(); noControls();
  });
  it("shows podium and final standings without feedback or controls", () => {
    show({ status: "ended" });
    expect(screen.getByRole("heading", { name: "Final standings" })).toBeTruthy();
    expect(screen.getByLabelText("Top finishers")).toBeTruthy(); noControls();
  });
});

it("retains absolute ranks when rotating long standings", async () => {
  vi.useFakeTimers();
  try {
    const leaderboard = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, username: `Player ${i + 1}`, score: 100 - i }));
    const { container } = show({ reviewing: true }, { leaderboard });
    expect(screen.queryByText(/Player 9 —/)).toBeNull();
    const { act } = await import("@testing-library/react");
    act(() => vi.advanceTimersByTime(8000));
    expect(screen.getByText(/Player 9 —/)).toBeTruthy();
    expect(container.querySelector('li[data-player="p8"]')?.getAttribute("value")).toBe("9");
    noControls();
  } finally { vi.useRealTimers(); }
});
it("focuses TV phase changes and announces them without refocusing countdown ticks", () => {
  const props = { state, token: "display", origin: "http://localhost", offset: 0, remaining: 15000, reveal: null, distribution: null, baseline: null };
  const { rerender } = render(<DisplayStage {...props} />);
  const question = screen.getByRole("heading", { name: "Capital of France?" });
  expect(document.activeElement).toBe(question);
  question.blur();
  rerender(<DisplayStage {...props} remaining={14000} />);
  expect(document.activeElement).not.toBe(question);
  rerender(<DisplayStage {...props} state={{ ...state, game: { ...state.game, paused: true } }} />);
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Paused" }));
  expect(screen.getByRole("status").textContent).toContain("Game paused");
});
