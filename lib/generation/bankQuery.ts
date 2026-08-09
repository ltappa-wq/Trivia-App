// U3 / R3 / KTD5. Scoped, bounded reads of the durable question bank.
//
// The read this replaces was `select("prompt_norm, prompt")` with no filter, no
// order and no limit. That does not mean "everything": PostgREST applies its own
// max-rows ceiling, so once the bank outgrows it the exclusion set silently
// becomes an arbitrary subset — and the code cannot tell "the bank has 800 rows"
// from "I was handed the first 1,000 of 40,000". Dedup then gets *weaker* the
// more the product is used, which is the worst possible failure curve.
//
// So: filter to the categories actually in play, order deterministically, and
// carry an explicit limit we chose rather than one the transport picked for us.
//
// No "server-only" import here on purpose — the client is injected, which keeps
// the whole module unit-testable without a live Supabase project.

/**
 * Row ceiling for a single bank read. Sized well above any realistic
 * per-category volume: at ~100 questions per game, this is thousands of games
 * deep in the *same* categories before it can bind. It exists to make the bound
 * ours and visible, not to be reached — if it ever is, the log line below says
 * so explicitly rather than degrading in silence.
 */
export const BANK_QUERY_LIMIT = 2000;

/**
 * How many banked prompts are handed to the model as an avoid-list. The cap is
 * a prompt-budget constraint, not a correctness one — the real dedup gate is the
 * answer anchor in U4, which sees every fetched row. Previously this was the
 * first 40 rows of an unordered whole-table read, so it frequently listed
 * prompts from categories the game wasn't even about.
 */
export const MODEL_AVOID_PROMPT_CAP = 40;

/** The bank columns duplicate detection needs. */
export interface BankEntry {
  prompt: string;
  prompt_norm: string;
  answer_norm: string | null;
}

export interface BankExclusions {
  /** Normalized prompts already banked — the cheap exact-match pre-filter. */
  seen: ReadonlySet<string>;
  /**
   * Normalized answer → the normalized prompts banked under it. The anchor
   * index for U4: a candidate looks up its own answer here and compares against
   * only these prompts, which is nearly always an empty list.
   */
  promptsByAnswer: ReadonlyMap<string, readonly string[]>;
  /** Original prompt text for the model's avoid-list, category-scoped and capped. */
  avoidPrompts: readonly string[];
}

/** Shape of a bank read result, distinguishing "nothing banked" from "read failed". */
export interface BankReadResult {
  entries: BankEntry[];
  /**
   * True when the read errored. Callers still proceed (a bank outage must not
   * block a game) but this keeps the degraded state nameable rather than
   * indistinguishable from an empty bank.
   */
  failed: boolean;
}

/** The slice of the Supabase query builder this module uses. Injectable for tests. */
export interface BankQueryClient {
  from(table: string): {
    select(columns: string): {
      overlaps(
        column: string,
        values: readonly string[],
      ): {
        order(
          column: string,
          options: { ascending: boolean },
        ): {
          limit(count: number): PromiseLike<{
            data: BankEntry[] | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
  };
}

/**
 * Read the banked questions relevant to `categories`.
 *
 * Best-effort by design: a bank read failure logs and returns empty rather than
 * blocking a game the host is waiting on. The log distinguishes a failure from
 * an empty bank so a persistent outage that has quietly disabled dedup is
 * detectable in production instead of looking like a cold start.
 */
export async function fetchBankEntries(
  client: BankQueryClient,
  categories: readonly string[],
  options: { limit?: number; log?: (message: string) => void } = {},
): Promise<BankReadResult> {
  const limit = options.limit ?? BANK_QUERY_LIMIT;
  const log = options.log ?? ((m: string) => console.error(m));

  // No categories means nothing to scope to; an unscoped read is the exact
  // failure mode this unit exists to remove, so read nothing instead.
  if (categories.length === 0) {
    log("[generate] question_bank read skipped: no categories in play");
    return { entries: [], failed: false };
  }

  const { data, error } = await client
    .from("question_bank")
    .select("prompt, prompt_norm, answer_norm")
    // Postgres array overlap: rows sharing at least one category with this game.
    .overlaps("categories", categories)
    // Deterministic and meaningful: if the limit ever binds, it keeps the most
    // recently banked questions — the ones a repeat would be most noticed on.
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    log(`[generate] question_bank read FAILED; dedup disabled for this game: ${error.message}`);
    return { entries: [], failed: true };
  }

  const entries = data ?? [];
  if (entries.length >= limit) {
    log(
      `[generate] question_bank read hit the ${limit}-row limit for categories ` +
        `[${categories.join(", ")}]; exclusion set is bounded, consider raising BANK_QUERY_LIMIT`,
    );
  }
  return { entries, failed: false };
}

/**
 * Shape fetched rows into the three lookups generation needs. Pure — the
 * category scoping and bounding already happened at the query.
 */
export function buildBankExclusions(
  entries: readonly BankEntry[],
  avoidPromptCap: number = MODEL_AVOID_PROMPT_CAP,
): BankExclusions {
  const seen = new Set<string>();
  const promptsByAnswer = new Map<string, string[]>();
  const avoidPrompts: string[] = [];

  for (const entry of entries) {
    if (entry.prompt_norm) seen.add(entry.prompt_norm);
    // Null answer_norm never anchors — a row we can't key is a row that can't
    // manufacture a false match. Same for rows with no prompt_norm to compare.
    if (entry.answer_norm && entry.prompt_norm) {
      const bucket = promptsByAnswer.get(entry.answer_norm);
      if (bucket) bucket.push(entry.prompt_norm);
      else promptsByAnswer.set(entry.answer_norm, [entry.prompt_norm]);
    }
    if (entry.prompt && avoidPrompts.length < avoidPromptCap) {
      avoidPrompts.push(entry.prompt);
    }
  }

  return { seen, promptsByAnswer, avoidPrompts };
}
