// U4 / R1 / R2 / KTD3. The *confirmation* half of answer-anchored dedup.
//
// The answer anchor (U2) narrows a candidate to the handful of banked questions
// sharing its correct answer. This decides whether one of those is actually the
// same question reworded — "What is the capital of France?" vs "Which city is
// France's capital?" — or a genuinely different question that happens to land on
// the same answer, which R2 says we must keep.
//
// Deliberately lexical and deterministic, not embedding-based (KTD3): no new
// infrastructure, no per-generation API cost, no pgvector — and, decisively, it
// is unit-testable offline against a fixture table, which an embedding call is
// not. The threshold below is the entire behavior of this unit, and it can only
// be tuned if it can be tested.

import { normalizePrompt } from "./dedup";

/**
 * Similarity at or above this is "the same question reworded". Below it, two
 * questions sharing an answer are both kept (R2).
 *
 * Calibrated against the plan's acceptance examples, which bracket the decision
 * from both sides. Against a banked "What is the capital of France?":
 *   - "Which city is France's capital?" scores 0.8 — a rewording, must reject (AE1).
 *   - "Which city hosts the Louvre?"    scores 0.0 — a real question, must keep (AE2).
 * 0.6 sits well clear of both, so neither case is decided by a rounding error.
 *
 * Raising it lets more near-duplicates through; lowering it starts rejecting
 * legitimate same-answer questions and burns the generation attempt budget.
 * Retune against real bank data, not intuition — every test below pins
 * *behavior* at the chosen value rather than the number itself.
 */
export const NEAR_DUPLICATE_THRESHOLD = 0.6;

/**
 * Words carrying no topical signal. Trivia prompts are dense with interrogative
 * scaffolding ("what is the ... of ...") that is identical across completely
 * unrelated questions, which drags every pair toward a middling score and
 * leaves no threshold that separates them.
 *
 * Removing it is what makes the decision crisp: on the AE1/AE2 pair the scores
 * move from 0.50 vs 0.18 (barely separable) to 0.80 vs 0.00.
 */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "did", "do", "does", "for",
  "from", "had", "has", "have", "how", "in", "is", "it", "its", "many", "much",
  "of", "on", "or", "s", "that", "the", "these", "this", "to", "was", "were",
  "what", "when", "where", "which", "who", "whom", "whose", "why", "with",
]);

/**
 * Content tokens of a prompt: normalized, split, stop-words dropped.
 *
 * Falls back to the full token set when stripping would leave nothing — a
 * prompt made entirely of common words still deserves a real comparison rather
 * than an empty-set score of 0 that would wave every duplicate through.
 */
export function contentTokens(prompt: string): Set<string> {
  const all = normalizePrompt(prompt).split(" ").filter(Boolean);
  const content = all.filter((t) => !STOP_WORDS.has(t));
  return new Set(content.length > 0 ? content : all);
}

/**
 * Sørensen–Dice coefficient over the two prompts' content-token sets:
 * `2 * shared / (sizeA + sizeB)`. Returns 0 through 1.
 *
 * Set-based rather than bag-based, so a repeated word can't inflate a match.
 * Symmetric by construction, which matters because nothing guarantees which of
 * a candidate/banked pair is passed first.
 */
export function promptSimilarity(a: string, b: string): number {
  const tokensA = contentTokens(a);
  const tokensB = contentTokens(b);
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let shared = 0;
  // Iterate the smaller set — the intersection is the hot path when a candidate
  // has several banked questions under its answer.
  const [small, large] = tokensA.size <= tokensB.size ? [tokensA, tokensB] : [tokensB, tokensA];
  for (const token of small) {
    if (large.has(token)) shared++;
  }

  return (2 * shared) / (tokensA.size + tokensB.size);
}

/**
 * Whether `candidate` is a reworded duplicate of any prompt in `bankedPrompts`.
 *
 * `bankedPrompts` is expected to be pre-narrowed by the answer anchor (U2/U3) —
 * it is almost always empty, which is what keeps this comparison cheap despite
 * being O(candidates x banked).
 */
export function isNearDuplicate(
  candidate: string,
  bankedPrompts: readonly string[],
  threshold: number = NEAR_DUPLICATE_THRESHOLD,
): boolean {
  return bankedPrompts.some((banked) => promptSimilarity(candidate, banked) >= threshold);
}
