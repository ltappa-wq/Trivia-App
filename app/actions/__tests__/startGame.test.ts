import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameRow } from "@/lib/db/types";

// U8 / R9 / R10 / AE8. Generation moved off createGame, which makes "joinable
// room with zero questions" a legal state for the first time. These pin the
// guards that keep that safe: who may start, what a double-tap does, and what
// survives a generation failure (everything — the room and its players).

const authorizeHostByCode = vi.fn();
const generateAndPersistQuestions = vi.fn();
const advance = vi.fn();
const from = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({ from }),
}));
vi.mock("@/lib/serverAuth", () => ({
  authorizeHostByCode: (...args: unknown[]) => authorizeHostByCode(...args),
}));
vi.mock("@/app/actions/generate", () => ({
  generateAndPersistQuestions: (...args: unknown[]) => generateAndPersistQuestions(...args),
}));
vi.mock("@/app/actions/advance", () => ({
  advance: (...args: unknown[]) => advance(...args),
}));

function game(over: Partial<GameRow> = {}): GameRow {
  return {
    id: "game-1",
    code: "12345",
    host_token_hash: "hash",
    status: "lobby",
    categories: ["History", "Science"],
    question_count: 10,
    answer_mode: "multiple_choice",
    difficulty: "medium",
    current_index: -1,
    reveal_at: null,
    paused: false,
    reviewing: false,
    created_at: new Date().toISOString(),
    ...over,
  } as GameRow;
}

/** Wire the two table calls startGame makes: a questions count and a games update. */
function wireTables({ questionCount = 0, updateError = null as { message: string } | null, claimed = true } = {}) {
  const chain = {
    eq: vi.fn(() => chain),
    or: vi.fn(() => chain),
    select: vi.fn(async () => ({ data: claimed ? [{ id: "game-1" }] : [], error: updateError })),
    then: (resolve: (value: unknown) => void) => Promise.resolve({ error: updateError }).then(resolve),
  };
  const updateEq = chain.eq;
  const update = vi.fn((_patch: Record<string, unknown>) => chain);
  const deleteFn = vi.fn(() => ({ eq: async () => ({ error: null }) }));
  from.mockImplementation((table: string) => {
    if (table === "questions") {
      return {
        select: () => ({ eq: async () => ({ count: questionCount }) }),
      };
    }
    if (table === "games") {
      return { update, delete: deleteFn };
    }
    throw new Error(`unexpected table ${table}`);
  });
  return { updateEq, deleteFn, update };
}

beforeEach(() => {
  vi.clearAllMocks();
  advance.mockResolvedValue({
    status: "advanced",
    index: 0,
    revealAt: new Date().toISOString(),
    timerMs: 20_000,
  });
  generateAndPersistQuestions.mockResolvedValue(10);
});

describe("startGame — authorization (U8)", () => {
  it("rejects an invalid host token and generates nothing", async () => {
    wireTables();
    authorizeHostByCode.mockRejectedValue(new Error("Not authorized"));
    const { startGame } = await import("../startGame");

    await expect(startGame("12345", "wrong-token")).rejects.toThrow("Not authorized");
    expect(generateAndPersistQuestions).not.toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
  });

  it("refuses to start a game that has already ended", async () => {
    wireTables();
    authorizeHostByCode.mockResolvedValue(game({ status: "ended" }));
    const { startGame } = await import("../startGame");

    await expect(startGame("12345", "host-token")).rejects.toThrow(/ended/i);
    expect(generateAndPersistQuestions).not.toHaveBeenCalled();
  });
});

describe("startGame — generation and start (U8, R9)", () => {
  it("generates the set for a lobby room and reveals the first question", async () => {
    wireTables({ questionCount: 0 });
    authorizeHostByCode.mockResolvedValue(game());
    const { startGame } = await import("../startGame");

    const result = await startGame("12345", "host-token");

    expect(generateAndPersistQuestions).toHaveBeenCalledWith("game-1", {
      categories: ["History", "Science"],
      count: 10,
      mode: "multiple_choice",
      difficulty: "medium",
    }, expect.any(Function));
    expect(advance).toHaveBeenCalledWith("12345", "host-token", -1);
    expect(result).toMatchObject({ status: "started", index: 0 });
  });

  it("AE7: merges accepted suggestions with the host's own categories", async () => {
    wireTables({ questionCount: 0 });
    authorizeHostByCode.mockResolvedValue(game());
    const { startGame } = await import("../startGame");

    await startGame("12345", "host-token", ["Music"]);

    const [, params] = generateAndPersistQuestions.mock.calls[0];
    expect(params.categories).toContain("History");
    expect(params.categories).toContain("Science");
    expect(params.categories).toContain("Music");
  });

  it("leaves the stored categories untouched when nothing was accepted", async () => {
    const { update } = wireTables({ questionCount: 0 });
    authorizeHostByCode.mockResolvedValue(game());
    const { startGame } = await import("../startGame");

    await startGame("12345", "host-token", []);

    expect(update.mock.calls.every(([patch]) => !("categories" in patch))).toBe(true);
    const [, params] = generateAndPersistQuestions.mock.calls[0];
    expect(params.categories).toEqual(["History", "Science"]);
  });

  it("rejects an accepted set that would exceed the category cap", async () => {
    wireTables({ questionCount: 0 });
    // 10 is CATEGORIES_MAX; one more must fail rather than silently truncating.
    authorizeHostByCode.mockResolvedValue(
      game({
        categories: [
          "History", "Science", "Geography", "Sports", "Music",
          "Technology", "Mythology", "Celebrities", "Weird Facts", "Space & Astronomy",
        ],
      }),
    );
    const { startGame } = await import("../startGame");

    await expect(startGame("12345", "host-token", ["Movies & TV"])).rejects.toThrow(/at most/i);
    expect(generateAndPersistQuestions).not.toHaveBeenCalled();
  });
});

