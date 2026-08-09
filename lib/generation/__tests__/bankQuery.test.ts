import { describe, expect, it, vi } from "vitest";
import {
  BANK_QUERY_LIMIT,
  MODEL_AVOID_PROMPT_CAP,
  buildBankExclusions,
  fetchBankEntries,
  type BankEntry,
  type BankQueryClient,
} from "../bankQuery";

// U3 / R3. The point of this unit is that the exclusion set is *knowable*:
// scoped to the categories in play, ordered deterministically, and bounded by a
// limit we chose. The old unbounded select could not tell a small bank from a
// truncated one, so these tests assert the query shape itself, not just results.

interface Recorded {
  table?: string;
  columns?: string;
  overlapsColumn?: string;
  overlapsValues?: readonly string[];
  orderColumn?: string;
  orderAscending?: boolean;
  limit?: number;
}

function fakeClient(result: {
  data?: BankEntry[] | null;
  error?: { message: string } | null;
}): { client: BankQueryClient; recorded: Recorded } {
  const recorded: Recorded = {};
  const client: BankQueryClient = {
    from(table) {
      recorded.table = table;
      return {
        select(columns) {
          recorded.columns = columns;
          return {
            overlaps(column, values) {
              recorded.overlapsColumn = column;
              recorded.overlapsValues = values;
              return {
                order(column, options) {
                  recorded.orderColumn = column;
                  recorded.orderAscending = options.ascending;
                  return {
                    limit(count) {
                      recorded.limit = count;
                      return Promise.resolve({
                        data: result.data ?? null,
                        error: result.error ?? null,
                      });
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  return { client, recorded };
}

function entry(over: Partial<BankEntry> & { prompt_norm: string }): BankEntry {
  return {
    prompt: over.prompt ?? over.prompt_norm,
    prompt_norm: over.prompt_norm,
    answer_norm: over.answer_norm ?? null,
  };
}

describe("fetchBankEntries (U3, R3)", () => {
  it("scopes the read to the categories in play via array overlap", async () => {
    const { client, recorded } = fakeClient({ data: [] });
    await fetchBankEntries(client, ["science", "music"], { log: () => {} });

    expect(recorded.table).toBe("question_bank");
    expect(recorded.overlapsColumn).toBe("categories");
    expect(recorded.overlapsValues).toEqual(["science", "music"]);
  });

  it("selects answer_norm alongside the prompt so U4 needs no second round trip", async () => {
    const { client, recorded } = fakeClient({ data: [] });
    await fetchBankEntries(client, ["science"], { log: () => {} });

    expect(recorded.columns).toContain("answer_norm");
    expect(recorded.columns).toContain("prompt_norm");
    expect(recorded.columns).toContain("prompt");
  });

  it("applies a deterministic most-recent-first order and an explicit limit", async () => {
    const { client, recorded } = fakeClient({ data: [] });
    await fetchBankEntries(client, ["science"], { log: () => {} });

    expect(recorded.orderColumn).toBe("created_at");
    expect(recorded.orderAscending).toBe(false);
    expect(recorded.limit).toBe(BANK_QUERY_LIMIT);
  });

  it("returns exactly the limit and says so when the bank is larger than the bound", async () => {
    const oversized = Array.from({ length: 5 }, (_, i) => entry({ prompt_norm: `q${i}` }));
    const { client } = fakeClient({ data: oversized });
    const log = vi.fn();

    const result = await fetchBankEntries(client, ["science"], { limit: 5, log });

    expect(result.entries).toHaveLength(5);
    expect(result.failed).toBe(false);
    // A bound that binds must be visible — this is the state the old code
    // could not distinguish from a small bank.
    expect(log).toHaveBeenCalledWith(expect.stringContaining("hit the 5-row limit"));
  });

  it("degrades to an empty exclusion set on a read error and logs it distinguishably", async () => {
    const { client } = fakeClient({ error: { message: "connection reset" } });
    const log = vi.fn();

    const result = await fetchBankEntries(client, ["science"], { log });

    expect(result.entries).toEqual([]);
    expect(result.failed).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("FAILED"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("connection reset"));
  });

  it("treats an empty bank as a success with no error path taken", async () => {
    const { client } = fakeClient({ data: [] });
    const log = vi.fn();

    const result = await fetchBankEntries(client, ["science"], { log });

    expect(result.entries).toEqual([]);
    expect(result.failed).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });

  it("refuses to read at all when there are no categories to scope to", async () => {
    const { client, recorded } = fakeClient({ data: [] });
    const log = vi.fn();

    const result = await fetchBankEntries(client, [], { log });

    // An unscoped read is the failure mode this unit removes.
    expect(recorded.table).toBeUndefined();
    expect(result).toEqual({ entries: [], failed: false });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("no categories"));
  });
});

describe("buildBankExclusions (U3, R3)", () => {
  it("indexes banked prompts by their answer so a candidate can look up its own anchor", () => {
    const { promptsByAnswer } = buildBankExclusions([
      entry({ prompt_norm: "what is the capital of france", answer_norm: "paris" }),
      entry({ prompt_norm: "which city hosts the louvre", answer_norm: "paris" }),
      entry({ prompt_norm: "who wrote hamlet", answer_norm: "shakespeare" }),
    ]);

    // R2: multiple banked questions per answer is expected, not an error.
    expect(promptsByAnswer.get("paris")).toEqual([
      "what is the capital of france",
      "which city hosts the louvre",
    ]);
    expect(promptsByAnswer.get("shakespeare")).toEqual(["who wrote hamlet"]);
  });

  it("builds the exact-match pre-filter from every banked prompt norm", () => {
    const { seen } = buildBankExclusions([
      entry({ prompt_norm: "a", answer_norm: "x" }),
      entry({ prompt_norm: "b", answer_norm: null }),
    ]);

    expect(seen.has("a")).toBe(true);
    // A row with no answer key still blocks its exact prompt.
    expect(seen.has("b")).toBe(true);
  });

  it("never anchors on a null answer key", () => {
    const { promptsByAnswer } = buildBankExclusions([
      entry({ prompt_norm: "a", answer_norm: null }),
      entry({ prompt_norm: "b", answer_norm: null }),
    ]);

    // Two unkeyable rows must not collapse onto a shared bucket.
    expect(promptsByAnswer.size).toBe(0);
  });

  it("caps the model avoid-list while leaving the anchor index complete", () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      entry({ prompt_norm: `q${i}`, answer_norm: `a${i}` }),
    );

    const { avoidPrompts, promptsByAnswer, seen } = buildBankExclusions(many, 3);

    expect(avoidPrompts).toHaveLength(3);
    // The cap is a prompt-budget limit; the real gate still sees everything.
    expect(promptsByAnswer.size).toBe(100);
    expect(seen.size).toBe(100);
  });

  it("defaults the avoid-list cap to MODEL_AVOID_PROMPT_CAP", () => {
    const many = Array.from({ length: MODEL_AVOID_PROMPT_CAP + 10 }, (_, i) =>
      entry({ prompt_norm: `q${i}` }),
    );

    expect(buildBankExclusions(many).avoidPrompts).toHaveLength(MODEL_AVOID_PROMPT_CAP);
  });

  it("returns empty lookups for an empty bank", () => {
    const { seen, promptsByAnswer, avoidPrompts } = buildBankExclusions([]);
    expect(seen.size).toBe(0);
    expect(promptsByAnswer.size).toBe(0);
    expect(avoidPrompts).toEqual([]);
  });
});
