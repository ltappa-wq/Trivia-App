// @vitest-environment jsdom
import { testStorage } from "@/test/stubs/storage";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { saveHostCredential, loadHostCredential, loadPlayerCredential, savePlayerCredential, clearCredential, consumeHostRecovery, hostRecoveryUrl, CREDENTIAL_TTL } from "../clientSession";
const host = { code: "12345", gameId: "game", token: "host&secret", playerToken: "player", username: "Alex" };
beforeEach(() => {
  const persistent = testStorage(), tab = testStorage();
  Object.defineProperty(window, "localStorage", { configurable: true, get: () => persistent });
  Object.defineProperty(window, "sessionStorage", { configurable: true, get: () => tab }); window.localStorage.clear(); window.sessionStorage.clear(); clearCredential("host", "12345"); clearCredential("player", "12345"); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
it("persists, refreshes on use, and expires", () => {
  vi.useFakeTimers(); saveHostCredential(host);
  expect(window.localStorage.getItem("trivia:host:12345")).toContain("expiresAt");
  vi.advanceTimersByTime(CREDENTIAL_TTL - 1); expect(loadHostCredential(host.code)?.token).toBe(host.token);
  vi.advanceTimersByTime(CREDENTIAL_TTL); expect(loadHostCredential(host.code)).toBeNull();
});
it("migrates legacy session storage", () => {
  window.sessionStorage.setItem("trivia:host:12345", JSON.stringify(host));
  expect(loadHostCredential(host.code)?.token).toBe(host.token);
  expect(window.localStorage.getItem("trivia:host:12345")).toContain("expiresAt");
});
it("discards corrupt and malformed data", () => {
  window.localStorage.setItem("trivia:host:12345", "{"); expect(loadHostCredential(host.code)).toBeNull();
  window.sessionStorage.setItem("trivia:host:12345", '{"token":2}'); expect(loadHostCredential(host.code)).toBeNull();
});
it("works when storage is unavailable", () => {
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw Error("blocked"); });
  vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => { throw Error("blocked"); });
  savePlayerCredential({ code: "12345", token: "p", username: "Alex" });
  expect(loadPlayerCredential("12345")?.username).toBe("Alex");
});
it("round trips and scrubs private host fragments including player identity", () => {
  const url = hostRecoveryUrl(window.location.origin, host);
  expect(new URL(url).search).not.toContain("secret");
  window.history.replaceState({}, "", url);
  expect(consumeHostRecovery("12345")?.token).toBe(host.token);
  expect(window.location.hash).toBe("");
  expect(loadPlayerCredential("12345")?.token).toBe("player");
});
it("scrubs malformed fragments without saving", () => {
  window.history.replaceState({}, "", "/host?code=12345#t=secret");
  expect(consumeHostRecovery("12345")).toBeNull(); expect(window.location.hash).toBe("");
});
