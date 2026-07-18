// U4 / R7 / KTD4. Question de-duplication key.
// A durable, cross-game question bank prevents repeats (R7). Matching is by
// normalized prompt text: case-insensitive, punctuation-stripped, whitespace-
// collapsed exact match — cheap and deterministic, no embeddings (R7.2). Both
// the pre-generation exclusion set and the bank's unique index use this key, so
// "already asked" means the same thing on read and on write.

/**
 * Canonical form of a prompt for duplicate detection. Lowercases, removes
 * anything that isn't a letter, number, or space, and collapses runs of
 * whitespace so cosmetic differences (case, trailing "?", double spaces) don't
 * defeat the match. Unicode letters/numbers are preserved.
 */
export function normalizePrompt(prompt: string): string {
  return prompt
    .toLowerCase()
    // Punctuation becomes a space (not removed) so "co-operate" and "cooperate"
    // stay distinct rather than colliding into one banked entry.
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Canonical key for a question's *correct answer* text. Used to prevent the
 * same fact/answer from winning multiple questions in one set (e.g. "Paris"
 * as the answer to two different prompts).
 */
export function normalizeAnswer(answer: string): string {
  return normalizePrompt(answer);
}
