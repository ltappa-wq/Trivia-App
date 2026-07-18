// U3. Generation schema + validators (R3, R4, R16, KTD5).
// The xAI response is untrusted structured JSON; these validators are the gate
// that keeps a malformed or constraint-violating question out of Postgres.
// Answer-key columns generated here are judged server-side (U7) and never sent
// to clients (the hydrate RPC omits them, U2).

import { randomInt } from "node:crypto";
import type { AnswerMode, Difficulty } from "@/lib/db/types";
import { normalizeAnswer } from "./dedup";

export interface GenerationParams {
  categories: string[];
  count: number;
  mode: AnswerMode;
  difficulty: Difficulty;
}

export interface GeneratedQuestion {
  prompt: string;
  mode: AnswerMode;
  /** multiple_choice only: the ordered option list. */
  options?: string[];
  /** multiple_choice only: 0-based index of the correct option. */
  correct_option?: number;
  /** type_answer only: accepted answer variants for fuzzy judging (R4). */
  accepted_variants?: string[];
  difficulty: Difficulty;
}

// Tuning constants for the type-the-answer word constraint (R3). Kept here so
// generation and any future judging normalization agree on what "easy" means.
export const MAX_ANSWER_WORDS = 2;
export const MAX_WORD_LENGTH = 12;
// A correct option plus at least two distractors.
export const MIN_MC_OPTIONS = 3;
export const MAX_MC_OPTIONS = 6;

/**
 * R3: a type-the-answer variant must be one or two common, easy-to-spell words.
 * "Easy to spell" is operationalized as short, purely alphabetic tokens so the
 * fuzzy matcher (U7) can rely on instant normalized matching without AI grading.
 */
export function isEasyTypeAnswer(answer: string): boolean {
  if (typeof answer !== "string") return false;
  const words = answer.trim().split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > MAX_ANSWER_WORDS) return false;
  return words.every(
    (w) => /^[a-zA-Z]+$/.test(w) && w.length <= MAX_WORD_LENGTH,
  );
}

export type ValidationResult =
  | { ok: true; question: GeneratedQuestion }
  | { ok: false; reason: string };

/**
 * Validate a single model-produced question for the requested mode. Mode and
 * difficulty are normalized to the requested values so a game always records
 * the gamemaster's chosen calibration (R16) regardless of what the model echoed.
 */
export function validateGeneratedQuestion(
  raw: unknown,
  params: Pick<GenerationParams, "mode" | "difficulty">,
): ValidationResult {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, reason: "not an object" };
  }
  const q = raw as Record<string, unknown>;
  if (typeof q.prompt !== "string" || q.prompt.trim().length === 0) {
    return { ok: false, reason: "missing prompt" };
  }

  if (params.mode === "multiple_choice") {
    const options = q.options;
    if (
      !Array.isArray(options) ||
      options.length < MIN_MC_OPTIONS ||
      options.length > MAX_MC_OPTIONS ||
      !options.every((o) => typeof o === "string" && o.trim().length > 0)
    ) {
      return { ok: false, reason: "invalid options" };
    }
    const correct = q.correct_option;
    if (
      typeof correct !== "number" ||
      !Number.isInteger(correct) ||
      correct < 0 ||
      correct >= options.length
    ) {
      return { ok: false, reason: "invalid correct_option" };
    }
    // Models strongly bias correct_option toward 0 ("always A"). Shuffle after
    // validation so the correct answer is uniformly distributed across slots.
    const shuffled = shuffleMcOptions({
      prompt: q.prompt.trim(),
      mode: "multiple_choice",
      options: (options as string[]).map((o) => o.trim()),
      correct_option: correct,
      difficulty: params.difficulty,
    });
    return { ok: true, question: shuffled };
  }

  // type_answer
  const variants = q.accepted_variants;
  if (
    !Array.isArray(variants) ||
    variants.length === 0 ||
    !variants.every((v) => typeof v === "string")
  ) {
    return { ok: false, reason: "missing accepted_variants" };
  }
  if (!variants.every((v) => isEasyTypeAnswer(v as string))) {
    // R3 violation: an answer exceeding two words or not easy-to-spell. Reject
    // so the generator regenerates rather than persisting an unjudgeable answer.
    return { ok: false, reason: "answer violates one-or-two-easy-words rule" };
  }
  return {
    ok: true,
    question: {
      prompt: q.prompt.trim(),
      mode: "type_answer",
      accepted_variants: (variants as string[]).map((v) => v.trim()),
      difficulty: params.difficulty,
    },
  };
}

/**
 * Extract a question array from a parsed xAI JSON payload. Accepts either a bare
 * array or a `{ questions: [...] }` object (JSON-object response mode).
 */
export function extractQuestionArray(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    Array.isArray((parsed as Record<string, unknown>).questions)
  ) {
    return (parsed as { questions: unknown[] }).questions;
  }
  return [];
}

/**
 * Normalized correct-answer keys for a generated question (primary MC option
 * text, or every type-answer accepted variant). Empty when the shape is incomplete.
 */
export function correctAnswerKeys(question: GeneratedQuestion): string[] {
  if (
    question.mode === "multiple_choice" &&
    question.options &&
    question.correct_option !== undefined &&
    question.correct_option >= 0 &&
    question.correct_option < question.options.length
  ) {
    const key = normalizeAnswer(question.options[question.correct_option]!);
    return key ? [key] : [];
  }
  if (question.mode === "type_answer" && question.accepted_variants?.length) {
    return [
      ...new Set(
        question.accepted_variants.map((v) => normalizeAnswer(v)).filter(Boolean),
      ),
    ];
  }
  return [];
}

/**
 * Fisher–Yates shuffle of multiple-choice options, updating correct_option so
 * it still points at the same answer text. Injectable `rand` for tests.
 */
export function shuffleMcOptions(
  question: GeneratedQuestion,
  rand: (maxExclusive: number) => number = (n) => randomInt(n),
): GeneratedQuestion {
  if (
    question.mode !== "multiple_choice" ||
    !question.options ||
    question.correct_option === undefined ||
    question.correct_option < 0 ||
    question.correct_option >= question.options.length
  ) {
    return question;
  }
  const options = [...question.options];
  const correctText = options[question.correct_option]!;
  for (let i = options.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    const tmp = options[i]!;
    options[i] = options[j]!;
    options[j] = tmp;
  }
  return {
    ...question,
    options,
    correct_option: options.indexOf(correctText),
  };
}
