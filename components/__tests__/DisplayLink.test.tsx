// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const { update } = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("@/app/actions/displayLink", () => ({ updateDisplayLink: update }));
import { DisplayLink } from "../DisplayLink";
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("host opens and regenerates fragment-only links and revokes without navigation", async () => {
  update.mockResolvedValueOnce("a".repeat(43)).mockResolvedValueOnce("b".repeat(43)).mockResolvedValueOnce(null);
  render(<DisplayLink code="12345" token="host" />);
  fireEvent.click(screen.getByRole("button", { name: "Open TV display" }));
  const link = await screen.findByRole("link", { name: "Open read-only TV screen" });
  expect(link.getAttribute("href")).toContain(`/display?code=12345#t=${"a".repeat(43)}`);
  expect(screen.getByRole("img", { name: "Scan to open the private TV display" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Regenerate TV display link" }));
  await waitFor(() => expect(link.getAttribute("href")).toContain(`t=${"b".repeat(43)}`));
  fireEvent.click(screen.getByRole("button", { name: "Revoke TV display link" }));
  await waitFor(() => expect(screen.queryByRole("link")).toBeNull());
  expect(update).toHaveBeenLastCalledWith("12345", "host", true);
});
it("reports link update errors", async () => {
  update.mockRejectedValueOnce(new Error("failed"));
  render(<DisplayLink code="12345" token="host" />);
  fireEvent.click(screen.getByRole("button", { name: "Open TV display" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
});
it("focuses the ready link, announces updates and restores focus after revoke", async () => {
  update.mockResolvedValueOnce("c".repeat(43)).mockResolvedValueOnce(null);
  render(<DisplayLink code="12345" token="host" />);
  const opener = screen.getByRole("button", { name: "Open TV display" });
  fireEvent.click(opener);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("link", { name: "Open read-only TV screen" })));
  expect(screen.getByRole("status").textContent).toContain("link ready");
  fireEvent.click(screen.getByRole("button", { name: "Revoke TV display link" }));
  await waitFor(() => expect(document.activeElement).toBe(opener));
  expect(screen.getByRole("status").textContent).toContain("revoked");
});
