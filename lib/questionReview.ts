import type { QuestionRow } from "@/lib/db/types";
import type { GeneratedQuestion } from "@/lib/generation/schema";

export type ReviewQuestion = Pick<QuestionRow, "id" | "index" | "prompt" | "mode" | "options" | "correct_option" | "accepted_variants" | "explanation" | "difficulty">;
export interface QuestionReview { questions: ReviewQuestion[]; regenerationsRemaining: number; categories: string[] }

/** Mirrors the transactional SQL ordering/count rule, without database concerns. */
export function removeReviewQuestion<T extends { id: string; index: number }>(questions: readonly T[], id: string): T[] {
  if (!questions.some((q) => q.id === id)) throw new Error("Question no longer exists. Reload and retry.");
  if (questions.length <= 1) throw new Error("At least one question must remain.");
  return questions.filter((q) => q.id !== id).sort((a, b) => a.index - b.index).map((q, index) => ({ ...q, index }));
}

export function generationQuestions(questions: readonly ReviewQuestion[]): GeneratedQuestion[] {
  return questions.map((q) => ({ ...q, options: q.options ?? undefined, correct_option: q.correct_option ?? undefined, accepted_variants: q.accepted_variants ?? undefined }));
}
