// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Rematch } from "../Rematch";
import { clearCredential, loadHostCredential, loadPlayerCredential, saveHostCredential, savePlayerCredential } from "@/lib/clientSession";
const m = vi.hoisted(() => ({ create: vi.fn(), join: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: m.replace }) }));
vi.mock("@/app/actions/rematch", () => ({ createRematch: m.create, joinRematch: m.join }));
beforeEach(() => {
  vi.clearAllMocks();
  for (const code of ["12345", "54321"]) for (const kind of ["host", "player"] as const) clearCredential(kind, code);
  savePlayerCredential({ code: "12345", token: "old-player", username: "Alex" });
  m.create.mockResolvedValue({ gameId: "new", code: "54321", hostToken: "new-host" });
  m.join.mockResolvedValue({ code: "54321", token: "new-player", username: "Alex (2)", playerId: "p", isSpectator: false });
});
afterEach(cleanup);
it("automatically transfers a hydrated rematch and stores the returned credential before navigation", async () => {
  m.replace.mockImplementation(() => expect(loadPlayerCredential("54321")?.token).toBe("new-player"));
  render(<Rematch code="12345" rematchCode="54321" />);
  await waitFor(() => expect(m.replace).toHaveBeenCalledWith("/play?code=54321"));
  expect(m.join).toHaveBeenCalledWith("12345", "old-player");
  expect(loadPlayerCredential("54321")?.username).toBe("Alex (2)");
  expect(m.create).not.toHaveBeenCalled();
});
it("keeps host and player credentials and prevents double clicks", async () => {
  saveHostCredential({ gameId: "old", code: "12345", token: "old-host", playerToken: "old-player" });
  render(<Rematch code="12345" host />);
  const button = screen.getByText("Play again (same players)");
  fireEvent.click(button); fireEvent.click(button);
  await waitFor(() => expect(m.replace).toHaveBeenCalledWith("/host?code=54321"));
  expect(m.create).toHaveBeenCalledTimes(1);
  expect(loadHostCredential("54321")).toMatchObject({ token: "new-host", playerToken: "new-player", username: "Alex (2)" });
});
it("keeps a host-only host unseated", async () => {
  saveHostCredential({ gameId: "old", code: "12345", token: "old-host" });
  render(<Rematch code="12345" host />);
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(m.replace).toHaveBeenCalled());
  expect(m.join).not.toHaveBeenCalled();
});
it("preserves old credentials and permits retry on a failed transfer", async () => {
  m.join.mockRejectedValueOnce(new Error("Offline"));
  render(<Rematch code="12345" rematchCode="54321" />);
  expect((await screen.findByRole("alert")).textContent).toBe("Offline");
  expect(loadPlayerCredential("12345")?.token).toBe("old-player");
  expect(m.replace).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(m.replace).toHaveBeenCalled());
});
it("announces automatic transfer while the next-game request is pending", async () => {
  let release!: (value: { code: string; token: string; username: string; playerId: string; isSpectator: boolean }) => void;
  m.join.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  render(<Rematch code="12345" rematchCode="54321" />);
  expect(screen.getByRole("status").textContent).toContain("Joining the next game");
  release({ code: "54321", token: "new-player", username: "Alex", playerId: "p", isSpectator: false });
  await waitFor(() => expect(m.replace).toHaveBeenCalledWith("/play?code=54321"));
});
