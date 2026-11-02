// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { LobbyAccessibility } from "../LobbyAccessibility";
afterEach(cleanup);
it("focuses a new room heading and announces the rematch destination without refocusing unchanged rooms", () => {
  const view = (code: string) => <main><header><h1 tabIndex={-1}>Room {code}</h1></header><button>Host control</button><LobbyAccessibility code={code} /></main>;
  const { rerender } = render(view("12345"));
  expect(document.activeElement).toBe(screen.getByRole("heading"));
  screen.getByRole("button").focus();
  rerender(view("12345"));
  expect(document.activeElement).toBe(screen.getByRole("button"));
  rerender(view("54321"));
  expect(document.activeElement).toBe(screen.getByRole("heading"));
  expect(screen.getByRole("status").textContent).toContain("Room 54321");
});
