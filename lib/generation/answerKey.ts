// U2 / R1 / R3 / KTD2. The *anchor* half of answer-anchored duplicate detection.
//
// Near-duplicate questions almost always share a correct answer, so the answer
// is a cheap, high-precision first filter: index it, look candidates up by it,
// and only then pay for the expensive prompt-similarity comparison (U4). That
// candidate set is nearly always empty, which is the whole point.
//
// Distinct from `correctAnswerKeys` in ./schema: that returns *every* key a
// question answers to (all type-answer variants) and enforces the within-set
// "no two questions share a winner" rule (R4). This returns the *one* canonical
// key a banked row is stored and matched under. One row, one anchor.

import type { AnswerMode } from "@/lib/db/types";
import { normalizeAnswer } from "./dedup";

/**
 * The shape needed to derive an answer key. Structural rather than tied to
 * `GeneratedQuestion` so bank rows and DB rows (which use `null` where the
 * generated shape uses `undefined`) work without conversion.
 */
export interface AnswerKeySource {
  mode: AnswerMode;
  options?: string[] | null;
  correct_option?: number | null;
  accepted_variants?: string[] | null;
}

/**
 * The canonical correct answer *text* for a question: the option at
 * `correct_option` for multiple choice, the first accepted variant (the primary
 * answer) for type-answer.
 *
 * Returns null when the shape can't yield one — a `correct_option` out of range,
 * a missing option list, an empty variant array. Null is deliberate: a malformed
 * row must produce *no* key rather than a bogus one, because a key like `""`
 * would anchor against every other malformed row and manufacture duplicates.
 */
export function answerKey(question: AnswerKeySource): string | null {
  if (question.mode === "multiple_choice") {
    const options = question.options;
    const index = question.correct_option;
    if (
      !Array.isArray(options) ||
      typeof index !== "number" ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= options.length
    ) {
      return null;
    }
    const text = options[index];
    return typeof text === "string" && text.trim() ? text : null;
  }

  const primary = question.accepted_variants?.[0];
  return typeof primary === "string" && primary.trim() ? primary : null;
}

/**
 * The stored/queried form of {@link answerKey} — what lands in
 * `question_bank.answer_norm` and what U4 looks candidates up by. Normalization
 * is `normalizeAnswer` (itself `normalizePrompt`), so the answer anchor and the
 * prompt key collapse casing, punctuation and whitespace identically; a key
 * written on one code path always matches a key read on another.
 *
 * Null propagates from {@link answerKey}, and also covers text that normalizes
 * away to nothing (e.g. an answer of only punctuation).
 */
export function normalizedAnswerKey(question: AnswerKeySource): string | null {
  const raw = answerKey(question);
  if (raw === null) return null;
  return normalizeAnswer(raw) || null;
}
