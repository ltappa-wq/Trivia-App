"use server";

import { getServiceClient } from "@/lib/supabase/server";
import { authorizeHostByCode } from "@/lib/serverAuth";
import { checkSharedRateLimit } from "@/lib/rateLimit";
import { generateAndPersistQuestions } from "./generate";
import { GenerationError, generationFailureMessage } from "@/lib/generation/xai";
import { generationQuestions, removeReviewQuestion, type QuestionReview, type ReviewQuestion } from "@/lib/questionReview";

/** Dedicated host-only answer-key read. Never use player-readable hydration. */
export async function getQuestionReview(code: string, token: string): Promise<QuestionReview> {
  const db = getServiceClient();
  const game = await authorizeHostByCode(db, code, token);
  if (game.status !== "lobby" || game.current_index !== -1) throw new Error("Question review is available only before Start.");
  const { data, error } = await db.from("questions")
    .select("id,index,prompt,mode,options,correct_option,accepted_variants,explanation,difficulty")
    .eq("game_id", game.id).order("index");
  if (error) throw new Error("Could not load questions. Please retry.");
  return { questions: (data ?? []) as ReviewQuestion[], categories: game.categories, regenerationsRemaining: Math.max(0, 20 - (game.regeneration_count ?? 0)) };
}

export async function editQuestionReview(code: string, token: string, questionId: string, operation: "remove" | "regenerate"): Promise<{ review?: QuestionReview; error?: string }> {
  const db = getServiceClient();
  const game = await authorizeHostByCode(db, code, token);
  let lease: string | undefined;
  const mutate = async (op: string, extra: Record<string, unknown> = {}) => {
    const { data, error } = await db.rpc("edit_review_question", { p_game_id: game.id, p_host_token: token, p_operation: op, p_question_id: questionId, ...extra });
    if (error) throw new Error(error.message);
    return data;
  };
  try {
    if (operation !== "remove" && operation !== "regenerate") throw new Error("Invalid review operation");
    const current = await getQuestionReview(code, token);
    if (!current.questions.some((q) => q.id === questionId)) throw new Error("Question no longer exists. Reload and retry.");
    if (operation === "remove") {
      removeReviewQuestion(current.questions, questionId);
      await mutate("remove");
    } else {
      if (!await checkSharedRateLimit(db, `regenerate:${game.id}`, 5, 60_000)) throw new Error("Too many regeneration requests. Please wait a minute and retry.");
      const claim = await mutate("claim") as { lease: string; attempt: number };
      lease = claim.lease;
      // Re-read under the lease: another tab may have edited before we claimed.
      const locked = await getQuestionReview(code, token);
      await generateAndPersistQuestions(game.id, { categories: game.categories, count: 1, mode: game.answer_mode, difficulty: game.difficulty }, undefined, {
        existing: generationQuestions(locked.questions), fixtureOffset: 100 + claim.attempt - 1,
        persist: async (question) => { await mutate("replace", { p_lease: lease, p_question: question }); },
      });
    }
    return { review: await getQuestionReview(code, token) };
  } catch (error) {
    return { error: error instanceof GenerationError ? generationFailureMessage(error) : error instanceof Error ? error.message : "Could not edit questions. Please retry." };
  } finally {
    if (lease) await mutate("release", { p_lease: lease }).catch(() => {});
  }
}
