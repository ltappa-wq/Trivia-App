import "server-only";
// U3. Server-side generation + persistence helper. Deliberately NOT a
// client-callable server action ("use server") — an anonymous generation
// endpoint would be a cost-DoS on the paid xAI budget. Generation is invoked
// only from createGame (U4), which carries the per-IP rate limit and
// question-count ceiling abuse guard (KTD10).

import { getServiceClient } from "@/lib/supabase/server";
import { generateQuestions } from "@/lib/generation/xai";
import type { GenerationParams } from "@/lib/generation/schema";

/**
 * Generate a calibrated question set and persist it to `questions` for a game.
 * Throws on generation or persistence failure so createGame can surface the
 * error state and leave no half-initialized game (U4).
 */
export async function generateAndPersistQuestions(
  gameId: string,
  params: GenerationParams,
): Promise<number> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error("Missing XAI_API_KEY");

  const questions = await generateQuestions(params, {
    apiKey,
    baseUrl: process.env.XAI_BASE_URL,
    model: process.env.XAI_MODEL,
  });

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

  const { error } = await getServiceClient().from("questions").insert(rows);
  if (error) {
    throw new Error(`Failed to persist questions: ${error.message}`);
  }
  return rows.length;
}
