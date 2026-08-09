// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { GameOver } from "../GameOver";
import type { LeaderboardEntry } from "@/lib/db/types";

// U7 / R6 / AE5. The end screen is now reached the same way by both roles: each
// page renders it in place when the phase is `ended`. Previously only the host
// did that, and players depended on a client-side redirect to /results — the
// single point of failure this unit removes.

vi.mock("@/app/actions/submitFeedback", () => ({
  submitFeedback: vi.fn(async () => undefined),
}));

afterEach(cleanup);

const STANDINGS: LeaderboardEntry[] = [
  { id: "p1", username: "Ada", score: 3000 },
  { id: "p2", username: "Grace", score: 2000 },
  { id: "p3", username: "Alan", score: 1000 },
];

/** The full standings list, scoped past the podium (which repeats the top names). */
function standingsList(container: HTMLElement): HTMLElement {
  const list = container.querySelector(".results-list");
  if (!list) throw new Error("standings list not rendered");
  return list as HTMLElement;
}

function standingsOrder(container: HTMLElement): string[] {
  return within(standingsList(container))
    .getAllByRole("listitem")
    .map((li) => li.textContent ?? "");
}

describe("GameOver — standings (U7, R6)", () => {
  it("renders the final standings", () => {
    const { container } = render(
      <GameOver standings={STANDINGS} myPlayerId="p2" roomCode="ABC123" />,
    );
    expect(screen.getByRole("heading", { name: /final results/i })).toBeTruthy();
    const list = standingsList(container);
    expect(within(list).getByText(/Ada/)).toBeTruthy();
    expect(within(list).getByText(/Grace/)).toBeTruthy();
    expect(within(list).getByText(/Alan/)).toBeTruthy();
  });

  it("shows the same standings order regardless of which role is viewing", () => {
    // AE5's parity half: one leaderboard payload, one ordering.
    const player = render(<GameOver standings={STANDINGS} myPlayerId="p2" roomCode="ABC123" />);
    const asPlayer = standingsOrder(player.container);
    cleanup();

    const host = render(<GameOver standings={STANDINGS} myPlayerId={null} roomCode="ABC123" />);
    const asHost = standingsOrder(host.container);

    // Same order; only the "(you)" marker differs, which is a viewer affordance.
    expect(asPlayer.map((t) => t.replace(" (you)", ""))).toEqual(asHost);
  });

  it("sorts by score rather than trusting the payload order", () => {
    const unsorted: LeaderboardEntry[] = [
      { id: "p3", username: "Alan", score: 1000 },
      { id: "p1", username: "Ada", score: 3000 },
      { id: "p2", username: "Grace", score: 2000 },
    ];
    const { container } = render(<GameOver standings={unsorted} myPlayerId="p1" />);
    const order = standingsOrder(container);
    expect(order[0]).toContain("Ada");
    expect(order[2]).toContain("Alan");
  });
});

describe("GameOver — personal placement (U7, R6)", () => {
  it("shows a placement card to a player who is in the standings", () => {
    render(<GameOver standings={STANDINGS} myPlayerId="p2" />);
    expect(screen.getByText(/You placed 2nd/i)).toBeTruthy();
  });

  it("congratulates the winner rather than reporting a placement", () => {
    render(<GameOver standings={STANDINGS} myPlayerId="p1" />);
    expect(screen.getByText(/You won/i)).toBeTruthy();
  });

  it("shows a spectator the standings and NO personal placement card", () => {
    // A spectator joined mid-game and is absent from the leaderboard.
    const { container } = render(<GameOver standings={STANDINGS} myPlayerId="spectator-id" />);
    expect(within(standingsList(container)).getByText(/Ada/)).toBeTruthy();
    expect(container.querySelector(".placement-card")).toBeNull();
  });

  it("shows a host-only gamemaster the standings and no placement card", () => {
    const { container } = render(<GameOver standings={STANDINGS} myPlayerId={null} />);
    expect(within(standingsList(container)).getByText(/Grace/)).toBeTruthy();
    expect(container.querySelector(".placement-card")).toBeNull();
  });
});

describe("GameOver — degenerate payloads (U7)", () => {
  it("reports no winner rather than rendering a broken podium when nobody scored", () => {
    render(<GameOver standings={[]} myPlayerId={null} />);
    expect(screen.getByText(/No winner/i)).toBeTruthy();
  });

  it("names joint winners on a tie", () => {
    const tied: LeaderboardEntry[] = [
      { id: "p1", username: "Ada", score: 2000 },
      { id: "p2", username: "Grace", score: 2000 },
    ];
    render(<GameOver standings={tied} myPlayerId="p1" />);
    expect(screen.getAllByText(/winner/i).length).toBeGreaterThan(1);
  });
});
