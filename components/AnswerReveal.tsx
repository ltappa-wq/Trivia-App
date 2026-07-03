"use client";
// R1. Review-phase correct-answer reveal, shared by the player and host review
// screens. Presentational only: the caller fetches the gated reveal_answer RPC
// (channel.revealAnswer) once the room is reviewing and passes the raw shape;
// formatting lives in the pure lib/reviewAnswer helper so it is unit-tested.

import { formatAnswerKey } from "@/lib/reviewAnswer";
import type { RevealedAnswer } from "@/lib/db/types";

export function AnswerReveal({ reveal }: { reveal: RevealedAnswer | null }) {
  if (!reveal) return null;
  return (
    <div className="answer-reveal" aria-live="polite">
      <p>
        <strong>Correct answer:</strong> {formatAnswerKey(reveal)}
      </p>
      {reveal.correction && <p className="answer-correction">{reveal.correction}</p>}
    </div>
  );
}
