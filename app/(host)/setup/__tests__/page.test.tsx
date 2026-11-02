// @vitest-environment jsdom
import { testStorage } from "@/test/stubs/storage";
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import SetupPage from "../page";
import { readSavedSetup, saveSetup } from "@/lib/savedSetup";
const mocks = vi.hoisted(() => ({ validate: vi.fn(), create: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/app/actions/validateCategory", () => ({ validateCustomCategory: mocks.validate }));
vi.mock("@/app/actions/createGame", () => ({ createGame: mocks.create }));
afterEach(() => { cleanup(); store.clear(); vi.clearAllMocks(); });
beforeEach(() => { Object.defineProperty(window, "localStorage", { configurable: true, get: () => store }); store.clear(); });
const store = testStorage();
const settings = { categories: ["Science", "90s cartoons"], questionCount: 12, answerMode: "type_answer" as const, difficulty: "hard" as const, hostPlays: true, hostName: "Ada" };
it("prefills every saved field only after validating custom topics", async () => {
  saveSetup(settings);
  mocks.validate.mockResolvedValue({ ok: true, category: "90s cartoons" });
  render(<SetupPage />);
  fireEvent.click(await screen.findByText("Use last settings"));
  await waitFor(() => expect((screen.getByLabelText("Your name") as HTMLInputElement).value).toBe("Ada"));
  expect(mocks.validate).toHaveBeenCalledWith("90s cartoons");
  expect((screen.getByRole("checkbox", { name: /Science/ }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText("Number of questions") as HTMLInputElement).value).toBe("12");
  expect((screen.getByLabelText("Type the answer") as HTMLInputElement).checked).toBe(true);
  expect(screen.getByRole("button", { name: "💀 Hard" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "Remove category 90s cartoons" })).toBeTruthy();
  fireEvent.click(screen.getByText("Clear saved settings"));
  expect(screen.queryByText("Use last settings")).toBeNull();
});
it("does not restore rejected custom categories", async () => {
  saveSetup(settings);
  mocks.validate.mockResolvedValue({ ok: false, error: "Too narrow" });
  render(<SetupPage />);
  fireEvent.click(await screen.findByText("Use last settings"));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "90s cartoons: Too narrow");
  expect(screen.queryByRole("button", { name: "Remove category 90s cartoons" })).toBeNull();
});
it("saves only after successful creation, including host-only settings", async () => {
  saveSetup({ ...settings, categories: ["Science"], hostPlays: false });
  mocks.create.mockRejectedValueOnce(new Error("Try again"));
  render(<SetupPage />);
  fireEvent.click(await screen.findByText("Use last settings"));
  await waitFor(() => expect((screen.getByLabelText("I’ll play too") as HTMLInputElement).checked).toBe(false));
  fireEvent.change(screen.getByLabelText("Number of questions"), { target: { value: "15" } });
  fireEvent.click(screen.getByRole("button", { name: "Create game" }));
  await screen.findByText("Couldn’t create the room");
  expect(JSON.parse(store.getItem("buzzr:last-setup")!).settings.questionCount).toBe(12);
  mocks.create.mockResolvedValueOnce({ gameId: "g", code: "12345", hostToken: "t" });
  fireEvent.click(screen.getByText("Retry"));
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/host?code=12345"));
  expect(JSON.parse(store.getItem("buzzr:last-setup")!).settings).toEqual({ ...settings, categories: ["Science"], hostPlays: false, questionCount: 15, answerTimerMs: null, autoAdvanceMs: null, doublePointsFinale: false });
});

it("restores pacing options and saves changed options only after creation succeeds", async () => {
  saveSetup({ ...settings, categories: ["Science"], answerTimerMs: 60000, autoAdvanceMs: 8000, doublePointsFinale: true });
  mocks.create.mockResolvedValueOnce({ gameId: "g", code: "12345", hostToken: "t" });
  render(<SetupPage />);
  fireEvent.click(await screen.findByText("Use last settings"));
  await waitFor(() => expect((screen.getByLabelText("Answer timer") as HTMLSelectElement).value).toBe("60000"));
  expect((screen.getByLabelText("Auto-advance after review") as HTMLSelectElement).value).toBe("8000");
  expect((screen.getByLabelText("Double-points finale") as HTMLInputElement).checked).toBe(true);
  fireEvent.change(screen.getByLabelText("Answer timer"), { target: { value: "10000" } });
  fireEvent.change(screen.getByLabelText("Auto-advance after review"), { target: { value: "15000" } });
  fireEvent.click(screen.getByLabelText("Double-points finale"));
  fireEvent.click(screen.getByRole("button", { name: "Create game" }));
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/host?code=12345"));
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ answerTimerMs: 10000, autoAdvanceMs: 15000, doublePointsFinale: false }), expect.anything());
  expect(readSavedSetup()).toMatchObject({ answerTimerMs: 10000, autoAdvanceMs: 15000, doublePointsFinale: false });
});
it("restoring an older version-1 save resets selected pacing options to legacy defaults", async () => {
  store.setItem("buzzr:last-setup", JSON.stringify({ version: 1, settings: { ...settings, categories: ["Science"] } }));
  render(<SetupPage />);
  fireEvent.change(screen.getByLabelText("Answer timer"), { target: { value: "10000" } });
  fireEvent.change(screen.getByLabelText("Auto-advance after review"), { target: { value: "8000" } });
  fireEvent.click(screen.getByLabelText("Double-points finale"));
  fireEvent.click(await screen.findByText("Use last settings"));
  await waitFor(() => expect((screen.getByLabelText("Answer timer") as HTMLSelectElement).value).toBe(""));
  expect(screen.getByText("Mode default (35 seconds)")).toBeTruthy();
  expect((screen.getByLabelText("Auto-advance after review") as HTMLSelectElement).value).toBe("");
  expect((screen.getByLabelText("Double-points finale") as HTMLInputElement).checked).toBe(false);
});

it("offers mixed and binary modes and restores remembered mixed setup", async () => {
  saveSetup({ ...settings, categories: ["Science"], answerMode: "mixed" });
  render(<SetupPage />);
  expect(screen.getByLabelText("True/false only")).toBeTruthy();
  fireEvent.click(await screen.findByText("Use last settings"));
  await waitFor(() => expect((screen.getByLabelText("Mixed") as HTMLInputElement).checked).toBe(true));
  expect(screen.getByRole("option", { name: /20s choice.*35s typed.*15s true\/false/ })).toBeTruthy();
});
