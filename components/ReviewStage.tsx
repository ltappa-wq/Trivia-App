"use client";
// U6 / R5. The between-question review, rendered identically for host and player.
//
// The correct answer and the voided notice are the same for everyone. The
// per-option answer distribution stays host-only: it is shared-screen content
// that shows how the room voted, and it is already exposed to the host through a
// phase-gated RPC that players do not call.

import { AnswerReveal } from "@/components/AnswerReveal";
import { AnswerDistribution } from "@/components/AnswerDistribution";
import { ChallengeActions } from "@/components/ChallengeActions";
import type { ChallengeKind } from "@/lib/challenge";
import type {
  AnswerDistribution as AnswerDistributionData,
  RevealedAnswer,
} from "@/lib/db/types";

export interface ReviewStageProps {
  voided: boolean;
  reveal: RevealedAnswer | null;
  /** Host-only; null for players and for hosts before the RPC resolves. */
  distribution: AnswerDistributionData | null;
  isHost: boolean;
  /** Anyone holding a player credential may challenge — including a host who plays. */
  canChallenge: boolean;
  challenging: boolean;
  challengeError: string | null;
  /** Offer the "wrongly marked" variant only to someone whose answer was graded wrong. */
  showAnswerDispute: boolean;
  onChallenge: (type: ChallengeKind) => void;
}

export function ReviewStage({
  voided,
  reveal,
  distribution,
  isHost,
  canChallenge,
  challenging,
  challengeError,
  showAnswerDispute,
  onChallenge,
}: ReviewStageProps) {
  return (
    <>
      {voided ? (
        <p className="overlay" aria-live="assertive">
          This question was voided — it doesn’t count.
        </p>
      ) : (
        <p className="overlay" aria-live="polite">
          ⏱ Answers locked — here’s the correct answer.
        </p>
      )}

      <AnswerReveal reveal={reveal} />
      {isHost && <AnswerDistribution dist={distribution} />}

      {canChallenge && (
        <ChallengeActions
          challenging={challenging}
          challengeError={challengeError}
          showAnswerDispute={showAnswerDispute}
          onChallenge={onChallenge}
        />
      )}
    </>
  );
}
