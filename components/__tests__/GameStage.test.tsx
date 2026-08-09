// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { GameStage, type GameStageProps } from "../GameStage";
import type { ClientQuestion } from "@/lib/db/types";

// U6 / R5 / AE4. The parity contract: given one game state, the host and the
// player must render the same question, the same countdown and the same review
// content. Role may only add or remove *affordances*. Several of these assert
// behavior the host view simply did not have before (voided, spectators,
// type-answer read-only), which is the drift this unit exists to end.

afterEach(cleanup);

const MC_QUESTION: ClientQuestion = {
  index: 2,
  prompt: "What is the capital of France?",
  mode: "multiple_choice",
  options: ["Paris", "Lyon", "Nice", "Rome"],
  voided: false,
};

const TYPE_QUESTION: ClientQuestion = {
  index: 2,
  prompt: "Who wrote Hamlet?",
  mode: "type_answer",
  options: null,
  voided: false,
};

function props(over: Partial<GameStageProps> = {}): GameStageProps {
  return {
    phase: over.phase ?? { phase: "question", voided: false },
    question: over.question !== undefined ? over.question : MC_QUESTION,
    currentIndex: over.currentIndex ?? 2,
    revealAt: over.revealAt !== undefined ? over.revealAt : new Date().toISOString(),
    offset: over.offset ?? 0,
    remaining: over.remaining !== undefined ? over.remaining : 8_000,
    isHost: over.isHost ?? false,
    spectating: over.spectating ?? false,
    playerToken: over.playerToken !== undefined ? over.playerToken : "player-token",
    reveal: over.reveal !== undefined ? over.reveal : null,
    distribution: over.distribution !== undefined ? over.distribution : null,
    challenging: over.challenging ?? false,
    challengeError: over.challengeError ?? null,
    showAnswerDispute: over.showAnswerDispute ?? false,
    onChallenge: over.onChallenge ?? vi.fn(),
    onResult: over.onResult,
    controls: over.controls,
  };
}

/** The host on a shared screen who is not also playing: no player credential. */
const asHostOnly = { isHost: true, playerToken: null };
/** The host who chose to play too: host affordances *and* a player credential. */
const asHostWhoPlays = { isHost: true, playerToken: "host-player-token" };

describe("AE4: host and player see the same question (U6, R5)", () => {
  it("renders the same prompt and countdown for both roles", () => {
    const { container: hostDom } = render(<GameStage {...props(asHostOnly)} />);
    const hostPrompt = screen.getByRole("heading", { level: 2 }).textContent;
    const hostTimer = hostDom.querySelector(".countdown-ring__face")?.textContent ?? null;
    cleanup();

    const { container: playerDom } = render(<GameStage {...props()} />);
    const playerPrompt = screen.getByRole("heading", { level: 2 }).textContent;
    const playerTimer = playerDom.querySelector(".countdown-ring__face")?.textContent ?? null;

    expect(hostPrompt).toBe("What is the capital of France?");
    expect(playerPrompt).toBe(hostPrompt);
    expect(playerTimer).toBe(hostTimer);
  });
});

describe("get_ready phase (U6, R5)", () => {
  it("renders the 3-2-1 for both roles and no answer input", () => {
    const revealAt = new Date(Date.now() + 3_000).toISOString();

    for (const role of [asHostOnly, {}]) {
      render(<GameStage {...props({ ...role, phase: { phase: "get_ready" }, revealAt })} />);
      expect(screen.queryByRole("button", { name: /submit/i })).toBeNull();
      expect(screen.queryByRole("textbox")).toBeNull();
      cleanup();
    }
  });

  it("renders nothing without a reveal time to count down to", () => {
    const { container } = render(
      <GameStage {...props({ phase: { phase: "get_ready" }, revealAt: null })} />,
    );
    expect(container.innerHTML).toBe("");
  });
});

