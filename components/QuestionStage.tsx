"use client";
// U6 / R5. The live question, rendered identically for host and player.
//
// Both pages used to build this themselves and had already drifted: the player
// handled voided questions and spectators, the host handled neither; the host
// showed a read-only option list only for multiple choice, so a type-answer
// question left the shared screen visibly emptier than every phone in the room.
// Role now decides which *affordances* appear, never what the question looks
// like.

import { ANSWER_TIMER_MS } from "@/lib/gameConfig";
import { AnswerPanel } from "@/components/AnswerPanel";
import { Countdown } from "@/components/Countdown";
import type { SubmitResult } from "@/app/actions/submitAnswer";
import type { ClientQuestion } from "@/lib/db/types";

export interface QuestionStageProps {
  question: ClientQuestion;
  currentIndex: number;
  /** Null while the countdown has not been computed yet; 0 once time is up. */
  remaining: number | null;
  voided: boolean;
  /** The room is frozen on a raised challenge — answering is closed. */
  paused: boolean;
  /** Joined mid-game: watches this question, plays from the next one. */
  spectating: boolean;
  /**
   * A player credential. Present for every player and for a host who chose to
   * play; absent for a host-only gamemaster, who sees the question read-only.
   */
  playerToken: string | null;
  onResult?: (result: SubmitResult | null) => void;
}

export function QuestionStage({
  question,
  currentIndex,
  remaining,
  voided,
  paused,
  spectating,
  playerToken,
  onResult,
}: QuestionStageProps) {
  const timeUp = remaining !== null && remaining <= 0;
  // Precedence matches derivePhase's spirit: a voided question is moot for
  // everyone, a spectator has no answer to give, and a paused room takes no
  // answers at all. Only past all three does anyone get an input.
  const canAnswer = !voided && !spectating && !paused && playerToken !== null;

  return (
    <>
      <h2>{question.prompt}</h2>
      {remaining !== null && (
        <Countdown remaining={remaining} total={ANSWER_TIMER_MS[question.mode]} />
      )}

      {voided ? (
        <p className="overlay" aria-live="assertive">
          This question was voided — waiting for the host.
        </p>
      ) : paused ? (
        <p className="overlay" aria-live="assertive">
          ⏸ Paused for review — answering is disabled.
        </p>
      ) : spectating ? (
        <p className="overlay" aria-live="polite">
          You joined mid-game — sitting out this question. You’ll play from the next one.
        </p>
      ) : canAnswer ? (
        <AnswerPanel
          token={playerToken}
          question={question}
          currentIndex={currentIndex}
          timeUp={timeUp}
          onResult={onResult}
        />
      ) : (
        // Host-only gamemaster. Multiple choice lists the options so the shared
        // screen shows what players are choosing between; type-answer has
        // nothing to list, and the prompt plus countdown above is the whole
        // question — which is exactly what the phones show too.
        question.mode === "multiple_choice" && (
          <ol className="stage-options">
            {(question.options ?? []).map((opt, i) => (
              <li key={i}>{opt}</li>
            ))}
          </ol>
        )
      )}
    </>
  );
}
