import "server-only";
// U3. Server-side generation + persistence helper. Deliberately NOT a
// client-callable server action ("use server") — an anonymous generation
// endpoint would be a cost-DoS on the paid xAI budget. Generation is invoked
// only from createGame (U4), which carries the per-IP rate limit and
// question-count ceiling abuse guard (KTD10).

import { getServiceClient } from "@/lib/supabase/server";
import { generateQuestions } from "@/lib/generation/xai";
import { normalizePrompt } from "@/lib/generation/dedup";
import { normalizedAnswerKey } from "@/lib/generation/answerKey";
import { buildBankExclusions, fetchBankEntries, type BankQueryClient } from "@/lib/generation/bankQuery";
import type { GenerationParams } from "@/lib/generation/schema";

/**
 * Generate a calibrated question set and persist it to `questions` for a game.
 * Throws on generation or persistence failure so createGame can surface the
 * error state and leave no half-initialized game (U4).
 *
 * De-dup (R7): the durable question_bank is consulted before generation so
 * previously-asked prompts are excluded, and every new question is appended to
 * the bank afterward so future games skip it too.
 */
export async function generateAndPersistQuestions(
  gameId: string,
  params: GenerationParams,
): Promise<number> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error("Missing XAI_API_KEY");

  const supabase = getServiceClient();

  // Exclusion set from the durable bank (U3 / R3): scoped to the categories in
  // play, deterministically ordered and explicitly bounded, so it can never be a
  // silently truncated slice of the whole table. Best-effort — a bank read
  // failure logs and generates without exclusions rather than blocking a game
  // the host is waiting on.
  const { entries } = await fetchBankEntries(
    supabase as unknown as BankQueryClient,
    params.categories,
  );
  const exclusions = buildBankExclusions(entries);

  const questions = await generateQuestions(
    params,
    {
      apiKey,
      baseUrl: process.env.XAI_BASE_URL,
      model: process.env.XAI_MODEL,
    },
    exclusions,
  );

  const rows = questions.map((q, index) => ({
    game_id: gameId,
    index,
    prompt: q.prompt,
    mode: q.mode,
    options: q.options ?? null,
    correct_option: q.correct_option ?? null,
    accepted_variants: q.accepted_variants ?? null,
    difficulty: q.difficulty,
  }));

  const { error } = await supabase.from("questions").insert(rows);
  if (error) {
    throw new Error(`Failed to persist questions: ${error.message}`);
  }

  // Append to the durable bank (R7.1). Conflicts on prompt_norm are ignored so a
  // rare race can't fail the game; the game's own questions are already saved.
  const bankRows = questions.map((q) => ({
    prompt: q.prompt,
    prompt_norm: normalizePrompt(q.prompt),
    // The answer anchor future generations match against (U2). Application code
    // is the authority for this column — migration 0011 only backfilled rows
    // banked before it existed.
    answer_norm: normalizedAnswerKey(q),
    mode: q.mode,
    options: q.options ?? null,
    correct_option: q.correct_option ?? null,
    accepted_variants: q.accepted_variants ?? null,
    difficulty: q.difficulty,
    categories: params.categories,
  }));
  const { error: bankError } = await supabase
    .from("question_bank")
    .upsert(bankRows, { onConflict: "prompt_norm", ignoreDuplicates: true });
  if (bankError) {
    // Non-fatal: the game is fully playable without the bank write. Log so a
    // persistent failure is detectable rather than silently degrading dedup.
    console.error(`[generate] question_bank upsert failed: ${bankError.message}`);
  }

  return rows.length;
}
