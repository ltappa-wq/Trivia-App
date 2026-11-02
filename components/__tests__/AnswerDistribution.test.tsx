// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { AnswerDistribution } from "../AnswerDistribution";
afterEach(cleanup);
it("exposes distribution and correctness without relying on colour or decorative glyphs", () => {
  render(<AnswerDistribution dist={{ index: 0, mode: "multiple_choice", counts: [1, 0], options: ["Paris", "Rome"], total: 1, correct_option: 0 }} />);
  expect(screen.getByRole("group", { name: "Answer distribution" })).toBeTruthy();
  expect(screen.getByText(/Correct/).getAttribute("aria-hidden")).toBeNull();
  expect(screen.getByText("1 · 100%")).toBeTruthy();
});
