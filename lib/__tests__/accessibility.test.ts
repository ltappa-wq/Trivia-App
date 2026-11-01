// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { answerKeyIndex, focusPhase, phaseAnnouncement, timeWarning } from "../accessibility";

describe("phase accessibility policies", () => {
  it("announces phase transitions and question numbers", () => {
    expect(phaseAnnouncement("get_ready", 1)).toContain("question 2");
    expect(phaseAnnouncement("question", 1)).toContain("Answer now");
    expect(phaseAnnouncement("review", 0)).toContain("Answers locked");
    expect(phaseAnnouncement("paused", 0)).toContain("disabled");
    expect(phaseAnnouncement("ended", 0)).toContain("Final results");
    expect(phaseAnnouncement("lobby", 0)).toBe("");
  });
  it("keeps warning text stable between thresholds rather than announcing ticks", () => {
    expect(timeWarning(11000)).toBe("");
    expect(timeWarning(10000)).toBe(timeWarning(6000));
    expect(timeWarning(5000)).toBe(timeWarning(1000));
    expect(timeWarning(0)).toBe("Time is up.");
  });
  it("focuses the new phase heading without changing scroll", () => {
    const container = document.createElement("div");
    container.innerHTML = '<h2 tabindex="-1">Question</h2><button>Answer</button>';
    document.body.append(container);
    focusPhase(container);
    expect(document.activeElement).toBe(container.querySelector("h2"));
    container.remove();
    expect(() => focusPhase(null)).not.toThrow();
  });
  it("wraps arrow navigation and bounds numbered shortcuts", () => {
    expect(answerKeyIndex("ArrowLeft", 0, 4)).toBe(3);
    expect(answerKeyIndex("ArrowDown", 3, 4)).toBe(0);
    expect(answerKeyIndex("Home", 2, 4)).toBe(0);
    expect(answerKeyIndex("End", 1, 4)).toBe(3);
    expect(answerKeyIndex("2", 0, 4)).toBe(1);
    expect(answerKeyIndex("5", 0, 4)).toBeNull();
    expect(answerKeyIndex("Tab", 0, 4)).toBeNull();
    expect(answerKeyIndex("1", 0, 0)).toBeNull();
  });
});
