import { describe, expect, it } from "vitest";
import { derivePhase, type PhaseGame } from "../gamePhase";

// U5 / R5. The single authority on what the room is showing. Host and player
// each derived this inline and disagreed — on voided handling, on spectators, on
// when the get-ready window closes. Getting the *precedence* wrong here is the
// main regression risk in the parity work, so every ordering rule is pinned.

const NOW = 1_000_000;
const REVEAL_AT = new Date(NOW + 3_000).toISOString(); // 3s out: get-ready
const REVEALED_AT = new Date(NOW - 3_000).toISOString(); // 3s ago: answering

function game(over: Partial<PhaseGame> = {}): PhaseGame {
  return {
    status: over.status ?? "active",
    current_index: over.current_index ?? 0,
    reveal_at: over.reveal_at !== undefined ? over.reveal_at : REVEALED_AT,
    paused: over.paused ?? false,
    reviewing: over.reviewing ?? false,
  };
}

describe("derivePhase — lobby (U5, R5)", () => {
  it("yields lobby when the game has not started, whatever else is set", () => {
    expect(
      derivePhase(
        game({ current_index: -1, reveal_at: REVEAL_AT, paused: true, reviewing: true }),
        null,
        0,
        NOW,
      ).phase,
    ).toBe("lobby");
  });

  it("yields lobby for a lobby-status game", () => {
    expect(derivePhase(game({ status: "lobby", current_index: -1 }), null, 0, NOW).phase).toBe(
      "lobby",
    );
  });
});

describe("derivePhase — ended (U5, R6)", () => {
  it("yields ended even while paused or reviewing", () => {
    expect(
      derivePhase(game({ status: "ended", paused: true, reviewing: true }), null, 0, NOW).phase,
    ).toBe("ended");
  });

  it("yields ended even inside the get-ready window", () => {
    expect(
      derivePhase(game({ status: "ended", reveal_at: REVEAL_AT }), null, 0, NOW).phase,
    ).toBe("ended");
  });

  it("outranks lobby, so a game ended before it started still shows results", () => {
    // R6 is that every participant reaches the end screen. Reporting "lobby"
    // for an ended game would strand them on a waiting state forever.
    expect(
      derivePhase(game({ status: "ended", current_index: -1 }), null, 0, NOW).phase,
    ).toBe("ended");
  });
});

describe("derivePhase — paused (U5, R5)", () => {
  it("outranks an active question", () => {
    expect(derivePhase(game({ paused: true }), null, 0, NOW).phase).toBe("paused");
  });

  it("outranks reviewing", () => {
    expect(derivePhase(game({ paused: true, reviewing: true }), null, 0, NOW).phase).toBe(
      "paused",
    );
  });

  it("outranks the get-ready window", () => {
    expect(
      derivePhase(game({ paused: true, reveal_at: REVEAL_AT }), null, 0, NOW).phase,
    ).toBe("paused");
  });
});

describe("derivePhase — review (U5, R5)", () => {
  it("yields review when reviewing, even if the countdown has not elapsed", () => {
    // The all-answered path enters review early; the clock is irrelevant here.
    expect(
      derivePhase(game({ reviewing: true, reveal_at: REVEAL_AT }), null, 0, NOW).phase,
    ).toBe("review");
  });
});

describe("derivePhase — get_ready and question (U5, R5)", () => {
  it("yields get_ready before reveal_at", () => {
    expect(derivePhase(game({ reveal_at: REVEAL_AT }), null, 0, NOW).phase).toBe("get_ready");
  });

  it("yields question after reveal_at", () => {
    expect(derivePhase(game({ reveal_at: REVEALED_AT }), null, 0, NOW).phase).toBe("question");
  });

  it("yields question at the exact reveal instant", () => {
    const at = new Date(NOW).toISOString();
    expect(derivePhase(game({ reveal_at: at }), null, 0, NOW).phase).toBe("question");
  });

  it("yields question when a started game has no reveal_at at all", () => {
    expect(derivePhase(game({ reveal_at: null }), null, 0, NOW).phase).toBe("question");
  });

  it("shifts the get-ready boundary with a positive clock offset", () => {
    // Offset is serverNow - clientNow. A client running behind the server means
    // the reveal has already landed even though the local clock disagrees.
    expect(derivePhase(game({ reveal_at: REVEAL_AT }), null, 0, NOW).phase).toBe("get_ready");
    expect(derivePhase(game({ reveal_at: REVEAL_AT }), null, 5_000, NOW).phase).toBe("question");
  });

  it("shifts the get-ready boundary with a negative clock offset", () => {
    // A client running ahead of the server is still waiting for the reveal.
    expect(derivePhase(game({ reveal_at: REVEALED_AT }), null, 0, NOW).phase).toBe("question");
    expect(derivePhase(game({ reveal_at: REVEALED_AT }), null, -5_000, NOW).phase).toBe(
      "get_ready",
    );
  });
});

describe("derivePhase — voided is a modifier, not a phase (U5, R5)", () => {
  it("flags a voided question without changing the phase", () => {
    const phase = derivePhase(game(), { voided: true }, 0, NOW);
    expect(phase.phase).toBe("question");
    expect(phase).toMatchObject({ phase: "question", voided: true });
  });

  it("flags a voided question during review", () => {
    const phase = derivePhase(game({ reviewing: true }), { voided: true }, 0, NOW);
    expect(phase).toMatchObject({ phase: "review", voided: true });
  });

  it("reports voided false when the question is live", () => {
    expect(derivePhase(game(), { voided: false }, 0, NOW)).toMatchObject({ voided: false });
  });

  it("reports voided false when there is no current question", () => {
    expect(derivePhase(game(), null, 0, NOW)).toMatchObject({ voided: false });
  });
});