describe("question phase — who may answer (U6, R5)", () => {
  it("renders the answer input for a player", () => {
    render(<GameStage {...props()} />);
    expect(screen.getByRole("button", { name: "Paris" })).toBeTruthy();
  });

  it("renders the answer input for a host who plays", () => {
    render(<GameStage {...props(asHostWhoPlays)} />);
    expect(screen.getByRole("button", { name: "Paris" })).toBeTruthy();
  });

  it("shows a host-only gamemaster the options read-only, not as buttons", () => {
    render(<GameStage {...props(asHostOnly)} />);
    expect(screen.queryByRole("button", { name: "Paris" })).toBeNull();
    const list = screen.getByRole("list");
    expect(within(list).getByText("Paris")).toBeTruthy();
    expect(within(list).getByText("Rome")).toBeTruthy();
  });

  it("renders prompt and countdown for a host-only gamemaster in type-answer mode", () => {
    // Previously the host rendered options only for multiple choice, leaving a
    // type-answer question visibly emptier on the shared screen than on phones.
    const { container } = render(
      <GameStage {...props({ ...asHostOnly, question: TYPE_QUESTION })} />,
    );
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Who wrote Hamlet?");
    expect(container.querySelector(".countdown-ring")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

describe("question phase — voided, spectating, paused (U6, R5)", () => {
  it("renders the voided overlay for BOTH roles", () => {
    const voided = { ...MC_QUESTION, voided: true };

    for (const role of [asHostOnly, {}]) {
      render(
        <GameStage
          {...props({ ...role, question: voided, phase: { phase: "question", voided: true } })}
        />,
      );
      // The host view had no voided handling at all before this unit.
      expect(screen.getByText(/voided/i)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Paris" })).toBeNull();
      cleanup();
    }
  });

  it("renders the sitting-out overlay for a spectator and no answer input", () => {
    render(<GameStage {...props({ spectating: true })} />);
    expect(screen.getByText(/sitting out this question/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Paris" })).toBeNull();
  });

  it("renders the paused overlay for BOTH roles and suppresses the answer input", () => {
    for (const role of [asHostWhoPlays, {}]) {
      render(<GameStage {...props({ ...role, phase: { phase: "paused" } })} />);
      expect(screen.getByText(/paused/i)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Paris" })).toBeNull();
      cleanup();
    }
  });

  it("still shows the prompt while paused, so the room sees what is disputed", () => {
    render(<GameStage {...props({ phase: { phase: "paused" } })} />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "What is the capital of France?",
    );
  });
});

describe("review phase (U6, R5)", () => {
  const reviewing = { phase: "review" as const, voided: false };
  const distribution = {
    index: 2,
    mode: "multiple_choice" as const,
    options: ["Paris", "Lyon", "Nice", "Rome"],
    correct_option: 0,
    total: 4,
    counts: [3, 1, 0, 0],
  };
  const reveal = {
    index: 2,
    mode: "multiple_choice" as const,
    options: ["Paris", "Lyon", "Nice", "Rome"],
    correct_option: 0,
    accepted_variants: null,
    correction: null,
  };

  it("reveals the correct answer to both roles", () => {
    for (const role of [asHostOnly, {}]) {
      render(<GameStage {...props({ ...role, phase: reviewing, reveal })} />);
      expect(screen.getByText(/Paris/)).toBeTruthy();
      cleanup();
    }
  });

  it("renders the answer distribution for the host only", () => {
    const { container: hostDom } = render(
      <GameStage {...props({ ...asHostOnly, phase: reviewing, reveal, distribution })} />,
    );
    const hostHasBars = hostDom.querySelector("[aria-label='Answer distribution']") !== null;
    cleanup();

    const { container: playerDom } = render(
      <GameStage {...props({ phase: reviewing, reveal, distribution })} />,
    );

    expect(hostHasBars).toBe(true);
    expect(playerDom.querySelector("[aria-label='Answer distribution']")).toBeNull();
  });

  it("marks a voided question as not counting", () => {
    render(
      <GameStage {...props({ phase: { phase: "review", voided: true }, reveal })} />,
    );
    expect(screen.getByText(/doesn’t count/i)).toBeTruthy();
  });
});

describe("challenge affordances (U6, R5)", () => {
  it("offers challenges to a player", () => {
    render(<GameStage {...props()} />);
    expect(screen.getAllByRole("button", { name: /challenge|dispute|question/i }).length)
      .toBeGreaterThan(0);
  });

  it("offers challenges to a host who plays", () => {
    render(<GameStage {...props(asHostWhoPlays)} />);
    expect(screen.getAllByRole("button", { name: /challenge|dispute|question/i }).length)
      .toBeGreaterThan(0);
  });

  it("offers no challenges to a spectator", () => {
    render(<GameStage {...props({ spectating: true })} />);
    expect(screen.queryByRole("button", { name: /challenge|dispute/i })).toBeNull();
  });

  it("offers no challenges to a host-only gamemaster, who holds no player token", () => {
    render(<GameStage {...props(asHostOnly)} />);
    expect(screen.queryByRole("button", { name: /challenge|dispute/i })).toBeNull();
  });
});

describe("page-owned phases and the controls slot (U6)", () => {
  it("renders nothing for lobby and ended — those belong to the pages", () => {
    for (const phase of [{ phase: "lobby" as const }, { phase: "ended" as const }]) {
      const { container } = render(<GameStage {...props({ phase })} />);
      expect(container.innerHTML).toBe("");
      cleanup();
    }
  });

  it("renders nothing when there is no current question to show", () => {
    const { container } = render(<GameStage {...props({ question: null })} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders host pacing controls passed in from the page", () => {
    render(
      <GameStage
        {...props({ ...asHostOnly, controls: <button type="button">Next question</button> })}
      />,
    );
    expect(screen.getByRole("button", { name: "Next question" })).toBeTruthy();
  });

  it("renders the controls slot during review too", () => {
    render(
      <GameStage
        {...props({
          ...asHostOnly,
          phase: { phase: "review", voided: false },
          controls: <button type="button">Finish game</button>,
        })}
      />,
    );
    expect(screen.getByRole("button", { name: "Finish game" })).toBeTruthy();
  });
});
