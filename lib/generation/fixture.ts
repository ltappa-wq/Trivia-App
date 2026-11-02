import "server-only";
import { mixedModeAt } from "./mix";
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
  if (n >= 100) return n === 100 ? "hundred" : `hundred ${numberWords(n - 100)}`;
  if (n < 10) return ONES[n]!;
  if (n < 20) return TEENS[n - 10]!;
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
}

/** Fixed order/options; no shuffle, bank exclusions, provider calls or secrets.
 * Numbers 0–99 give 100 distinct answers that satisfy the typed-answer schema. */
export function fixtureQuestions(params: GenerationParams, offset = 0): GeneratedQuestion[] {
  if (!Number.isInteger(params.count) || params.count < 1 || params.count > 100) {
    throw new Error("Fixture question count must be between 1 and 100");
  }
  return Array.from({ length: params.count }, (_, position) => {
    const index = position + offset;
    const mode = params.mode === "mixed" ? mixedModeAt(index) : params.mode;
    if (mode === "true_false") return {
      prompt: `Fixture ${index + 1}: ${index} is an even number.`,
      mode, options: ["True", "False"], correct_option: index % 2,
      explanation: `${index} is ${index % 2 ? "odd" : "even"}.`, difficulty: params.difficulty,
    };
    return {
      prompt: `Fixture ${index + 1}: spell the number ${index}.`,
      explanation: `The number ${index} is written as ${numberWords(index)} in English.`,
      mode,
      difficulty: params.difficulty,
      ...(mode === "multiple_choice"
        ? { options: [numberWords(index), "wrong", "other", "neither"], correct_option: 0 }
        : { accepted_variants: [numberWords(index)] }),
    };
  });
}

/** One deterministic flagged candidate, then safe tail replacements through xai.ts. */
export function fixtureSafetyFetch(params: GenerationParams, offset = 0): typeof fetch {
  let next = offset;
  let flagged = false;
  return (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    let output: unknown;
    if (body.response_format?.type === "json_schema") {
      const batch = JSON.parse(body.messages[1].content) as { prompt: string }[];
      output = { verdicts: batch.map((q, index) => ({ index, safe: !q.prompt.startsWith("Fixture flagged:") })) };
    } else {
      const prompt = body.messages[1].content as string;
      const mode = prompt.includes('"answer" boolean') ? "true_false" : prompt.includes('"options" array') ? "multiple_choice" : "type_answer";
      const requested = Number(/Generate exactly (\d+)/.exec(prompt)![1]);
      const count = Math.min(requested, params.count);
      const questions = fixtureQuestions({ ...params, mode, count }, next).map(q =>
        q.mode === "true_false" ? { ...q, answer: q.correct_option === 0 } : q);
      next += count;
      if (!flagged) { questions[0] = { ...questions[0]!, prompt: "Fixture flagged: adult-only topic placeholder" }; flagged = true; }
      output = { questions };
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }), { status: 200 });
  }) as typeof fetch;
}
