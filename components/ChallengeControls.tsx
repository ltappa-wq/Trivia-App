"use client";
// U8. Shared challenge affordance, used by both the play view and (now that the
// host can play too) the host view. Raising a challenge pauses the game for
// everyone and drops the host into adjudication. The acting player is resolved
// server-side from `token` (a player token, KTD7) — for a playing host that is
// their host-seat player token. "My answer was wrongly marked" only appears once
// the player has answered and been marked wrong (markedWrong).

import { useState } from "react";
import { challenge } from "@/app/actions/challenge";
import type { ChallengeKind } from "@/lib/challenge";

export function ChallengeControls({
  token,
  markedWrong,
}: {
  token: string;
  markedWrong: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function raise(type: ChallengeKind) {
    setBusy(true);
    setError(null);
    try {
      await challenge(token, type);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not challenge");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {error && <p role="alert">{error}</p>}
      <button
        type="button"
        className="ghost"
        disabled={busy}
        onClick={() => raise("question")}
      >
        Challenge this question
      </button>
      {markedWrong && (
        <button
          type="button"
          className="ghost"
          disabled={busy}
          onClick={() => raise("answer")}
        >
          My answer was wrongly marked
        </button>
      )}
    </div>
  );
}
