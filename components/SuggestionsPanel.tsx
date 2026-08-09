"use client";
// U10 / R8. The host's review of what players asked for, in the lobby.
//
// The whole point of R8 is that this is advisory: a suggestion changes nothing
// until the host accepts it, and accepting is a local toggle that only takes
// effect when they press Start. Players cannot move the game's categories.

import type { AggregatedSuggestion } from "@/lib/suggestions";

export interface SuggestionsPanelProps {
  suggestions: AggregatedSuggestion[];
  /** Categories the host has accepted so far — local until Start. */
  accepted: string[];
  onToggle: (category: string) => void;
  disabled?: boolean;
}

export function SuggestionsPanel({
  suggestions,
  accepted,
  onToggle,
  disabled,
}: SuggestionsPanelProps) {
  return (
    <div className="suggestions">
      <h2>Player suggestions</h2>
      {suggestions.length === 0 ? (
        <p className="field__hint">
          No requests yet — categories players pick when they join will show up here.
        </p>
      ) : (
        <>
          <p className="field__hint">
            Accept any you like; they join your categories when you start.
          </p>
          <ul className="suggestions__list">
            {suggestions.map((s) => {
              const isAccepted = accepted.includes(s.category);
              return (
                <li key={s.category}>
                  <button
                    type="button"
                    className={`chip${isAccepted ? " is-selected" : ""}`}
                    aria-pressed={isAccepted}
                    disabled={disabled}
                    onClick={() => onToggle(s.category)}
                  >
                    {s.category}
                    {s.count > 1 && (
                      <span className="suggestions__count"> ×{s.count}</span>
                    )}
                  </button>
                  <span className="suggestions__who">{s.usernames.join(", ")}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
