import "server-only";
// U3. Server-side generation + persistence helper. Deliberately NOT a
// client-callable server action ("use server") — an anonymous generation
// endpoint would be a cost-DoS on the paid xAI budget. Generation is invoked
// only from createGame (U4), which carries the per-IP rate limit and
// question-count ceiling abuse guard (KTD10).

import { getServiceClient } from "@/lib/supabase/server";
import { generateQuestions } from "@/lib/generation/xai";
import { normalizePrompt } from "@/lib/generation/dedup";
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

  // Exclusion set: normalized prompts already in the bank (R7.2). Best-effort —
  // if the read fails we generate without exclusion rather than blocking a game,
  // but log it so a persistent outage that silently disables dedup is detectable.
  const { data: banked, error: bankReadError } = await supabase
    .from("question_bank")
    .select("prompt_norm");
  if (bankReadError) {
    console.error(`[generate] question_bank read failed; dedup disabled: ${bankReadError.message}`);
  }
  const seen = new Set<string>((banked ?? []).map((r) => r.prompt_norm as string));

  const questions = await generateQuestions(
    params,
    {
      apiKey,
      baseUrl: process.env.XAI_BASE_URL,
      model: process.env.XAI_MODEL,
    },
    seen,
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
