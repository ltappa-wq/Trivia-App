// U7. Answer judging (R9). Multiple choice is an exact option-index match. Type-
// the-answer is a normalized + bounded-edit-distance fuzzy match against the
// question's accepted variants (U2/U3) — instant, no per-answer AI grading,
// which the one-or-two-easy-words generation constraint (R3) makes reliable.
// Thresholds are tunable; behavior is pinned by the scenarios, not magic numbers.

/** Lowercase, strip accents and punctuation, collapse whitespace. */
export function normalize(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Edit distance between a and b, short-circuiting once it exceeds `max`. */
export function boundedLevenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      curr.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1; // whole row already over budget
    prev = curr;
  }
  return prev[b.length];
}

/**
 * Fuzz budget for a word of length `len`: exact-only for short words (so cat/bat
 * don't collide), one typo for mid-length, two for long. Keeps the near-miss
 * (kenedy→kennedy, AE1) matching without turning distinct short answers into
 * false positives.
 */
export function allowedEdits(len: number): number {
  if (len <= 4) return 0;
  if (len <= 8) return 1;
  return 2;
}

export function judgeMultipleChoice(
  selectedOption: number,
  correctOption: number,
): boolean {
  return Number.isInteger(selectedOption) && selectedOption === correctOption;
}

export function judgeTypeAnswer(raw: string, acceptedVariants: string[]): boolean {
  const answer = normalize(raw);
  if (answer.length === 0) return false;
  for (const variant of acceptedVariants) {
    const target = normalize(variant);
    if (answer === target) return true;
    const budget = allowedEdits(target.length);
    if (budget > 0 && boundedLevenshtein(answer, target, budget) <= budget) {
      return true;
    }
  }
  return false;
}
