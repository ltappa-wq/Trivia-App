// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import PlayPage from "../page";
import type { HydratedState } from "@/lib/db/types";

const mocks = vi.hoisted(() => ({ state: null as HydratedState | null, challenge: vi.fn(async () => {}),
  progress: vi.fn(async () => ({ data: { answered_count: 1, active_count: 2, answered_player_ids: [] }, error: null })) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("code=ABC123") }));
vi.mock("@/lib/clientSession", () => ({ loadPlayerCredential: () => ({ token: "player", username: "Ada" }) }));
vi.mock("@/lib/realtime/hooks", () => ({
  useRoomState: () => ({ state: mocks.state, loading: false, offset: 0 }),
  useQuestionCountdown: () => 5000, useIsGetReady: () => false,
}));
vi.mock("@/lib/realtime/channel", () => ({ revealAnswer: vi.fn(async () => null) }));
vi.mock("@/lib/supabase/browser", () => ({ getBrowserClient: () => ({ rpc: mocks.progress }) }));
vi.mock("@/app/actions/challenge", () => ({ challenge: mocks.challenge }));
vi.mock("@/app/actions/submitAnswer", () => ({ submitAnswer: vi.fn() }));
vi.mock("@/components/Fireworks", () => ({ Fireworks: () => null }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function state(): HydratedState {
  return {
    role: "player", player: { id: "p", username: "Ada", score: 0 }, leaderboard: [],
    game: { id: "g", code: "ABC123", status: "active", answer_mode: "multiple_choice",
      difficulty: "medium", question_count: 5, current_index: 0,
      reveal_at: new Date(Date.now() - 5000).toISOString(), paused: false, reviewing: false },
    current_question: { index: 0, prompt: "Capital?", options: ["Paris", "Rome"], mode: "multiple_choice", voided: false },
    my_answer: { raw_answer: "1", is_correct: false, points: 0, streak: 0 },
  };
}

describe("reload dispute", () => {
  it("restores the wrongly-marked dispute alongside live progress and submits with the player token", async () => {
    mocks.state = state();
    render(<PlayPage />);
    fireEvent.click(await screen.findByRole("button", { name: "My answer was wrongly marked" }));
    expect(mocks.challenge).toHaveBeenCalledWith("player", "answer");
    expect(screen.getByText(/Answer locked in/)).toBeTruthy();
    expect(await screen.findByText("1 of 2 answered")).toBeTruthy();
    expect(mocks.progress).toHaveBeenCalledWith("answer_progress", { p_token: "player" });
  });
  it("does not offer an answer dispute for correct answers or unanswered questions", async () => {
    mocks.state = state();
    mocks.state.my_answer = { raw_answer: "0", is_correct: true, points: 900, streak: 2 };
    const { rerender } = render(<PlayPage />);
    expect(screen.queryByText("My answer was wrongly marked")).toBeNull();
    mocks.state = { ...mocks.state, my_answer: null };
    rerender(<PlayPage />);
    await screen.findByText("1 of 2 answered");
    expect(screen.queryByText("My answer was wrongly marked")).toBeNull();
  });
});
