// Shared game configuration: the category seed list, question-count bounds, and
// setup-input validation. Consumed by the setup UI (U4), createGame (U4), and
// generation (U3). Hosts may also add free-text custom categories.

import type { AnswerMode, Difficulty } from "@/lib/db/types";

/** Built-in category chips shown on the setup form (~30). Hosts may add custom. */
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
  "Nature & Animals",
  "Pop Culture",
  "Video Games",
  "Comics & Superheroes",
  "Anime & Manga",
  "Mythology",
  "Religion & Philosophy",
  "Politics & World Affairs",
  "Business & Economics",
  "Math & Logic",
  "Space & Astronomy",
  "Medicine & Health",
  "Language & Words",
  "Fashion & Style",
  "Travel & Places",
  "Cars & Transportation",
  "Celebrities",
  "Television Trivia",
  "Board Games & Puzzles",
  "Holidays & Traditions",
  "Weird Facts",
  "Current Events",
] as const;

export const QUESTION_COUNT_MIN = 1;
// Host-facing ceiling (also enforced by the games.question_count check constraint).
// Generation pulls in batches (see lib/generation/xai.ts) so large counts stay
// within per-request timeouts rather than one giant completion.
export const QUESTION_COUNT_MAX = 100;

/** Max length for a host-entered custom category label. */
export const CUSTOM_CATEGORY_MAX_LEN = 40;
/** Cap how many free-text categories a single game may include. */
export const CUSTOM_CATEGORY_MAX_COUNT = 5;

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

export interface SetupInput {
  categories: string[];
  questionCount: number;
  answerMode: AnswerMode;
  difficulty: Difficulty;
}

export type SetupValidation =
  | { ok: true; value: SetupInput }
  | { ok: false; error: string };

export function normalizeCategory(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/**
 * A category is either a built-in seed name or a non-empty free-text label
 * within length bounds (custom host categories).
 */
export function isValidCategory(raw: string): boolean {
  // Reject control / line breaks before normalize collapses them into spaces.
  if (/[\n\r\t\0]/.test(raw)) return false;
  const c = normalizeCategory(raw);
  if (c.length === 0 || c.length > CUSTOM_CATEGORY_MAX_LEN) return false;
  if ((CATEGORIES as readonly string[]).includes(c)) return true;
  // Custom: letters/numbers/simple punctuation only.
  return /^[\p{L}\p{N} &'./+\-!?]+$/u.test(c);
}

/**
 * Validate raw setup input before it reaches generation or the database.
 * Rejects an out-of-range count and invalid categories/modes so the abuse guard
 * and the DB check constraints are never the first line of defense.
 */
export function validateSetupInput(raw: unknown): SetupValidation {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "Invalid setup input" };
  }
  const r = raw as Record<string, unknown>;

  const categoriesRaw = r.categories;
  if (!Array.isArray(categoriesRaw) || categoriesRaw.length === 0) {
    return { ok: false, error: "Select at least one valid category" };
  }
  if (!categoriesRaw.every((c) => typeof c === "string" && isValidCategory(c))) {
    return { ok: false, error: "Select at least one valid category" };
  }
  // Normalize + de-dupe (case-sensitive on the displayed label).
  const categories = [
    ...new Set(categoriesRaw.map((c) => normalizeCategory(c as string))),
  ];
  const customCount = categories.filter(
    (c) => !(CATEGORIES as readonly string[]).includes(c),
  ).length;
  if (customCount > CUSTOM_CATEGORY_MAX_COUNT) {
    return {
      ok: false,
      error: `At most ${CUSTOM_CATEGORY_MAX_COUNT} custom categories per game`,
    };
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
      categories,
      questionCount,
      answerMode: r.answerMode as AnswerMode,
      difficulty: r.difficulty as Difficulty,
    },
  };
}
