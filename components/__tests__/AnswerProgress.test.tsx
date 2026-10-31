// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnswerProgress } from "../AnswerProgress";
import type { HydratedState } from "@/lib/db/types";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/browser", () => ({ getBrowserClient: () => ({ rpc }) }));
const state: HydratedState = { role: "host", game: { id: "g", code: "12345", status: "active", answer_mode: "multiple_choice", difficulty: "medium", question_count: 3, current_index: 0, reveal_at: new Date(0).toISOString(), paused: false, reviewing: false }, player: null, current_question: null, leaderboard: [{ id: "a", username: "Alice", score: 0 }, { id: "b", username: "Bob", score: 0 }] };
const data = { answered_count: 1, active_count: 2, answered_player_ids: ["a"] };
beforeEach(() => { rpc.mockReset().mockResolvedValue({ data, error: null }); });
afterEach(cleanup);
it("shows counts and answered chips to the host", async () => {
  render(<AnswerProgress state={state} token="host" isHost />);
  expect(await screen.findByText("1 of 2 answered")).toBeTruthy();
  expect(screen.getByText("Alice ✓").className).toContain("--answered");
  expect(screen.getByText("Bob — waiting").className).not.toContain("--answered");
});
it("renders only counts for players", async () => {
  render(<AnswerProgress state={state} token="player" />);
  await screen.findByText("1 of 2 answered");
  expect(screen.queryByText(/Alice/)).toBeNull();
});
it("reconciles progress on room updates and hides stale previous-question data", async () => {
  const { rerender } = render(<AnswerProgress state={state} token="host" isHost />);
  await screen.findByText("1 of 2 answered");
  rpc.mockResolvedValueOnce({ data: { ...data, answered_count: 2, answered_player_ids: ["a", "b"] }, error: null });
  rerender(<AnswerProgress state={{ ...state }} token="host" isHost />);
  await screen.findByText("2 of 2 answered");
  let resolve!: (v: unknown) => void;
  rpc.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
  rerender(<AnswerProgress state={{ ...state, game: { ...state.game, current_index: 1 } }} token="host" isHost />);
  expect(screen.queryByText("2 of 2 answered")).toBeNull();
  await act(async () => { resolve({ data: { ...data, answered_count: 0, answered_player_ids: [] }, error: null }); });
  expect(await screen.findByText("0 of 2 answered")).toBeTruthy();
});
