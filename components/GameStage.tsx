"use client";
// U6 / R5. The one implementation of live-game content, for both roles.
//
// `app/(host)/host/page.tsx` and `app/(play)/play/page.tsx` keep their own
// shells — the host its room header, roster, pacing buttons and adjudication
// panel; the player its identity header and waiting state — and both delegate
// everything between get-ready and review to this component. Role differences
// are conditional affordances *inside* the shared stage, never parallel view
// trees, which is what stops the two from drifting apart again.
//
// Pacing authority deliberately stays on the host page and arrives here as the
// `controls` slot: deciding when to advance is not presentation.

import type { ReactNode } from "react";
import { GetReady } from "@/components/GetReady";
import { ChallengeActions } from "@/components/ChallengeActions";
import { QuestionStage } from "@/components/QuestionStage";
import { ReviewStage } from "@/components/ReviewStage";
import type { GamePhase } from "@/lib/gamePhase";
import type { ChallengeKind } from "@/lib/challenge";
import type { SubmitResult } from "@/app/actions/submitAnswer";
import type {
  AnswerDistribution as AnswerDistributionData,
  ClientQuestion,
  RevealedAnswer,
} from "@/lib/db/types";

export interface GameStageProps {
  phase: GamePhase;
  question: ClientQuestion | null;
  currentIndex: number;
  revealAt: string | null;
  /** Clock offset (serverNow - clientNow) for the server-anchored 3-2-1. */
  offset: number;
  remaining: number | null;
  isHost: boolean;
  spectating: boolean;
  playerToken: string | null;
  reveal: RevealedAnswer | null;
  distribution: AnswerDistributionData | null;
  challenging: boolean;
  challengeError: string | null;
  showAnswerDispute: boolean;
  onChallenge: (type: ChallengeKind) => void;
  onResult?: (result: SubmitResult | null) => void;
  /** Host pacing controls (Next question / Finish game), rendered under the stage. */
  controls?: ReactNode;
}

export function GameStage({
  phase,
  question,
  currentIndex,
  revealAt,
  offset,
  remaining,
  isHost,
  spectating,
  playerToken,
  reveal,
  distribution,
  challenging,
  challengeError,
  showAnswerDispute,
  onChallenge,
  onResult,
  controls,
}: GameStageProps) {
  // lobby and ended are the pages' own territory: the host shows a roster and
  // share link, the player a waiting state, and both render GameOver at the end.
  if (phase.phase === "lobby" || phase.phase === "ended") return null;

  if (phase.phase === "get_ready") {
    if (!revealAt) return null;
    return (
      <section className="stage" aria-live="polite">
        <GetReady revealAt={revealAt} offset={offset} />
      </section>
    );
  }

  // Every remaining phase renders the current question; without one there is
  // nothing to show but the page shell.
  if (!question) return null;

  if (phase.phase === "review") {
    return (
      <section className="stage stage--review" aria-live="polite">
        <ReviewStage
          voided={phase.voided}
          reveal={reveal}
          distribution={distribution}
          isHost={isHost}
          // A spectator has no stake in this question and nothing to dispute.
          canChallenge={playerToken !== null && !spectating}
          challenging={challenging}
          challengeError={challengeError}
          showAnswerDispute={showAnswerDispute}
          onChallenge={onChallenge}
        />
        {controls}
      </section>
    );
  }

  const paused = phase.phase === "paused";
  // The paused phase carries no voided flag of its own (it is not a question
  // phase), but the question still knows whether it was voided.
  const voided = paused ? question.voided : phase.voided;

  return (
    <section className="stage" aria-live="polite">
      <QuestionStage
        question={question}
        currentIndex={currentIndex}
        remaining={remaining}
        voided={voided}
        paused={paused}
        spectating={spectating}
        playerToken={playerToken}
        onResult={onResult}
      />
      {/* Live-phase challenges stay open while a question is answerable. */}
      {!paused && !voided && !spectating && playerToken !== null && (
        <ChallengeActions
          challenging={challenging}
          challengeError={challengeError}
          showAnswerDispute={showAnswerDispute}
          onChallenge={onChallenge}
        />
      )}
      {controls}
    </section>
  );
}
