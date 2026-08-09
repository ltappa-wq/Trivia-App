"use client";
// U9 / R7. Category chips on the join screen.
//
// Renders straight from the CATEGORIES constant — no server call and no pre-join
// room lookup (KTD7), which keeps this from becoming an endpoint that confirms
// whether a room code exists.
//
// The cap is enforced here as well as on the server: unpicked chips disable at
// the limit so a player sees the ceiling rather than discovering it by having
// their join rejected.

import { CATEGORIES } from "@/lib/gameConfig";
import { SUGGESTIONS_PER_PLAYER_MAX } from "@/lib/suggestions";

export interface CategoryPickerProps {
  selected: string[];
  onToggle: (category: string) => void;
  disabled?: boolean;
}

export function CategoryPicker({ selected, onToggle, disabled }: CategoryPickerProps) {
  const atCap = selected.length >= SUGGESTIONS_PER_PLAYER_MAX;

  return (
    <fieldset className="category-picker">
      <legend>Anything you&apos;d like to see? (optional)</legend>
      <p className="field__hint">
        Pick up to {SUGGESTIONS_PER_PLAYER_MAX} — the host decides the final mix.
      </p>
      <div className="category-picker__chips">
        {CATEGORIES.map((category) => {
          const isSelected = selected.includes(category);
          return (
            <button
              key={category}
              type="button"
              className={`chip${isSelected ? " is-selected" : ""}`}
              aria-pressed={isSelected}
              disabled={disabled || (atCap && !isSelected)}
              onClick={() => onToggle(category)}
            >
              {category}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
