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

const DEFAULT_BASE_URL = "https://api.x.ai/v1";
// Non-reasoning model: structured trivia generation needs no chain-of-thought,
// so this is markedly cheaper/faster than the reasoning variants (protects the
// paid xAI budget, KTD10). Override per-account with XAI_MODEL if unavailable.
const DEFAULT_MODEL = "grok-4.20-0309-non-reasoning";
// Bound on the regenerate-the-tail loop so a persistently short/garbage model
// response fails loudly instead of looping forever (KTD10).
const DEFAULT_MAX_ATTEMPTS = 4;
// Per-attempt timeout so a hung xAI connection can't block createGame (and the
// gamemaster) indefinitely — it aborts and surfaces a handled GenerationError.
const DEFAULT_TIMEOUT_MS = 20_000;

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

function buildMessages(params: GenerationParams, count: number) {
  const modeInstruction =
    params.mode === "multiple_choice"
      ? `Each question is multiple choice: provide an "options" array of 4 answer strings and "correct_option" as the 0-based index of the correct one.`
      : `Each question is type-the-answer: provide an "accepted_variants" array of acceptable answers. Every accepted answer MUST be one or two common, easy-to-spell words (letters only, no numbers or punctuation). Reject any question whose natural answer cannot meet this constraint.`;

  return [
    {
      role: "system" as const,
      content:
        "You are a trivia question generator. You return only valid JSON. Never include commentary.",
    },
    {
      role: "user" as const,
      content: [
        `Generate exactly ${count} ${params.difficulty} trivia questions.`,
        `Categories: ${params.categories.join(", ")}.`,
        modeInstruction,
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
        messages: buildMessages(params, count),
        response_format: { type: "json_object" },
        temperature: 0.7,
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
 * Generate a validated set of exactly `params.count` questions. Invalid or
 * missing questions from one attempt are re-requested (tail regeneration) up to
 * `maxAttempts`; if the set still can't be filled, throws GenerationError.
 */
export async function generateQuestions(
  params: GenerationParams,
  config: XaiConfig,
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
  const maxAttempts = config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  const collected: GeneratedQuestion[] = [];
  // Track why questions were rejected so an exhausted-attempts failure reports
  // the actual cause instead of only a bare count (diagnosability).
  const rejections = new Set<string>();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const remaining = params.count - collected.length;
    if (remaining <= 0) break;

    const batch = await requestBatch(params, remaining, resolved);
    for (const raw of batch) {
      if (collected.length >= params.count) break;
      const result = validateGeneratedQuestion(raw, params);
      if (result.ok) collected.push(result.question);
      else rejections.add(result.reason);
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
