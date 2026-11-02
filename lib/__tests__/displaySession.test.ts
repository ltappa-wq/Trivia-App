// @vitest-environment jsdom
import { testStorage } from "@/test/stubs/storage";
import { beforeEach, describe, expect, it } from "vitest";
import { clearDisplayToken, consumeDisplayToken, displayUrl } from "../displaySession";
const token = "a".repeat(43);
beforeEach(() => {
  for (const name of ["localStorage", "sessionStorage"] as const) {
    const store = testStorage();
    Object.defineProperty(window, name, { configurable: true, get: () => store });
  }
  clearDisplayToken("12345"); window.history.replaceState(null, "", "/display?code=12345"); });
describe("TV fragment credential", () => {
  it("puts credentials only in the fragment and scrubs before returning", () => {
    const url = displayUrl(window.location.origin, "12345", token);
    expect(new URL(url).search).toBe("?code=12345");
    window.history.replaceState(null, "", url);
    expect(consumeDisplayToken("12345")).toBe(token);
    expect(window.location.hash).toBe("");
    expect(window.localStorage.getItem("trivia:display:12345")).toBeNull();
    expect(consumeDisplayToken("12345")).toBe(token);
    expect(consumeDisplayToken("54321")).toBeNull();
  });
  it.each(["#t=bad", "#unexpected=secret", `#t=${token}`])("scrubs malformed room/fragment %s", fragment => {
    window.history.replaceState(null, "", `/display?code=bad${fragment}`);
    expect(consumeDisplayToken("bad")).toBeNull();
    expect(window.location.hash).toBe("");
  });
  it("forgets revoked credentials and rejects malformed replacement fragments", () => {
    window.history.replaceState(null, "", `#t=${token}`);
    consumeDisplayToken("12345");
    clearDisplayToken("12345");
    expect(consumeDisplayToken("12345")).toBeNull();
    window.history.replaceState(null, "", "#t=bad");
    expect(consumeDisplayToken("12345")).toBeNull();
    expect(window.location.hash).toBe("");
  });
});
