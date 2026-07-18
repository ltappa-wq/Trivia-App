"use server";
// Host setup: AI probe when adding a custom category. Rejects topics that
// cannot support enough distinct questions before createGame spends a full set.

import { getServiceClient } from "@/lib/supabase/server";
import { checkSharedRateLimit } from "@/lib/rateLimit";
import { callerIp } from "@/lib/serverRequest";
import {
  CATEGORIES,
  CUSTOM_CATEGORY_MAX_LEN,
  isValidCategory,
  normalizeCategory,
} from "@/lib/gameConfig";
import {
  CUSTOM_CATEGORY_MIN_QUESTIONS,
  probeCategoryViability,
} from "@/lib/generation/categoryProbe";

const VALIDATE_LIMIT = 12;
const VALIDATE_WINDOW_MS = 60_000;

export type ValidateCategoryResult =
  | { ok: true; category: string; estimatedQuestions: number }
  | { ok: false; error: string };

/**
 * Validate shape + AI depth for a custom category. Built-in seed categories are
 * accepted without an AI call (already curated).
 */
export async function validateCustomCategory(
  rawCategory: string,
): Promise<ValidateCategoryResult> {
  const category = normalizeCategory(rawCategory);
  if (!category) return { ok: false, error: "Enter a category name" };
  if (!isValidCategory(category)) {
    return {
      ok: false,
      error: `Use up to ${CUSTOM_CATEGORY_MAX_LEN} letters, numbers, or simple punctuation`,
    };
  }

  // Built-ins are pre-approved — no paid AI call.
  if ((CATEGORIES as readonly string[]).includes(category)) {
    return {
      ok: true,
      category,
      estimatedQuestions: CUSTOM_CATEGORY_MIN_QUESTIONS,
    };
  }

  const supabase = getServiceClient();
  if (
    !(await checkSharedRateLimit(
      supabase,
      `catprobe:${await callerIp()}`,
      VALIDATE_LIMIT,
      VALIDATE_WINDOW_MS,
    ))
  ) {
    return { ok: false, error: "Too many category checks — wait a moment." };
  }

  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return { ok: false, error: "Question AI is not configured" };

  try {
    const probe = await probeCategoryViability(category, {
      apiKey,
      baseUrl: process.env.XAI_BASE_URL,
      model: process.env.XAI_MODEL,
      minQuestions: CUSTOM_CATEGORY_MIN_QUESTIONS,
    });
    if (!probe.ok) {
      return {
        ok: false,
        error:
          probe.reason ||
          `Need about ${CUSTOM_CATEGORY_MIN_QUESTIONS}+ unique questions for this topic`,
      };
    }
    return {
      ok: true,
      category,
      estimatedQuestions: probe.estimatedQuestions,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not check that category",
    };
  }
}
