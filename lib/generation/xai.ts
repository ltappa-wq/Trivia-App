import "server-only";
// U3. xAI question generation via the OpenAI-compatible Chat Completions API
// (KTD5). Called once at setup (U4) so the live loop stays AI-free. Whole-set
// generation risks truncation at high counts, so this regenerates only the
// missing/invalid tail rather than failing the whole game (KTD10).

import {
  extractQuestionArray,
  validateGeneratedQuestion,
  type GeneratedQuestion,
  type GenerationParams,
} from "./schema";
import { normalizePrompt } from "./dedup";

const DEFAULT_BASE_URL = "https://api.x.ai/v1";
// Non-reasoning model: structured trivia generation needs no chain-of-thought,
// so this is markedly cheaper/faster than the reasoning variants (protects the
// paid xAI budget, KTD10). Override per-account with XAI_MODEL if unavailable.
const DEFAULT_MODEL = "grok-4.20-0309-non-reasoning";
// Bound on the regenerate-the-tail loop so a persistently short/garbage model
// response fails loudly instead of looping forever (KTD10).
// Higher than the original 4 so bank-dedup rejections still leave room for
// tail regeneration (especially on small category sets that the model tends to
// recycle).
const DEFAULT_MAX_ATTEMPTS = 6;
// Cap each completion request so large games (up to QUESTION_COUNT_MAX) fill via
// several medium batches rather than one truncation-prone 100-question call.
const GENERATION_BATCH_SIZE = 12;
// Per-attempt timeout so a hung xAI connection can't block createGame (and the
// gamemaster) indefinitely — it aborts and surfaces a handled GenerationError.
const DEFAULT_TIMEOUT_MS = 45_000;

export interface XaiConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
  timeoutMs?: number;
}

/** Thrown on any generation failure so callers surface a handled error state
 * (U4 Retry / Back-to-edit) rather than persisting a partial silent set. */
export class GenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationError";
  }
}

function buildMessages(
  params: GenerationParams,
  count: number,
  avoidPrompts: readonly string[] = [],
) {
  const modeInstruction =
    params.mode === "multiple_choice"
      ? `Each question is multiple choice: provide an "options" array of 4 answer strings and "correct_option" as the 0-based index of the correct one. Vary which index is correct across the set — do not put the correct answer first every time.`
      : `Each question is type-the-answer: provide an "accepted_variants" array of acceptable answers. Every accepted answer MUST be one or two common, easy-to-spell words (letters only, no numbers or punctuation). Reject any question whose natural answer cannot meet this constraint.`;

  const avoidBlock =
    avoidPrompts.length > 0
      ? [
          "Do NOT repeat or closely rephrase any of these already-used questions:",
          ...avoidPrompts.slice(0, 40).map((p) => `- ${p}`),
        ]
      : [];

  return [
    {
      role: "system" as const,
      content:
        "You are a trivia question generator. You return only valid JSON. Never include commentary. Prefer fresh, non-overlapping prompts.",
    },
    {
      role: "user" as const,
      content: [
        `Generate exactly ${count} ${params.difficulty} trivia questions.`,
        `Categories: ${params.categories.join(", ")}.`,
        modeInstruction,
        ...avoidBlock,
        `Return a JSON object of the form {"questions": [ ... ]} where each element has "prompt", the mode-specific fields above, and no extra fields.`,
      ].join("\n"),
    },
  ];
}

async function requestBatch(
  params: GenerationParams,
  count: number,
  config: Required<Pick<XaiConfig, "apiKey" | "baseUrl" | "model">> & {
    fetchImpl: typeof fetch;
    timeoutMs: number;
  },
  avoidPrompts: readonly string[] = [],
  /** Bump temperature on retries so the model diversifies after duplicates. */
  temperature: number = 0.7,
): Promise<unknown[]> {
  let res: Response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    res = await config.fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: buildMessages(params, count, avoidPrompts),
        response_format: { type: "json_object" },
        temperature,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    throw new GenerationError(
      aborted
        ? `xAI request timed out after ${config.timeoutMs}ms`
        : `xAI request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new GenerationError(`xAI returned ${res.status}`);
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new GenerationError("xAI response was not valid JSON");
  }

  const content = (payload as { choices?: { message?: { content?: unknown } }[] })
    ?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new GenerationError("xAI response missing message content");
  }

  // A truncated completion yields unparseable JSON; treat as an empty batch so
  // the tail-regeneration loop retries rather than throwing (KTD10).
  try {
    return extractQuestionArray(JSON.parse(content));
  } catch {
    return [];
  }
}

/**
 * Generate a validated set of exactly `params.count` questions. Invalid,
 * missing, or duplicate questions from one attempt are re-requested (tail
 * regeneration) up to `maxAttempts`; if the set still can't be filled, throws
 * GenerationError.
 *
 * `seen` holds normalized prompts already in the question bank (R7.2); any
 * generated question whose normalized prompt is in `seen` — or that repeats a
 * prompt already accepted this run — is rejected like an invalid one, which
 * drives tail regeneration until `count` unique questions are produced (R7.3).
 */
export async function generateQuestions(
  params: GenerationParams,
  config: XaiConfig,
  seen: ReadonlySet<string> = new Set(),
  /** Original prompt text already banked (or accepted this run) for model avoid-list. */
  avoidPrompts: readonly string[] = [],
): Promise<GeneratedQuestion[]> {
  if (!config.apiKey) throw new GenerationError("Missing xAI API key");
  if (params.count < 1) throw new GenerationError("count must be >= 1");

  const resolved = {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
    model: config.model ?? DEFAULT_MODEL,
    fetchImpl: config.fetchImpl ?? fetch,
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
  // Scale attempts with set size so a 100-question game can fill via many batches.
  const maxAttempts =
    config.maxAttempts ??
    Math.max(DEFAULT_MAX_ATTEMPTS, Math.ceil(params.count / GENERATION_BATCH_SIZE) * 3 + 2);

  const collected: GeneratedQuestion[] = [];
  // Normalized prompts we must not emit: the bank's existing prompts plus the
  // ones accepted so far this run (so a single batch can't self-duplicate).
  const usedNorms = new Set<string>(seen);
  const avoid = [...avoidPrompts];
  // Track why questions were rejected so an exhausted-attempts failure reports
  // the actual cause instead of only a bare count (diagnosability).
  const rejections = new Set<string>();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const remaining = params.count - collected.length;
    if (remaining <= 0) break;

    // Request a medium batch (slight oversample for dup/invalid dropouts).
    const requestCount = Math.min(GENERATION_BATCH_SIZE, remaining + Math.min(2, remaining));
    // Diversify after the first pass so retries are less likely to echo banked prompts.
    const temperature = Math.min(1.1, 0.7 + attempt * 0.05);
    const batch = await requestBatch(params, requestCount, resolved, avoid, temperature);
    for (const raw of batch) {
      if (collected.length >= params.count) break;
      const result = validateGeneratedQuestion(raw, params);
      if (!result.ok) {
        rejections.add(result.reason);
        continue;
      }
      const norm = normalizePrompt(result.question.prompt);
      if (usedNorms.has(norm)) {
        rejections.add("duplicate");
        continue;
      }
      usedNorms.add(norm);
      avoid.push(result.question.prompt);
      collected.push(result.question);
    }
  }

  if (collected.length < params.count) {
    const detail = rejections.size > 0 ? ` (rejections: ${[...rejections].join("; ")})` : "";
    throw new GenerationError(
      `Generated only ${collected.length} of ${params.count} valid questions${detail}`,
    );
  }
  return collected;
}
