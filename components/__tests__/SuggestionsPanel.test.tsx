// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { SuggestionsPanel } from "../SuggestionsPanel";
import type { AggregatedSuggestion } from "@/lib/suggestions";

// U10 / R8 / AE7. The host has the final say. These pin that accepting is a
// deliberate, reversible act and that an un-accepted suggestion is inert.

afterEach(cleanup);

const SUGGESTIONS: AggregatedSuggestion[] = [
  { category: "Science", count: 2, usernames: ["Ada", "Grace"] },
  { category: "Music", count: 1, usernames: ["Alan"] },
];

describe("SuggestionsPanel — empty state (U10)", () => {
  it("explains where suggestions will come from when none have arrived", () => {
    render(<SuggestionsPanel suggestions={[]} accepted={[]} onToggle={vi.fn()} />);
    expect(screen.getByText(/No requests yet/i)).toBeTruthy();
  });

  it("shows no toggles at all when empty", () => {
    render(<SuggestionsPanel suggestions={[]} accepted={[]} onToggle={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("SuggestionsPanel — rendering demand (U10, R8)", () => {
  it("renders one entry per category with the players who asked", () => {
    const { container } = render(
      <SuggestionsPanel suggestions={SUGGESTIONS} accepted={[]} onToggle={vi.fn()} />,
    );
    const items = within(container.querySelector(".suggestions__list")!).getAllByRole(
      "listitem",
    );
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("Science");
    expect(items[0].textContent).toContain("Ada");
    expect(items[0].textContent).toContain("Grace");
  });

  it("shows a count when more than one player asked, and not when only one did", () => {
    const { container } = render(
      <SuggestionsPanel suggestions={SUGGESTIONS} accepted={[]} onToggle={vi.fn()} />,
    );
    const items = within(container.querySelector(".suggestions__list")!).getAllByRole(
      "listitem",
    );
    expect(items[0].textContent).toContain("×2");
    expect(items[1].textContent).not.toContain("×1");
  });
});

describe("SuggestionsPanel — accepting is the host's decision (U10, R8)", () => {
  it("AE7: reports the category the host accepted", () => {
    const onToggle = vi.fn();
    render(<SuggestionsPanel suggestions={SUGGESTIONS} accepted={[]} onToggle={onToggle} />);

    fireEvent.click(screen.getByRole("button", { name: /Science/ }));

    expect(onToggle).toHaveBeenCalledWith("Science");
    // Ignoring "Music" is the default — it requires no action at all.
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("marks accepted categories as pressed and un-accepted ones as not", () => {
    render(
      <SuggestionsPanel suggestions={SUGGESTIONS} accepted={["Science"]} onToggle={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /Science/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: /Music/ }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("lets the host take an acceptance back", () => {
    const onToggle = vi.fn();
    render(
      <SuggestionsPanel suggestions={SUGGESTIONS} accepted={["Science"]} onToggle={onToggle} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Science/ }));

    expect(onToggle).toHaveBeenCalledWith("Science");
  });

  it("disables the toggles once the game is starting", () => {
    render(
      <SuggestionsPanel suggestions={SUGGESTIONS} accepted={[]} onToggle={vi.fn()} disabled />,
    );
    expect(screen.getByRole("button", { name: /Science/ }).hasAttribute("disabled")).toBe(true);
  });
});
