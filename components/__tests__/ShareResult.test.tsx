// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ShareResult } from "../ShareResult";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("confirms clipboard fallback only after successful copying", async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  render(<ShareResult standings={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "Share result" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Result copied!"));
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining("I played BUZZR"));
});
it("reports failed copying without a false confirmation", async () => {
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => { throw Error(); }) } });
  render(<ShareResult standings={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "Share result" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Could not share or copy"));
});
