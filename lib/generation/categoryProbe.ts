import "server-only";
// Probe whether a free-text custom category can yield enough distinct trivia
// questions. Used when the host clicks "Add" so thin/joke topics are rejected
// before game creation spends a full generation budget.

const DEFAULT_BASE_URL = "https://api.x.ai/v1";
const DEFAULT_MODEL = "grok-4.20-0309-non-reasoning";
const DEFAULT_TIMEOUT_MS = 12_000;

/** Minimum unique questions we expect a custom topic to support. */
export const CUSTOM_CATEGORY_MIN_QUESTIONS = 10;

export interface CategoryProbeResult {
  ok: boolean;
  /** Model's rough count of unique easy/medium facts it could generate. */
  estimatedQuestions: number;
  /** Short human reason when not ok (or optional note when ok). */
  reason: string;
}

export interface CategoryProbeConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  minQuestions?: number;
}

/**
 * Ask the model whether `category` can support at least `minQuestions` distinct
 * trivia facts. Best-effort structured JSON; throws on transport failure so the
 * caller can surface a retryable error.
 */
export async function probeCategoryViability(
  category: string,
  config: CategoryProbeConfig,
): Promise<CategoryProbeResult> {
  const minQuestions = config.minQuestions ?? CUSTOM_CATEGORY_MIN_QUESTIONS;
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const model = config.model ?? DEFAULT_MODEL;
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You evaluate trivia category topics. Return only valid JSON. Be strict: joke, nonsense, or ultra-narrow topics that cannot support many distinct questions are not viable.",
          },
          {
            role: "user",
            content: [
              `Category name: ${JSON.stringify(category)}`,
              `We need at least ${minQuestions} distinct, non-overlapping trivia questions (unique correct answers) at medium difficulty.`,
              `Reply with JSON: {"viable":boolean,"estimated_questions":number,"reason":string}`,
              `estimated_questions is how many unique solid questions you could realistically write for this topic alone.`,
              `viable is true only if estimated_questions >= ${minQuestions}.`,
              `reason is one short sentence for the host (why not, or "Looks good").`,
            ].join("\n"),
          },
        ],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    throw new Error(
      aborted
        ? `Category check timed out after ${timeoutMs}ms`
        : `Category check failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`Category check returned ${res.status}`);
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new Error("Category check response was not valid JSON");
  }

  const content = (payload as { choices?: { message?: { content?: unknown } }[] })
    ?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Category check missing message content");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Category check returned unparseable JSON");
  }

  const obj = parsed as Record<string, unknown>;
  const estimated =
    typeof obj.estimated_questions === "number" && Number.isFinite(obj.estimated_questions)
      ? Math.max(0, Math.floor(obj.estimated_questions))
      : 0;
  const reason =
    typeof obj.reason === "string" && obj.reason.trim()
      ? obj.reason.trim()
      : estimated >= minQuestions
        ? "Looks good"
        : "Not enough unique questions for this topic";
  const viableFlag = obj.viable === true;
  const ok = viableFlag && estimated >= minQuestions;

  return { ok, estimatedQuestions: estimated, reason };
}