describe("startGame — double-tap protection (U8)", () => {
  it("does not generate a second set when questions already exist", async () => {
    wireTables({ questionCount: 10 });
    authorizeHostByCode.mockResolvedValue(game({ status: "active", current_index: 3 }));
    const { startGame } = await import("../startGame");

    const result = await startGame("12345", "host-token");

    expect(generateAndPersistQuestions).not.toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "already_started", index: 3 });
  });

  it("reveals the first question without regenerating when a retry finds questions banked", async () => {
    // Generation succeeded but the reveal failed; the retry must not pay twice.
    wireTables({ questionCount: 10 });
    authorizeHostByCode.mockResolvedValue(game({ status: "lobby", current_index: -1 }));
    const { startGame } = await import("../startGame");

    const result = await startGame("12345", "host-token");

    expect(generateAndPersistQuestions).not.toHaveBeenCalled();
    expect(advance).toHaveBeenCalledWith("12345", "host-token", -1);
    expect(result).toMatchObject({ status: "started" });
  });
});

describe("AE8: a generation failure leaves the room intact (U8)", () => {
  it("surfaces the error, keeps the room in lobby, and never advances", async () => {
    const { deleteFn } = wireTables({ questionCount: 0 });
    authorizeHostByCode.mockResolvedValue(game());
    generateAndPersistQuestions.mockRejectedValue(new Error("xAI returned 500"));
    const { startGame } = await import("../startGame");

    await expect(startGame("12345", "host-token")).resolves.toMatchObject({ status: "generation_failed", message: "xAI returned 500" });

    // The old createGame path deleted the room here. Players are seated by the
    // time this runs now, so the room must survive for the host to retry into.
    expect(deleteFn).not.toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
  });

  it("a retry after a failure generates and starts successfully", async () => {
    wireTables({ questionCount: 0 });
    authorizeHostByCode.mockResolvedValue(game());
    generateAndPersistQuestions.mockRejectedValueOnce(new Error("xAI returned 500"));
    const { startGame } = await import("../startGame");

    await expect(startGame("12345", "host-token")).resolves.toMatchObject({ status: "generation_failed" });
    const result = await startGame("12345", "host-token");

    expect(result).toMatchObject({ status: "started" });
    expect(generateAndPersistQuestions).toHaveBeenCalledTimes(2);
  });

  it("releases the concurrency slot after a failure so retries are not blocked", async () => {
    wireTables({ questionCount: 0 });
    authorizeHostByCode.mockResolvedValue(game());
    generateAndPersistQuestions.mockRejectedValue(new Error("boom"));
    const { startGame } = await import("../startGame");

    // Four sequential failures — more than MAX_CONCURRENT_GENERATIONS. If the
    // slot leaked on the error path, the later ones would report "server busy"
    // instead of the real failure and the room would be permanently unstartable.
    for (let i = 0; i < 4; i++) {
      await expect(startGame("12345", "host-token")).resolves.toMatchObject({ status: "generation_failed", message: "boom" });
    }
  });
});

describe("R5: progress and host-visible failures", () => {
  it("reads persisted progress only after host authorization", async () => {
    authorizeHostByCode.mockResolvedValue(game({ question_count: 100, generation_progress: 36,
      generation_started_at: new Date().toISOString() }));
    const { getGenerationProgress } = await import("../startGame");
    await expect(getGenerationProgress("12345", "host-token"))
      .resolves.toMatchObject({ completed: 36, total: 100, running: true });
    authorizeHostByCode.mockRejectedValue(new Error("Not authorized"));
    await expect(getGenerationProgress("12345", "wrong")).rejects.toThrow("Not authorized");
  });

  it.each(["provider", "invalid_output"] as const)("returns an unredacted %s message and supports retry", async (kind) => {
    wireTables();
    authorizeHostByCode.mockResolvedValue(game());
    const { GenerationError } = await import("@/lib/generation/xai");
    generateAndPersistQuestions.mockRejectedValueOnce(new GenerationError("internal details", kind));
    const { startGame } = await import("../startGame");
    const failure = await startGame("12345", "host-token");
    expect(failure).toMatchObject({ status: "generation_failed",
      message: expect.stringMatching(kind === "provider" ? /provider.*retry/i : /valid, distinct.*retry/i) });
    expect(advance).not.toHaveBeenCalled();
    await expect(startGame("12345", "host-token")).resolves.toMatchObject({ status: "started" });
  });
});

it("R5: rejects a second generation when another instance owns the room lease", async () => {
  wireTables({ claimed: false });
  authorizeHostByCode.mockResolvedValue(game());
  const { startGame } = await import("../startGame");
  await expect(startGame("12345", "host-token")).resolves.toMatchObject({
    status: "generation_failed", message: expect.stringMatching(/already being prepared/),
  });
  expect(generateAndPersistQuestions).not.toHaveBeenCalled();
});

it("R5: persists accepted-question progress from the generation callback", async () => {
  const { update } = wireTables();
  authorizeHostByCode.mockResolvedValue(game({ question_count: 100 }));
  generateAndPersistQuestions.mockImplementationOnce(async (_id, _params, onProgress) => {
    await onProgress(36);
    await onProgress(100);
  });
  const { startGame } = await import("../startGame");
  await startGame("12345", "host-token");
  expect(update).toHaveBeenCalledWith({ generation_progress: 36 });
  expect(update).toHaveBeenCalledWith({ generation_progress: 100 });
});
