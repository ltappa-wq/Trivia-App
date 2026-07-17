// Shared game configuration: expanded preset categories, free-text custom
// categories (with length/count bounds), question-count bounds, and setup
// validation. Consumed by the setup UI, createGame, generation, and category
// feasibility preflight.

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
  "Nature & Animals",
  "Space & Astronomy",
  "Math & Numbers",
  "World Capitals",
  "US History",
  "World History",
  "Pop Culture",
  "Video Games",
  "Anime & Manga",
  "Comics & Superheroes",
  "Mythology",
  "Religion & Philosophy",
  "Language & Words",
  "Inventions",
  "Famous People",
  "Business & Economics",
  "Politics",
  "Law & Crime",
  "Medicine & Health",
  "Psychology",
  "Fashion",
  "Cars & Transportation",
  "Architecture",
  "Theatre & Broadway",
  "Books & Authors",
  "Board Games",
  "Olympics",
  "Football",
  "Basketball",
  "Baseball",
  "Soccer",
  "Tennis",
  "Horror Movies",
  "Disney & Pixar",
  "90s Nostalgia",
  "2000s Nostalgia",
  "Internet Culture",
  "Brands & Logos",
] as const;

/** Max characters for a single category label (preset or custom). */
export const CATEGORY_MAX_LEN = 40;
/** Max categories selectable per game (anti-prompt-stuffing). */
export const MAX_CATEGORIES = 8;

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

export interface SetupInput {
  categories: string[];
  questionCount: number;
  answerMode: AnswerMode;
  difficulty: Difficulty;
}

export type SetupValidation =
  | { ok: true; value: SetupInput }
  | { ok: false; error: string };

/** Normalize category labels: trim and collapse internal whitespace. */
export function normalizeCategory(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** Case-insensitive membership in the expanded preset list. */
export function isPresetCategory(name: string): boolean {
  const key = normalizeCategory(name).toLowerCase();
  return (CATEGORIES as readonly string[]).some((c) => c.toLowerCase() === key);
}

/**
 * Validate raw setup input before it reaches preflight, generation, or the DB.
 * Accepts expanded presets and free-text customs within length/count bounds.
 * Rejects empty, overlong, over-count, and case-insensitive duplicate labels.
 */
export function validateSetupInput(raw: unknown): SetupValidation {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "Invalid setup input" };
  }
  const r = raw as Record<string, unknown>;

  const categories = r.categories;
  if (!Array.isArray(categories) || categories.length === 0) {
    return { ok: false, error: "Select at least one category" };
  }
  if (categories.length > MAX_CATEGORIES) {
    return {
      ok: false,
      error: `Choose at most ${MAX_CATEGORIES} categories`,
    };
  }
  if (!categories.every((c) => typeof c === "string")) {
    return { ok: false, error: "Select at least one valid category" };
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const rawCat of categories as string[]) {
    const cat = normalizeCategory(rawCat);
    if (cat.length === 0) {
      return { ok: false, error: "Category names can’t be empty" };
    }
    if (cat.length > CATEGORY_MAX_LEN) {
      return {
        ok: false,
        error: `Category names must be ${CATEGORY_MAX_LEN} characters or fewer`,
      };
    }
    const key = cat.toLowerCase();
    if (seen.has(key)) {
      return { ok: false, error: "Duplicate categories aren’t allowed" };
    }
    seen.add(key);
    // Prefer the canonical preset casing when the host typed a preset name.
    const preset = (CATEGORIES as readonly string[]).find(
      (c) => c.toLowerCase() === key,
    );
    normalized.push(preset ?? cat);
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
      categories: normalized,
      questionCount,
      answerMode: r.answerMode as AnswerMode,
      difficulty: r.difficulty as Difficulty,
    },
  };
}
