// R1. Review-phase answer reveal — client-side formatting.
// The reveal_answer RPC (migration 0007) returns the raw grading columns for the
// current question once the room is reviewing/ended. This turns that shape into a
// display string, mirroring the host adjudication panel's answer-key formatting.
// Pure so it is unit-tested here rather than through the (untested) UI.

import type { RevealedAnswer } from "@/lib/db/types";

/**
 * Human-readable correct answer for a revealed question. Multiple-choice yields
 * the correct option's text; type-answer yields the accepted variant(s). Returns
 * an em dash when the key is missing or malformed so the review screen never
 * throws on unexpected data.
 */
export function formatAnswerKey(reveal: RevealedAnswer | null): string {
  if (!reveal) return "—";

  if (reveal.mode === "multiple_choice") {
    const options = reveal.options ?? [];
    const idx = reveal.correct_option ?? -1;
    return options[idx] ?? "—";
  }

  const variants = (reveal.accepted_variants ?? []).filter((v) => v.length > 0);
  return variants.length > 0 ? variants.join(", ") : "—";
}
