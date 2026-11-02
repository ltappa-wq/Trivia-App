import { describe, expect, it } from "vitest";
import { parseTipJar } from "../tipJar";

describe("tip jar destinations", () => {
  it.each(["buzzr-demo", "Demo_123", "abc", "A-0_"])("accepts Venmo handle %s", handle => {
    expect(parseTipJar(handle).venmo).toBe(`https://venmo.com/u/${encodeURIComponent(handle)}`);
  });
  it.each(["", "@buzzr", "a/b", "a?b", "a#b", "a b", "a.b", "é", "a\n", "https://venmo.com/u/demo"])("ignores invalid handle %j", handle => {
    expect(parseTipJar(handle).venmo).toBeNull();
  });
  it.each([
    "http://buy.stripe.com/test", "https://stripe.com/test",
    "https://buy.stripe.com.evil.test/test", "https://evil.test/buy.stripe.com",
    "javascript:alert(1)", "/test", "invalid", "",
    "https://user:pass@buy.stripe.com/test", "https://buy.stripe.com:444/test",
  ])("rejects non-allowlisted Stripe URL %s", url => {
    expect(parseTipJar(undefined, url).stripe).toBeNull();
  });
  const stripe = "https://buy.stripe.com/test_buzzr_demo_not_real";
  it("supports both, either, or neither destination independently", () => {
    expect(parseTipJar("buzzr-demo", stripe)).toEqual({ venmo: "https://venmo.com/u/buzzr-demo", stripe });
    expect(parseTipJar(undefined, stripe)).toEqual({ venmo: null, stripe });
    expect(parseTipJar("buzzr-demo", "invalid")).toEqual({ venmo: "https://venmo.com/u/buzzr-demo", stripe: null });
    expect(parseTipJar()).toEqual({ venmo: null, stripe: null });
    expect(parseTipJar("bad/handle", "invalid")).toEqual({ venmo: null, stripe: null });
  });
});
