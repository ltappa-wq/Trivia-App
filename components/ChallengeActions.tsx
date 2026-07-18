"use client";
// Shared challenge controls for review (and live) on player + host-as-player.

import type { ChallengeKind } from "@/lib/challenge";

export function ChallengeActions({
  challenging,
  challengeError,
  showAnswerDispute,
  onChallenge,
}: {
  challenging: boolean;
  challengeError: string | null;
  /** True when the player was marked wrong on this question. */
  showAnswerDispute: boolean;
  onChallenge: (type: ChallengeKind) => void;
}) {
  return (
    <div className="challenge-actions">
      {challengeError && <p role="alert">{challengeError}</p>}
      <p className="challenge-actions__hint">Think this question is unfair or wrong?</p>
      <button
        type="button"
        className="challenge-actions__primary"
        disabled={challenging}
        onClick={() => onChallenge("question")}
      >
        {challenging ? "Sending…" : "Challenge this question"}
      </button>
      {showAnswerDispute && (
        <button
          type="button"
          className="ghost"
          disabled={challenging}
          onClick={() => onChallenge("answer")}
        >
          My answer was wrongly marked
        </button>
      )}
    </div>
  );
}
