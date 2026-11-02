// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
const { room, reveal, distribution } = vi.hoisted(() => ({ room: vi.fn(), reveal: vi.fn(), distribution: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("code=12345") }));
vi.mock("@/lib/realtime/hooks", () => ({ useRoomState: room, useQuestionCountdown: () => 1000 }));
vi.mock("@/lib/realtime/channel", () => ({ revealAnswer: reveal, answerDistribution: distribution }));
import Page from "../page";
import { clearDisplayToken } from "@/lib/displaySession";
beforeEach(() => {
  vi.clearAllMocks(); clearDisplayToken("12345");
  window.history.replaceState(null, "", `/display?code=12345#t=${"a".repeat(43)}`);
  room.mockReturnValue({ state: null, loading: false, error: null, offset: 0, refresh: vi.fn() });
});
afterEach(cleanup);
it("consumes and scrubs the fragment before passing credentials to room hydration", async () => {
  render(<Page />);
  await waitFor(() => expect(room).toHaveBeenLastCalledWith("12345", "a".repeat(43)));
  expect(window.location.hash).toBe("");
  expect(screen.getByText("TV display link required")).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "TV display link required" }));
  expect(reveal).not.toHaveBeenCalled(); expect(distribution).not.toHaveBeenCalled();
});
it("never reads challenge details or review keys when paused", async () => {
  room.mockReturnValue({ state: { role: "display", player: null, my_answer: null, leaderboard: [], current_question: null,
    game: { id: "g", code: "12345", status: "active", current_index: 0, paused: true, reviewing: true, reveal_at: null } },
    offset: 0, loading: false, error: null, refresh: vi.fn() });
  render(<Page />);
  expect(await screen.findByText("The host is reviewing a challenge.")).toBeTruthy();
  expect(reveal).not.toHaveBeenCalled(); expect(distribution).not.toHaveBeenCalled();
});

it("consumes and scrubs a regenerated link pasted into the same TV tab", async () => {
  render(<Page />);
  await waitFor(() => expect(room).toHaveBeenLastCalledWith("12345", "a".repeat(43)));
  await act(async () => {
    window.history.replaceState(null, "", `/display?code=12345#t=${"b".repeat(43)}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  await waitFor(() => expect(room).toHaveBeenLastCalledWith("12345", "b".repeat(43)));
  expect(window.location.hash).toBe("");
});
