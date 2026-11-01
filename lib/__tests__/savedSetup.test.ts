// @vitest-environment jsdom
import { testStorage } from "@/test/stubs/storage";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { clearSavedSetup, parseSavedSetup, readSavedSetup, saveSetup, SAVED_SETUP_KEY } from "@/lib/savedSetup";
beforeEach(() => { Object.defineProperty(window, "localStorage", { configurable: true, get: () => store }); store.clear(); });
const store = testStorage();
const settings = { categories: ["Science", "90s cartoons"], questionCount: 12, answerMode: "type_answer" as const, difficulty: "hard" as const, hostPlays: true, hostName: "Ada" };
afterEach(() => { vi.unstubAllGlobals(); store.clear(); });
describe("saved setup", () => {
  it("round trips known fields and ignores future optional fields", () => {
    saveSetup(settings);
    expect(readSavedSetup()).toEqual(settings);
    expect(parseSavedSetup(JSON.stringify({ version: 1, settings: { ...settings, future: true } }))).toEqual(settings);
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
