// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RoundRecap, useRoundSnapshot } from "../RoundRecap";
import { RoundLeaderboard } from "../RoundLeaderboard";
import { GameFeedback } from "../GameFeedback";
import { gameSound } from "@/lib/sound";
import type { HydratedState } from "@/lib/db/types";
vi.mock("@/lib/sound", () => ({ gameSound: { play: vi.fn(), haptic: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const before = [{ id: "a", username: "Ada", score: 500 }, { id: "b", username: "Bob", score: 400 }];
const after = [{ ...before[0] }, { ...before[1], score: 1250 }];
const state: HydratedState = {
  role: "player", player: { id: "b", username: "Bob", score: 1250 },
  leaderboard: before, my_answer: null,
  game: { id: "game", code: "12345", status: "active", current_index: 0, question_count: 2,
    answer_mode: "multiple_choice", difficulty: "easy", reveal_at: null, paused: false, reviewing: false },
  current_question: { index: 0, prompt: "Question", mode: "multiple_choice", options: ["A", "B"], voided: false },
};
function Recap({ data, phase }: { data: HydratedState; phase: string }) {
  const baseline = useRoundSnapshot(data, phase);
  return phase === "review" ? <RoundRecap state={data} baseline={baseline} /> : null;
}
describe("round recap UI", () => {
  it("updates points and ranks after adjudication without replacing the baseline", () => {
    const { rerender } = render(<Recap data={state} phase="get_ready" />);
    const reviewed = { ...state, leaderboard: after, my_answer: { raw_answer: "0", is_correct: true, points: 850, streak: 1 } };
    rerender(<Recap data={reviewed} phase="review" />);
    expect(screen.getByRole("status").textContent).toBe("+850 pts · now 1st (↑1)");
    rerender(<Recap data={{ ...reviewed, leaderboard: before, current_question: { ...state.current_question!, voided: true } }} phase="review" />);
    expect(screen.getByRole("status").textContent).toBe("Question voided · No points this round · Still 2nd");
  });
  it("shows no movement after reload and no scoring recap for spectators", () => {
    const { rerender } = render(<Recap data={state} phase="review" />);
    expect(screen.getByRole("status").textContent).toBe("No points this round · now 2nd");
    rerender(<Recap data={{ ...state, role: "spectator" }} phase="review" />);
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("shows host arrows only during review and preserves tied rank values", () => {
    const { rerender } = render(<RoundLeaderboard standings={after} baseline={before} reviewing />);
    expect(screen.getByLabelText("Up 1 ranks")).toBeTruthy();
    rerender(<RoundLeaderboard standings={after} baseline={before} reviewing={false} />);
    expect(screen.queryByLabelText("Up 1 ranks")).toBeNull();
    rerender(<RoundLeaderboard standings={before.map((p) => ({ ...p, score: 100 }))} baseline={null} reviewing />);
    expect(screen.getAllByRole("listitem").map((li) => li.getAttribute("value"))).toEqual(["1", "1"]);
  });
});
it("limits ticks to final live seconds and suppresses void/spectator results", () => {
  const props = { phase: "question", remaining: 3100, roundKey: "game:0", answer: null, voided: false, spectating: false };
  const { rerender } = render(<GameFeedback {...props} />);
  expect(gameSound.play).not.toHaveBeenCalled();
  rerender(<GameFeedback {...props} remaining={2900} />);
  expect(gameSound.play).toHaveBeenCalledWith("tick", "game:0:tick:3");
  vi.clearAllMocks();
  rerender(<GameFeedback {...props} phase="paused" remaining={1900} />);
  rerender(<GameFeedback {...props} phase="review" voided />);
  rerender(<GameFeedback {...props} phase="review" spectating />);
  expect(gameSound.play).not.toHaveBeenCalled();
  rerender(<GameFeedback {...props} phase="review" />);
  expect(gameSound.play).toHaveBeenCalledWith("wrong", "game:0:result:wrong");
  expect(gameSound.haptic).toHaveBeenCalledWith("wrong", "game:0:result:wrong");
});
it("animates reorder with Web Animations only when reduced motion is off", () => {
  let reduced = false;
  vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
  const animate = vi.fn();
  const originalAnimate = HTMLElement.prototype.animate;
  HTMLElement.prototype.animate = animate;
  let tops = { a: 0, b: 40 };
  const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { top: tops[this.dataset.player as "a" | "b"] ?? 0 } as DOMRect;
  });
  try {
    const { rerender } = render(<RoundLeaderboard standings={before} baseline={before} reviewing />);
    tops = { a: 40, b: 0 };
    rerender(<RoundLeaderboard standings={after} baseline={before} reviewing />);
    expect(animate).toHaveBeenCalledTimes(2);
    animate.mockClear(); reduced = true; tops = { a: 0, b: 40 };
    rerender(<RoundLeaderboard standings={before} baseline={before} reviewing />);
    expect(animate).not.toHaveBeenCalled();
  } finally {
    bounds.mockRestore(); HTMLElement.prototype.animate = originalAnimate; vi.unstubAllGlobals();
  }
});
