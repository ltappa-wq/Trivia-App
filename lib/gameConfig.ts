// Shared game configuration: the category seed list, question-count bounds, and
// setup-input validation. Consumed by the setup UI (U4), createGame (U4), and
// generation (U3). The category list is a static seed for v1 (Open Question:
// configurable set deferred).

import type { AnswerMode, Difficulty } from "@/lib/db/types";

export const CATEGORIES = [
  "General Knowledge",
  "History",
  "Science",
  "Geography",
  "Sports",
  "Movies & TV",
  "Music",
  "Art & Literature",
  "Technology",
  "Food & Drink",
] as const;

export const QUESTION_COUNT_MIN = 1;
// KTD10: whole-set generation runs in one server action, so the count is capped
// to a ceiling that fits Vercel's function-duration budget. Raising this is the
// trigger to move generation to a background route handler (Open Question).
export const QUESTION_COUNT_MAX = 20;

export const ANSWER_MODES: readonly AnswerMode[] = ["multiple_choice", "type_answer"];
export const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"];

/**
 * Per-mode answer window (R7): type-the-answer gets a longer timer because it is
 * inherently slower to answer, so it is not penalized versus multiple choice.
 * The countdown clients render (U6) and the speed score the server computes
 * (U7) both read these, so display and scoring stay in agreement. Tunable
 * constant — behavior is verified through the U7 scenarios, not hardcoded
 * assertions (Verification Contract).
 */
export const ANSWER_TIMER_MS: Record<AnswerMode, number> = {
  multiple_choice: 20_000,
  type_answer: 35_000,
};

/**
 * Between-question "get ready" lead-in (U6). When the host reveals a question,
 * the server stamps `reveal_at` this far in the future: clients show a brief
 * countdown and answering opens only once `reveal_at` passes. Because the whole
 * answer window is anchored to `reveal_at`, shifting it forward by the lead-in
 * shifts the timer and speed scoring with it — nobody is penalized for the
 * pause. Answering before `reveal_at` is rejected server-side (submitAnswer).
 */
export const LEAD_IN_MS = 3_000;

export interface SetupInput {
  categories: string[];
  questionCount: number;
  answerMode: AnswerMode;
  difficulty: Difficulty;
}

export type SetupValidation =
  | { ok: true; value: SetupInput }
  | { ok: false; error: string };

/**
 * Validate raw setup input before it reaches generation or the database.
 * Rejects an out-of-range count (KTD10 ceiling) and unknown categories/modes so
 * the abuse guard and the DB check constraints are never the first line of
 * defense.
 */
export function validateSetupInput(raw: unknown): SetupValidation {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "Invalid setup input" };
  }
  const r = raw as Record<string, unknown>;

  const categories = r.categories;
  if (
    !Array.isArray(categories) ||
    categories.length === 0 ||
    !categories.every((c) => (CATEGORIES as readonly string[]).includes(c as string))
  ) {
    return { ok: false, error: "Select at least one valid category" };
  }

  const questionCount = r.questionCount;
  if (
    typeof questionCount !== "number" ||
    !Number.isInteger(questionCount) ||
    questionCount < QUESTION_COUNT_MIN ||
    questionCount > QUESTION_COUNT_MAX
  ) {
    return {
      ok: false,
      error: `Question count must be between ${QUESTION_COUNT_MIN} and ${QUESTION_COUNT_MAX}`,
    };
  }

  if (!ANSWER_MODES.includes(r.answerMode as AnswerMode)) {
    return { ok: false, error: "Choose an answer mode" };
  }
  if (!DIFFICULTIES.includes(r.difficulty as Difficulty)) {
    return { ok: false, error: "Choose a difficulty" };
  }

  return {
    ok: true,
    value: {
      categories: categories as string[],
      questionCount,
      answerMode: r.answerMode as AnswerMode,
      difficulty: r.difficulty as Difficulty,
    },
  };
}
