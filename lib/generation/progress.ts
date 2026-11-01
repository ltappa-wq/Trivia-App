/** A crashed invocation may retain its lease until the 300s platform limit. */
export const GENERATION_LEASE_MS = 310_000;

export interface GenerationProgress {
  completed: number;
  total: number;
  running: boolean;
  error: string | null;
}

export function generationProgress(game: {
  question_count: number;
  generation_progress?: number;
  generation_started_at?: string | null;
  generation_error?: string | null;
}, now = Date.now()): GenerationProgress {
  const started = game.generation_started_at;
  const stale = Boolean(started && now - Date.parse(started) >= GENERATION_LEASE_MS);
  return {
    completed: game.generation_progress ?? 0,
    total: game.question_count,
    running: Boolean(started && !stale),
    error: stale ? "Question generation was interrupted. Please retry — your players are still seated." : game.generation_error ?? null,
  };
}
