// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { GameOptionsFields } from "../GameOptionsFields";
import { ReviewAutoAdvance } from "../ReviewAutoAdvance";
import { GetReady } from "../GetReady";
import { QuestionStage } from "../QuestionStage";
import type { GameOptionsInput } from "@/lib/gameConfig";
import type { ClientGame } from "@/lib/db/types";

afterEach(cleanup);
function Setup() {
  const [value, setValue] = useState<GameOptionsInput>({});
  return <><GameOptionsFields value={value} onChange={setValue} answerMode="type_answer" /><output>{JSON.stringify(value)}</output></>;
}
const game: ClientGame = { id: "g", code: "12345", status: "active", answer_mode: "multiple_choice", difficulty: "medium", question_count: 3, current_index: 0, reveal_at: null, paused: false, reviewing: true, auto_advance_ms: 8000, auto_advance_at: new Date(Date.now() + 8000).toISOString() };

it("setup defaults to per-mode timing with optional automation and finale off", () => {
  render(<Setup />);
  expect((screen.getByLabelText("Answer timer") as HTMLSelectElement).value).toBe("");
  expect(screen.getByText("Mode default (35 seconds)")).toBeTruthy();
  expect((screen.getByLabelText("Auto-advance after review") as HTMLSelectElement).value).toBe("");
  expect((screen.getByLabelText("Double-points finale") as HTMLInputElement).checked).toBe(false);
  fireEvent.change(screen.getByLabelText("Answer timer"), { target: { value: "60000" } });
  fireEvent.change(screen.getByLabelText("Auto-advance after review"), { target: { value: "8000" } });
  fireEvent.click(screen.getByLabelText("Double-points finale"));
  expect(screen.getByRole("status").textContent).toBe(JSON.stringify({ answerTimerMs: 60000, autoAdvanceMs: 8000, doublePointsFinale: true }));
});

it("host can pause and restart the current review schedule", () => {
  const toggle = vi.fn();
  const view = render(<ReviewAutoAdvance game={game} offset={0} busy={false} onToggle={toggle} />);
  expect(screen.getByText(/Next question in [78] seconds/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Pause auto-advance" }));
  expect(toggle).toHaveBeenCalledWith(false);
  view.rerender(<ReviewAutoAdvance game={{ ...game, auto_advance_at: null }} offset={0} busy={false} onToggle={toggle} />);
  fireEvent.click(screen.getByRole("button", { name: "Resume auto-advance" }));
  expect(toggle).toHaveBeenCalledWith(true);
  view.rerender(<ReviewAutoAdvance game={{ ...game, paused: true }} offset={0} busy={false} onToggle={toggle} />);
  expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<ReviewAutoAdvance game={{ ...game, current_index: 2 }} offset={0} busy={false} onToggle={toggle} />);
  expect(screen.queryByRole("button")).toBeNull();
});

it("announces the double-points finale during get-ready", () => {
  render(<GetReady revealAt={new Date(Date.now() + 3000).toISOString()} offset={0} doublePoints />);
  expect(screen.getByText("Final question — double points!")).toBeTruthy();
});

it("renders countdown progress against the configured timer", () => {
  render(<QuestionStage question={{ index: 0, mode: "type_answer", prompt: "Q", options: null, voided: false }} timerMs={60000} currentIndex={0} remaining={30000} voided={false} paused={false} spectating={false} playerToken={null} />);
  expect(screen.getByRole("timer").style.getPropertyValue("--pct")).toBe("50");
});
