import "server-only";
// Category feasibility preflight (KTD1–KTD3): short xAI check for free-text
// custom categories before createGame inserts a game row. Presets skip the
// model. Fail closed on timeout, HTTP errors, or malformed/partial responses.

import { isPresetCategory, normalizeCategory } from "@/lib/gameConfig";
import { GenerationError } from "./xai";

const DEFAULT_BASE_URL = "https://api.x.ai/v1";
const DEFAULT_MODEL = "grok-4.20-0309-non-reasoning";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface PreflightConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export type CategoryFeasibility =
  | { category: string; feasible: true }
  | { category: string; feasible: false; reason: string };

export type PreflightResult =
  | { ok: true; results: CategoryFeasibility[] }
  | { ok: false; rejected: { category: string; reason: string }[] };

export function splitPresetAndCustom(categories: string[]): {
  presets: string[];
  customs: string[];
} {
  const presets: string[] = [];
  const customs: string[] = [];
  for (const c of categories) {
    if (isPresetCategory(c)) presets.push(normalizeCategory(c));
    else customs.push(normalizeCategory(c));
  }
  return { presets, customs };
}

/**
 * Check that every custom category can support fair, objective trivia.
 * Presets are always feasible and do not trigger an API call when no customs.
 */
export async function checkCategoryFeasibility(
  categories: string[],
  config: PreflightConfig,
): Promise<PreflightResult> {
  const { presets, customs } = splitPresetAndCustom(categories);
  const presetResults: CategoryFeasibility[] = presets.map((category) => ({
    category,
    feasible: true as const,
  }));

  if (customs.length === 0) {
    return { ok: true, results: presetResults };
  }

  if (!config.apiKey) {
    throw new GenerationError("Missing xAI API key");
  }

  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const model = config.model ?? DEFAULT_MODEL;
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const messages = [
    {
      role: "system" as const,
      content:
        "You evaluate trivia categories. Return only valid JSON. Never include commentary.",
    },
    {
      role: "user" as const,
      content: [
        "For each category below, decide if an AI can write fair, objective, public-knowledge trivia questions with clear correct answers (not pure opinion, not private/personal knowledge, not too niche to support a full set).",
        `Categories: ${JSON.stringify(customs)}`,
        'Return JSON of the form {"results":[{"category":"<exact name>","feasible":true|false,"reason":"<short reason if not feasible>"}]}.',
        "Include every category exactly once. Use the category string exactly as given.",
      ].join("\n"),
    },
  ];

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
        messages,
        response_format: { type: "json_object" },
        temperature: 0,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    throw new GenerationError(
      aborted
        ? `Category check timed out after ${timeoutMs}ms`
        : `Category check failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new GenerationError(`Category check returned ${res.status}`);
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new GenerationError("Category check response was not valid JSON");
  }

  const content = (payload as { choices?: { message?: { content?: unknown } }[] })
    ?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new GenerationError("Category check missing message content");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new GenerationError("Category check content was not valid JSON");
  }

  const rawResults = extractResults(parsed);
  if (!rawResults) {
    throw new GenerationError("Could not validate categories");
  }

  const byKey = new Map<string, { feasible: boolean; reason: string }>();
  for (const item of rawResults) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    if (typeof row.category !== "string") continue;
    const feasible = row.feasible === true;
    const reason =
      typeof row.reason === "string" && row.reason.trim()
        ? row.reason.trim()
        : "Not suitable for fair trivia questions";
    byKey.set(normalizeCategory(row.category).toLowerCase(), { feasible, reason });
  }

  // Fail closed: every custom must appear in the model response.
  for (const c of customs) {
    if (!byKey.has(c.toLowerCase())) {
      throw new GenerationError("Could not validate categories");
    }
  }

  const customResults: CategoryFeasibility[] = customs.map((category) => {
    const hit = byKey.get(category.toLowerCase())!;
    if (hit.feasible) return { category, feasible: true as const };
    return { category, feasible: false as const, reason: hit.reason };
  });

  const rejected = customResults
    .filter((r): r is { category: string; feasible: false; reason: string } => !r.feasible)
    .map((r) => ({ category: r.category, reason: r.reason }));

  if (rejected.length > 0) {
    return { ok: false, rejected };
  }

  return { ok: true, results: [...presetResults, ...customResults] };
}

function extractResults(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    Array.isArray((parsed as Record<string, unknown>).results)
  ) {
    return (parsed as { results: unknown[] }).results;
  }
  return null;
}

/** Format rejected categories for the setup error surface. */
export function formatFeasibilityError(
  rejected: { category: string; reason: string }[],
): string {
  const lines = rejected.map((r) => `“${r.category}”: ${r.reason}`);
  return `Some categories aren’t feasible for trivia:\n${lines.join("\n")}`;
}
