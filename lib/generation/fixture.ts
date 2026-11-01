import "server-only";
import type { GeneratedQuestion, GenerationParams } from "./schema";

/** Never infer test mode from CI, a request, or a public environment variable. */
export function fixtureGenerationEnabled(): boolean {
  return process.env.GENERATION_MODE === "fixture" &&
    (process.env.NODE_ENV !== "production" || process.env.E2E_TEST_MODE === "1");
}

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const TEENS = ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
function numberWords(n: number): string {
  if (n < 10) return ONES[n]!;
  if (n < 20) return TEENS[n - 10]!;
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
}

/** Fixed order/options; no shuffle, bank exclusions, provider calls or secrets.
 * Numbers 0–99 give 100 distinct answers that satisfy the typed-answer schema. */
export function fixtureQuestions(params: GenerationParams): GeneratedQuestion[] {
  if (!Number.isInteger(params.count) || params.count < 1 || params.count > 100) {
    throw new Error("Fixture question count must be between 1 and 100");
  }
  return Array.from({ length: params.count }, (_, index) => ({
    prompt: `Fixture ${index + 1}: spell the number ${index}.`,
    mode: params.mode,
    difficulty: params.difficulty,
    ...(params.mode === "multiple_choice"
      ? { options: [numberWords(index), "wrong", "other", "neither"], correct_option: 0 }
      : { accepted_variants: [numberWords(index)] }),
  }));
}
