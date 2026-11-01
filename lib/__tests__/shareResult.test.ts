import { describe, expect, it, vi } from "vitest";
import { resultShareData, shareResult } from "../shareResult";
const standings = [{ id: "a", username: "Secret name", score: 100 }, { id: "b", username: "B", score: 50 }, { id: "c", username: "C", score: 50 }];
const data = resultShareData(standings, "c", "https://example.com/play?code=12345#token=secret");
describe("result sharing", () => {
  it("uses tied placement and strips all room/credential information", () => {
    expect(data).toEqual({ title: "BUZZR trivia", text: "I placed 2nd of 3 in BUZZR trivia 🏆", url: "https://example.com/" });
    expect(resultShareData(standings, "spectator", "https://example.com").text).toBe("I played BUZZR trivia 🏆");
  });
  it("uses native sharing when available", async () => {
    const share = vi.fn(async () => {}); const writeText = vi.fn();
    expect(await shareResult(data, { share, clipboard: { writeText } as unknown as Clipboard })).toBe("shared");
    expect(share).toHaveBeenCalledWith(data); expect(writeText).not.toHaveBeenCalled();
  });
  it("falls back to clipboard if native sharing is missing or fails", async () => {
    const writeText = vi.fn(async () => {});
    const browser = { share: undefined as unknown as Navigator["share"], clipboard: { writeText } as unknown as Clipboard };
    expect(await shareResult(data, browser)).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(`${data.text}\nhttps://example.com/`);
    browser.share = vi.fn(async () => { throw Error("unsupported"); });
    expect(await shareResult(data, browser)).toBe("copied");
  });
  it("cancels quietly and never claims a failed clipboard write succeeded", async () => {
    const writeText = vi.fn(async () => { throw Error("denied"); });
    const browser = { share: vi.fn(async () => { throw new DOMException("cancel", "AbortError"); }), clipboard: { writeText } as unknown as Clipboard };
    expect(await shareResult(data, browser)).toBe("cancelled"); expect(writeText).not.toHaveBeenCalled();
    browser.share = vi.fn(async () => { throw Error(); });
    await expect(shareResult(data, browser)).rejects.toThrow("denied");
  });
});
