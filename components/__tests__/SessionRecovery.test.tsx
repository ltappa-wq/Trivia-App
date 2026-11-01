// @vitest-environment jsdom
import { testStorage } from "@/test/stubs/storage";
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionRecovery, SaveHostLink } from "../SessionRecovery";
import { clearCredential, loadHostCredential, loadPlayerCredential, saveHostCredential, savePlayerCredential } from "@/lib/clientSession";
import JoinPage from "@/app/(play)/join/page";
import { CATEGORIES } from "@/lib/gameConfig";
const { hydrate, joinGame, push } = vi.hoisted(() => ({ hydrate: vi.fn(), joinGame: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/actions/joinGame", () => ({ joinGame }));
vi.mock("@/lib/realtime/channel", () => ({ hydrate }));
const host = { code: "12345", gameId: "g", token: "h" };
beforeEach(() => {
  joinGame.mockReset().mockResolvedValue({ code: "12345", token: "new", username: "Sam" });
  push.mockReset();
  const persistent = testStorage(), tab = testStorage();
  Object.defineProperty(window, "localStorage", { configurable: true, get: () => persistent });
  Object.defineProperty(window, "sessionStorage", { configurable: true, get: () => tab });
  window.localStorage.clear(); window.sessionStorage.clear();
  clearCredential("host", "12345"); clearCredential("player", "12345");
  hydrate.mockReset().mockImplementation(async (token: string) => ({ role: token === "h" ? "host" : "player", game: { code: "12345", status: "lobby" } }));
});
afterEach(cleanup);
it("offers verified host and player recovery", async () => {
  saveHostCredential(host); savePlayerCredential({ code: "12345", token: "p", username: "Alex" });
  render(<SessionRecovery />);
  expect(await screen.findByText("Resume hosting room 12345")).toBeTruthy();
  expect(await screen.findByText("Rejoin room 12345 as Alex")).toBeTruthy();
});
it("offers the remembered seat only for the entered code", async () => {
  savePlayerCredential({ code: "12345", token: "p", username: "Alex" });
  const { rerender } = render(<><SessionRecovery code="99999" /><p>Create a seat</p></>);
  expect(screen.queryByText("Rejoin as Alex")).toBeNull();
  expect(screen.getByText("Create a seat")).toBeTruthy();
  rerender(<><SessionRecovery code="12345" /><p>Create a seat</p></>);
  expect(await screen.findByText("Rejoin as Alex")).toBeTruthy();
  expect(screen.getByText("Create a seat")).toBeTruthy();
});
it("removes invalid credentials", async () => {
  savePlayerCredential({ code: "12345", token: "p", username: "Alex" });
  hydrate.mockResolvedValue(null); render(<SessionRecovery />);
  await waitFor(() => expect(loadPlayerCredential("12345")).toBeNull());
  expect(screen.queryByText(/Rejoin room/)).toBeNull();
});
it("preserves identity on network failure without offering an unverified room", async () => {
  savePlayerCredential({ code: "12345", token: "p", username: "Alex" });
  hydrate.mockRejectedValue(Error("offline")); render(<SessionRecovery />);
  await waitFor(() => expect(hydrate).toHaveBeenCalled());
  expect(loadPlayerCredential("12345")).toBeTruthy(); expect(screen.queryByText(/Rejoin room/)).toBeNull();
});
it("explains private host link authority", () => {
  render(<SaveHostLink credential={host} />);
  expect(screen.getByText(/anyone with the link can control/)).toBeTruthy();
});

it.each([undefined, "12345"])("hides ended offers while retaining results identity (code %s)", async code => {
  saveHostCredential({ ...host, playerToken: "p", username: "Alex" });
  savePlayerCredential({ code: "12345", token: "p", username: "Alex" });
  hydrate.mockResolvedValue({ role: "player", game: { code: "12345", status: "ended" } });
  render(<SessionRecovery code={code} />);
  await waitFor(() => expect(hydrate).toHaveBeenCalled());
  expect(screen.queryByText(/Resume hosting|Rejoin/)).toBeNull();
  expect(loadPlayerCredential("12345")?.token).toBe("p");
  expect(loadHostCredential("12345")?.token).toBe("h");
});

it("keeps the join form mounted and editable when a remembered room is entered", async () => {
  savePlayerCredential({ code: "12345", token: "p", username: "Alex" });
  render(<JoinPage />);
  const code = screen.getByLabelText("Room code") as HTMLInputElement;
  const username = screen.getByLabelText("Username") as HTMLInputElement;
  fireEvent.change(code, { target: { value: "1234" } });
  fireEvent.change(username, { target: { value: "Sam" } });
  fireEvent.click(screen.getByRole("button", { name: CATEGORIES[0] }));
  fireEvent.change(code, { target: { value: "12345" } });
  expect(await screen.findByText("Rejoin as Alex")).toBeTruthy();
  expect(screen.getByLabelText("Room code")).toBe(code);
  expect(screen.getByLabelText("Username")).toBe(username);
  expect(username.value).toBe("Sam");
  expect(screen.getByRole("button", { name: CATEGORIES[0] }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.change(code, { target: { value: "99999" } });
  expect(code.value).toBe("99999");
  expect(screen.queryByText("Rejoin as Alex")).toBeNull();
  fireEvent.change(code, { target: { value: "12345" } });
  await screen.findByText("Rejoin as Alex");
  fireEvent.click(screen.getByRole("button", { name: "Join" }));
  await waitFor(() => expect(joinGame).toHaveBeenCalledWith("12345", "Sam", [CATEGORIES[0]]));
  expect(push).toHaveBeenCalledWith("/play?code=12345");
});
