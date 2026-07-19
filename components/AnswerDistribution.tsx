"use client";
// R5. Review-phase answer-distribution bars for the host screen. Presentational
// only: the caller fetches the phase-gated answer_distribution RPC once the room
// is reviewing and passes the raw shape. Shows one bar per multiple-choice option
// with the share that picked it, the correct option marked. Renders nothing for
// type-answer (free text has no per-option distribution) or before any answers.

import { TILE_SHAPES } from "@/lib/answerShapes";
import type { AnswerDistribution as Distribution } from "@/lib/db/types";
import { formatNumber } from "@/lib/formatScore";

export function AnswerDistribution({ dist }: { dist: Distribution | null }) {
  if (!dist || dist.mode !== "multiple_choice" || !dist.counts || !dist.options) {
    return null;
  }
  const total = dist.total;

  return (
    <div className="answer-dist" aria-label="Answer distribution">
      {dist.options.map((opt, i) => {
        const count = dist.counts?.[i] ?? 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const isCorrect = i === dist.correct_option;
        return (
          <div key={i} className={`answer-dist__row${isCorrect ? " is-correct" : ""}`}>
            <span className="answer-dist__label">
              <span className="answer-tile__shape" aria-hidden="true">
                {TILE_SHAPES[i % TILE_SHAPES.length]}
              </span>
              {opt}
              {isCorrect && <span aria-hidden="true"> ✅</span>}
            </span>
            <span className="answer-dist__track">
              <span className="answer-dist__bar" style={{ width: `${pct}%` }} />
            </span>
            <span className="answer-dist__count">
              {formatNumber(count)} · {pct}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
