import type { QuestionMode } from "@/lib/db/types";

/** 50% choice, 25% typed, 25% binary over each four questions. */
export function mixedModeAt(index: number): QuestionMode {
  return (["multiple_choice", "type_answer", "true_false", "multiple_choice"] as const)[index % 4];
}
