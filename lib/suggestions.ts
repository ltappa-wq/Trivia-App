// U9 / U10 / R7 / R8. Player category suggestions — validation and aggregation.
//
// Suggestions are advisory. A player picks categories on the join screen and
// they travel with the join (KTD7 — no pre-join lookup RPC, which would be a new
// unauthenticated room-code enumeration surface). Nothing here changes what a
// game is about: the host reviews these and decides (R8).

import { CATEGORIES } from "@/lib/gameConfig";

/**
 * How many categories one player may suggest.
 *
 * Small on purpose. The game's own ceiling is CATEGORIES_MAX (10) and these are
 * hints, not votes — a room of twenty players each naming ten categories gives
 * the host a list they cannot scan, which makes the feature worse than nothing.
 * Three is enough to express a preference.
 */
export const SUGGESTIONS_PER_PLAYER_MAX = 3;

export type SuggestionValidation =
  | { ok: true; value: string[] }
  | { ok: false; error: string };

/**
 * Validate a player's suggested categories.
 *
 * Two different failure modes, deliberately handled differently:
 *
 * - **Off-catalog values are dropped, silently.** The join screen only offers
 *   the built-in catalog, so an unknown value means a stale or tampered client,
 *   never a real choice. Failing someone's join — their entry to the game —
 *   over a cosmetic side field would be a bad trade. Note this is stricter than
 *   the host's own categories, which may be free text: R8 gives the host the
 *   final say, so players pick from the list rather than inventing labels.
 * - **Exceeding the cap is rejected, loudly.** The picker enforces the cap, so
 *   going past it is a deliberate bypass rather than a stale value, and silently
 *   truncating would hide from the player which of their picks was kept.
 *
 * Duplicates collapse; order is preserved so the host sees them as sent.
 */
export function validateSuggestions(raw: unknown): SuggestionValidation {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "Invalid category selection" };

  const catalog = CATEGORIES as readonly string[];
  const cleaned = [
    ...new Set(
      raw
        .filter((c): c is string => typeof c === "string")
        .map((c) => c.trim())
        .filter((c) => catalog.includes(c)),
    ),
  ];

  if (cleaned.length > SUGGESTIONS_PER_PLAYER_MAX) {
    return {
      ok: false,
      error: `Suggest at most ${SUGGESTIONS_PER_PLAYER_MAX} categories`,
    };
  }
  return { ok: true, value: cleaned };
}

/** One suggested category with who asked for it. */
export interface SuggestionRow {
  category: string;
  username: string;
}

export interface AggregatedSuggestion {
  category: string;
  /** How many distinct players suggested it — the host's signal for what matters. */
  count: number;
  usernames: string[];
}

/**
 * Roll per-player rows into one entry per category, most-requested first so the
 * host's attention lands on what the room actually wants. Ties break
 * alphabetically to keep the list stable as suggestions stream in.
 */
export function aggregateSuggestions(
  rows: readonly SuggestionRow[],
): AggregatedSuggestion[] {
  const byCategory = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row?.category) continue;
    const players = byCategory.get(row.category);
    if (players) players.add(row.username);
    else byCategory.set(row.category, new Set([row.username]));
  }

  return [...byCategory.entries()]
    .map(([category, players]) => ({
      category,
      count: players.size,
      usernames: [...players].sort(),
    }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}
