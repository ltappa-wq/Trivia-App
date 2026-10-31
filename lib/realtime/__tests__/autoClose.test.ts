import { describe, expect, it } from "vitest";
import { autoCloseDeadline, canAutoClose, type AutoCloseGame } from "../autoClose";

const reveal = Date.parse("2026-01-01T00:00:00Z");
const game: AutoCloseGame = { status: "active", paused: false, reviewing: false, current_index: 0, reveal_at: new Date(reveal).toISOString(), answer_mode: "multiple_choice" };

describe("participant deadline close", () => {
  it.each([['multiple_choice', 20000], ['type_answer', 35000]] as const)("uses the %s server deadline plus grace", (answer_mode, timer) => {
    const g = { ...game, answer_mode };
    expect(autoCloseDeadline(g)).toBe(reveal + timer + 750);
    expect(canAutoClose(g, reveal + timer)).toBe(false);
    expect(canAutoClose(g, reveal + timer + 749)).toBe(false);
    expect(canAutoClose(g, reveal + timer + 750)).toBe(true);
  });
  it.each([{ status: "lobby" }, { status: "ended" }, { paused: true }, { reviewing: true }, { current_index: -1 }, { reveal_at: null }, { reveal_at: "invalid" }] as Partial<AutoCloseGame>[])("guards phase %j even after deadline", (over) => {
    expect(canAutoClose({ ...game, ...over }, reveal + 100000)).toBe(false);
  });
  it("does not use a previous question's expired countdown", () => {
    expect(canAutoClose({ ...game, current_index: 1, reveal_at: new Date(reveal + 30000).toISOString() }, reveal + 22000)).toBe(false);
  });
});
