// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ResultsPage from "../page";
import { hydrate } from "@/lib/realtime/channel";
import { clearCredential, loadHostCredential, loadPlayerCredential, saveHostCredential, savePlayerCredential } from "@/lib/clientSession";
import { testStorage } from "@/test/stubs/storage";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("code=12345") }));
vi.mock("@/app/actions/serverTime", () => ({ serverNow: async () => Date.now() }));
vi.mock("@/lib/supabase/browser", () => ({ getBrowserClient: () => ({
  rpc,
  channel: () => ({ on: vi.fn(), subscribe: vi.fn() }),
  removeChannel: vi.fn(),
}) }));
// Observe the identity and standings passed to the shared podium/feedback UI.
vi.mock("@/components/GameOver", () => ({ GameOver: ({ myPlayerId, standings }: {
  myPlayerId?: string; standings: { username: string }[];
}) => <section>Results for {myPlayerId}: {standings.map(p => p.username).join(", ")}</section> }));

beforeEach(() => {
  const persistent = testStorage(), tab = testStorage();
  Object.defineProperty(window, "localStorage", { configurable: true, get: () => persistent });
  Object.defineProperty(window, "sessionStorage", { configurable: true, get: () => tab });
  clearCredential("host", "12345"); clearCredential("player", "12345");
  saveHostCredential({ code: "12345", gameId: "g", token: "h", playerToken: "p", username: "Alex" });
  savePlayerCredential({ code: "12345", token: "p", username: "Alex" });
  rpc.mockReset().mockResolvedValue({ error: null, data: {
    role: "player", game: { code: "12345", status: "ended" },
    player: { id: "alex-id", username: "Alex", score: 100 },
    leaderboard: [{ id: "alex-id", username: "Alex", score: 100 }],
  } });
});
afterEach(cleanup);

it("keeps results identity after ended hydration, re-render and reopening", async () => {
  const view = render(<ResultsPage />);
  expect(await screen.findByText("Results for alex-id: Alex")).toBeTruthy();
  view.rerender(<ResultsPage />);
  expect(screen.queryByText("Not in this game.")).toBeNull();
  expect(loadPlayerCredential("12345")?.token).toBe("p");
  expect(loadHostCredential("12345")?.token).toBe("h");
  view.unmount();
  render(<ResultsPage />);
  expect(await screen.findByText("Results for alex-id: Alex")).toBeTruthy();
  expect(rpc).toHaveBeenCalledWith("hydrate_game_state", { p_token: "p" });
});

it("still removes credentials when the server returns an invalid token", async () => {
  rpc.mockResolvedValue({ data: null, error: null });
  expect(await hydrate("p")).toBeNull();
  expect(loadPlayerCredential("12345")).toBeNull();
  expect(loadHostCredential("12345")).toBeNull();
});
