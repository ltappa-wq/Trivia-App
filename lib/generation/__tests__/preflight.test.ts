import { describe, expect, it, vi } from "vitest";
import {
  checkCategoryFeasibility,
  formatFeasibilityError,
  splitPresetAndCustom,
} from "../preflight";
import { GenerationError } from "../xai";

function mockFetch(body: unknown, status = 200) {
  return vi.fn(async () => {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(body) } }],
      }),
    } as unknown as Response;
  });
}

describe("splitPresetAndCustom", () => {
  it("separates expanded presets from free-text", () => {
    const { presets, customs } = splitPresetAndCustom([
      "Geography",
      "90s Sitcoms",
      "history",
    ]);
    expect(presets.map((p) => p.toLowerCase())).toEqual(
      expect.arrayContaining(["geography", "history"]),
    );
    expect(customs).toEqual(["90s Sitcoms"]);
  });
});

describe("checkCategoryFeasibility", () => {
  it("skips the model when only presets are selected", async () => {
    const fetchImpl = mockFetch({});
    const result = await checkCategoryFeasibility(["Geography", "History"], {
      apiKey: "k",
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts when all customs are feasible", async () => {
    const fetchImpl = mockFetch({
      results: [{ category: "90s Sitcoms", feasible: true, reason: "" }],
    });
    const result = await checkCategoryFeasibility(["Geography", "90s Sitcoms"], {
      apiKey: "k",
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns rejected customs with reasons", async () => {
    const fetchImpl = mockFetch({
      results: [
        {
          category: "My private nicknames",
          feasible: false,
          reason: "Private knowledge, not public trivia",
        },
      ],
    });
    const result = await checkCategoryFeasibility(["My private nicknames"], {
      apiKey: "k",
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejected[0]?.category).toBe("My private nicknames");
      expect(result.rejected[0]?.reason).toMatch(/Private/);
    }
  });

  it("fails closed when the model omits a category", async () => {
    const fetchImpl = mockFetch({
      results: [{ category: "Other", feasible: true, reason: "" }],
    });
    await expect(
      checkCategoryFeasibility(["90s Sitcoms"], { apiKey: "k", fetchImpl }),
    ).rejects.toBeInstanceOf(GenerationError);
  });

  it("throws when the API key is missing", async () => {
    await expect(
      checkCategoryFeasibility(["Custom Topic"], { apiKey: "" }),
    ).rejects.toBeInstanceOf(GenerationError);
  });

  it("throws on non-OK HTTP", async () => {
    const fetchImpl = mockFetch({}, 500);
    await expect(
      checkCategoryFeasibility(["Custom Topic"], { apiKey: "k", fetchImpl }),
    ).rejects.toBeInstanceOf(GenerationError);
  });
});

describe("formatFeasibilityError", () => {
  it("lists rejected categories for the setup alert", () => {
    const msg = formatFeasibilityError([
      { category: "Foo", reason: "too vague" },
    ]);
    expect(msg).toContain("Foo");
    expect(msg).toContain("too vague");
  });
});
