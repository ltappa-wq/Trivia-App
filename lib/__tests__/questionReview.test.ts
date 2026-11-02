import { expect, it } from "vitest";
import { removeReviewQuestion } from "../questionReview";

it.each(["a", "b", "c"])("removes %s and renumbers contiguously without mutating the source", (id) => {
  const source = ["a", "b", "c"].map((id, index) => ({ id, index }));
  const result = removeReviewQuestion(source, id);
  expect(result).toHaveLength(2);
  expect(result.map((q) => q.index)).toEqual([0, 1]);
  expect(result.some((q) => q.id === id)).toBe(false);
  expect(source.map((q) => q.index)).toEqual([0, 1, 2]);
});
it("refuses last-question deletion and stale IDs", () => {
  expect(() => removeReviewQuestion([{ id: "a", index: 0 }], "a")).toThrow(/one question/);
  expect(() => removeReviewQuestion([{ id: "a", index: 0 }], "b")).toThrow(/no longer exists/);
});
