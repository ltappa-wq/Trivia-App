// U5 / R5. The single authority on what the room is currently showing.
//
// Host and player each computed this inline, from the same five fields, and had
// already drifted apart: the player handled voided questions and spectators, the
// host did not; they gated the get-ready window on different conditions. Every
// future change to the live loop had to be made twice. This is the function that
// makes that impossible — both views derive their phase here and render the same
// stage from it.
//
// Deliberately separate from lib/gameFlow.ts, which answers "what should the
// host do next" (isLastIndex, shouldAutoClose). That is pacing authority; this
// is presentation. Mixing them is how the two views drifted in the first place.

import type { ClientGame, ClientQuestion } from "@/lib/db/types";
import { isGetReadyPhase } from "@/lib/realtime/clock";

/** The game fields that determine the phase. */
export type PhaseGame = Pick<
  ClientGame,
  "status" | "current_index" | "reveal_at" | "paused" | "reviewing"
>;

/** The question fields that modify (but never determine) the phase. */
export type PhaseQuestion = Pick<ClientQuestion, "voided">;

export type PhaseName = "lobby" | "get_ready" | "question" | "review" | "paused" | "ended";

/**
 * `voided` rides on the question and review phases rather than being a phase of
 * its own: a voided question changes what the stage *says*, not which stage is
 * active — the countdown, the leaderboard and the host's pacing controls all
 * still belong on screen.
 */
export type GamePhase =
  | { phase: "lobby" }
  | { phase: "get_ready" }
  | { phase: "question"; voided: boolean }
  | { phase: "review"; voided: boolean }
  | { phase: "paused" }
  | { phase: "ended" };

/**
 * What the room is showing right now.
 *
 * Precedence, highest first — this order is the contract, and each step exists
 * because something outranks it:
 *
 * 1. `ended` — terminal, and R6 requires every participant to reach the end
 *    screen. It outranks even `lobby`: a game ended before it started must show
 *    results, not strand players on a waiting state.
 * 2. `lobby` — nothing has been revealed yet, so no timing field means anything.
 * 3. `paused` — a raised challenge freezes the room over whatever it was doing,
 *    question or review alike.
 * 4. `review` — answers are locked. Checked before the clock because the
 *    all-answered path enters review while the countdown is still running.
 * 5. `get_ready` / `question` — split on the offset-corrected reveal time.
 *
 * `offsetMs` is serverNow - clientNow (see lib/realtime/clock.ts): devices have
 * skewed clocks and the reveal boundary is server-authoritative, so this must
 * not be evaluated against a bare local clock.
 */
export function derivePhase(
  game: PhaseGame,
  question: PhaseQuestion | null = null,
  offsetMs: number = 0,
  now: number = Date.now(),
): GamePhase {
  if (game.status === "ended") return { phase: "ended" };
  if (game.current_index < 0) return { phase: "lobby" };
  if (game.paused) return { phase: "paused" };

  const voided = question?.voided ?? false;
  if (game.reviewing) return { phase: "review", voided };
  if (isGetReadyPhase(game.reveal_at, offsetMs, now)) return { phase: "get_ready" };
  return { phase: "question", voided };
}
