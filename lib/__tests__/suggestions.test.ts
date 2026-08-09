import { describe, expect, it } from "vitest";
import {
  SUGGESTIONS_PER_PLAYER_MAX,
  aggregateSuggestions,
  validateSuggestions,
} from "../suggestions";

// U9 / U10 / R7 / R8. Two deliberately different failure modes are pinned here:
// an off-catalog value is dropped (never fail someone's join over a side field),
// while exceeding the cap is rejected (the picker enforces it, so passing it is
// a bypass, and truncating would hide which picks survived).

describe("validateSuggestions — accepted input (U9, R7)", () => {
  it("AE6: keeps a valid selection intact", () => {
    expect(validateSuggestions(["Science", "Music"])).toEqual({
      ok: true,
      value: ["Science", "Music"],
    });
  });

  it("treats an empty selection as valid — suggestions are optional", () => {
    expect(validateSuggestions([])).toEqual({ ok: true, value: [] });
  });

  it("treats omitted suggestions as an empty selection", () => {
    expect(validateSuggestions(undefined)).toEqual({ ok: true, value: [] });
    expect(validateSuggestions(null)).toEqual({ ok: true, value: [] });
  });

  it("collapses duplicates to one", () => {
    expect(validateSuggestions(["Science", "Science", "Music"])).toEqual({
      ok: true,
      value: ["Science", "Music"],
    });
  });

  it("preserves the order the player picked", () => {
    const result = validateSuggestions(["Music", "History", "Science"]);
    expect(result).toMatchObject({ ok: true, value: ["Music", "History", "Science"] });
  });

  it("tolerates surrounding whitespace from a form value", () => {
    expect(validateSuggestions([" Science "])).toEqual({ ok: true, value: ["Science"] });
  });
});

describe("validateSuggestions — off-catalog values are DROPPED (U9)", () => {
  it("drops an unknown category and keeps the valid ones", () => {
    // The join screen only offers the catalog, so this means a stale or
    // tampered client — not a real choice worth failing a join over.
    expect(validateSuggestions(["Science", "Underwater Basket Weaving"])).toEqual({
      ok: true,
      value: ["Science"],
    });
  });

  it("drops free-text entirely, unlike the host's own categories", () => {
    // R8: the host may invent category labels; players pick from the list.
    expect(validateSuggestions(["my custom topic"])).toEqual({ ok: true, value: [] });
  });

  it("drops non-string entries without failing", () => {
    expect(validateSuggestions(["Science", 42, null, {}])).toEqual({
      ok: true,
      value: ["Science"],
    });
  });

  it("rejects a non-array outright", () => {
    expect(validateSuggestions("Science")).toMatchObject({ ok: false });
    expect(validateSuggestions(42)).toMatchObject({ ok: false });
  });
});

describe("validateSuggestions — the cap is REJECTED loudly (U9)", () => {
  it("rejects a selection past the per-player cap with a clear message", () => {
    const tooMany = ["Science", "Music", "History", "Sports"];
    expect(tooMany.length).toBeGreaterThan(SUGGESTIONS_PER_PLAYER_MAX);

    const result = validateSuggestions(tooMany);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/at most 3/i);
  });

  it("accepts exactly the cap", () => {
    const atCap = ["Science", "Music", "History"];
    expect(validateSuggestions(atCap)).toMatchObject({ ok: true, value: atCap });
  });

  it("counts toward the cap only after duplicates and invalids are removed", () => {
    // Four entries, but only two survive cleaning — that is under the cap.
    expect(validateSuggestions(["Science", "Science", "Nope", "Music"])).toMatchObject({
      ok: true,
      value: ["Science", "Music"],
    });
  });
});

describe("aggregateSuggestions (U10, R8)", () => {
  it("rolls multiple players asking for one category into a single entry with a count", () => {
    const result = aggregateSuggestions([
      { category: "Science", username: "Ada" },
      { category: "Science", username: "Grace" },
      { category: "Music", username: "Alan" },
    ]);

    expect(result).toEqual([
      { category: "Science", count: 2, usernames: ["Ada", "Grace"] },
      { category: "Music", count: 1, usernames: ["Alan"] },
    ]);
  });

  it("orders by demand so the host's attention lands on what the room wants", () => {
    const result = aggregateSuggestions([
      { category: "Music", username: "Alan" },
      { category: "Science", username: "Ada" },
      { category: "Science", username: "Grace" },
      { category: "Science", username: "Alan" },
    ]);

    expect(result.map((s) => s.category)).toEqual(["Science", "Music"]);
  });

  it("breaks ties alphabetically so the list stays stable as suggestions arrive", () => {
    const result = aggregateSuggestions([
      { category: "Sports", username: "Ada" },
      { category: "History", username: "Grace" },
      { category: "Music", username: "Alan" },
    ]);

    expect(result.map((s) => s.category)).toEqual(["History", "Music", "Sports"]);
  });

  it("counts distinct players, not rows", () => {
    // The unique constraint should prevent this, but aggregation must not
    // inflate a count if a duplicate ever reaches it.
    const result = aggregateSuggestions([
      { category: "Science", username: "Ada" },
      { category: "Science", username: "Ada" },
    ]);

    expect(result[0]).toMatchObject({ count: 1 });
  });

  it("returns an empty list for no suggestions", () => {
    expect(aggregateSuggestions([])).toEqual([]);
  });
});
