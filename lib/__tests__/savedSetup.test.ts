// @vitest-environment jsdom
import { testStorage } from "@/test/stubs/storage";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { clearSavedSetup, parseSavedSetup, readSavedSetup, saveSetup, SAVED_SETUP_KEY } from "@/lib/savedSetup";
beforeEach(() => { Object.defineProperty(window, "localStorage", { configurable: true, get: () => store }); store.clear(); });
const store = testStorage();
const settings = { categories: ["Science", "90s cartoons"], questionCount: 12, answerMode: "type_answer" as const, difficulty: "hard" as const, hostPlays: true, hostName: "Ada" };
const legacyDefaults = { answerTimerMs: null, autoAdvanceMs: null, doublePointsFinale: false };
afterEach(() => { vi.unstubAllGlobals(); store.clear(); });
describe("saved setup", () => {
  it("round trips known fields and ignores future optional fields", () => {
    saveSetup(settings);
    expect(readSavedSetup()).toEqual({ ...settings, ...legacyDefaults });
    expect(parseSavedSetup(JSON.stringify({ version: 1, settings: { ...settings, future: true } }))).toEqual({ ...settings, ...legacyDefaults });
    clearSavedSetup();
    expect(store.getItem(SAVED_SETUP_KEY)).toBeNull();
  });
  it.each(["broken", "null", "{}", JSON.stringify({ version: 0, settings }), JSON.stringify({ version: 2, settings }), JSON.stringify({ version: 1, settings: { ...settings, questionCount: 999 } }), JSON.stringify({ version: 1, settings: { ...settings, hostName: null } })])("ignores corrupt/old data: %s", (json) => expect(parseSavedSetup(json)).toBeNull());
  it("tolerates unavailable storage for every operation", () => {
    vi.stubGlobal("window", { get localStorage() { throw new Error("denied"); } });
    expect(readSavedSetup()).toBeNull();
    expect(() => saveSetup(settings)).not.toThrow();
    expect(() => clearSavedSetup()).not.toThrow();
  });
});

it("reads settings written before pacing fields existed without changing version", () => {
  expect(parseSavedSetup(JSON.stringify({ version: 1, settings }))).toEqual({ ...settings, ...legacyDefaults });
});
it("round trips all three pacing options in version 1", () => {
  const configured = { ...settings, answerTimerMs: 60000, autoAdvanceMs: 8000, doublePointsFinale: true };
  saveSetup(configured);
  expect(JSON.parse(store.getItem(SAVED_SETUP_KEY)!)).toEqual({ version: 1, settings: configured });
  expect(readSavedSetup()).toEqual(configured);
});
it.each([{ answerTimerMs: 35000 }, { autoAdvanceMs: 2000 }, { doublePointsFinale: "true" }])("rejects invalid saved pacing options: %j", options => {
  expect(parseSavedSetup(JSON.stringify({ version: 1, settings: { ...settings, ...options } }))).toBeNull();
});
