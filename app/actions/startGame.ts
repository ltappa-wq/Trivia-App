"use server";
// U8 / R9 / R10 / KTD6. Generate the question set, then start the game.
//
// Generation used to run inside createGame, which meant the questions existed
// before the host ever reached the lobby — so anything a player suggested at
// join time arrived too late to matter. Moving it here is what makes R9
// possible: the host reviews suggestions, accepts a subset, and *then* the set
// is generated against the final categories.
//
// This carries the guards that moved off createGame with the work: the
// concurrent-generation bound and the xAI cost exposure. It is also strictly
// tighter than the path it replaces — creation is anonymous, this demands a
// valid host token.
//
// Rollback semantics invert too. A generation failure used to delete the room;
// now it leaves the host in the lobby with an error and a retry, and players
// stay seated (AE8). Deleting a room full of waiting players to recover from a
// transient xAI error would be far worse than asking the host to press again.

import { getServiceClient } from "@/lib/supabase/server";
import { authorizeHostByCode } from "@/lib/serverAuth";
import { advance, type AdvanceResult } from "@/app/actions/advance";
import { generateAndPersistQuestions } from "@/app/actions/generate";
import { validateSetupInput } from "@/lib/gameConfig";
import { hasQuestions } from "@/lib/gameFlow";

// Module-scoped concurrent-generation bound (best-effort per instance, KTD10).
// Moved here from createGame along with the generation it protects.
const MAX_CONCURRENT_GENERATIONS = 3;
let activeGenerations = 0;

export type StartGameResult =
  | { status: "started"; index: number; revealAt: string; timerMs: number }
  /** Already started — a double-tap must not generate a second set. */
  | { status: "already_started"; index: number };

/**
 * Generate this room's questions and reveal the first one.
 *
 * `acceptedSuggestions` are the player-suggested categories the host chose to
 * accept (R8). They are *merged* with the game's stored categories here rather
 * than the client sending a replacement set: the server already holds the host's
 * originals, so merging server-side keeps the client from having to know them
 * and removes any way for a caller to quietly drop them. Omitted or empty, the
 * stored categories are used unchanged.
 */
export async function startGame(
  code: string,
  hostToken: string,
  acceptedSuggestions?: string[],
): Promise<StartGameResult> {
  const supabase = getServiceClient();
  const game = await authorizeHostByCode(supabase, code, hostToken);

  if (game.status === "ended") throw new Error("This game has ended");

  // Double-tap protection: if this room already has its questions, skip straight
  // to advancing. Generating a second set would burn the xAI budget and orphan
  // the questions players are already looking at.
  const { count: existing } = await supabase
    .from("questions")
    .select("id", { count: "exact", head: true })
    .eq("game_id", game.id);

  if (hasQuestions(existing ?? 0)) {
    if (game.current_index >= 0) {
      return { status: "already_started", index: game.current_index };
    }
    return revealFirstQuestion(code, hostToken, game.current_index);
  }

  // Persist the host's final category set before generating against it, so a
  // retry after a failure uses the same decision rather than the stale set.
  let categories = game.categories;
  if (acceptedSuggestions !== undefined && acceptedSuggestions.length > 0) {
    // The union is what gets validated, so the shared category cap applies to
    // the *result* — accepting suggestions that would overflow it fails here
    // with the same message the setup form gives, rather than silently
    // truncating the host's own categories.
    const merged = [...new Set([...game.categories, ...acceptedSuggestions])];
    const validated = validateSetupInput({
      categories: merged,
      questionCount: game.question_count,
      answerMode: game.answer_mode,
      difficulty: game.difficulty,
    });
    if (!validated.ok) throw new Error(validated.error);
    categories = validated.value.categories;

    const { error: catError } = await supabase
      .from("games")
      .update({ categories })
      .eq("id", game.id);
    if (catError) {
      throw new Error(`Could not save categories: ${catError.message}`);
    }
  }

  if (activeGenerations >= MAX_CONCURRENT_GENERATIONS) {
    throw new Error("The server is busy generating games — please retry shortly.");
  }

  activeGenerations++;
  try {
    await generateAndPersistQuestions(game.id, {
      categories,
      count: game.question_count,
      mode: game.answer_mode,
      difficulty: game.difficulty,
    });
  } catch (err) {
    // No rollback (AE8): the room stays in the lobby with its players seated and
    // the host free to retry. The room simply has no questions yet, which every
    // reveal path already guards against (R10).
    throw err instanceof Error ? err : new Error("Generation failed");
  } finally {
    activeGenerations--;
  }

  return revealFirstQuestion(code, hostToken, game.current_index);
}

/**
 * Hand off to `advance`, which owns the compare-and-set, the server-stamped
 * reveal time and the room broadcast. Start and advance have always been the
 * same operation — this keeps it that way rather than duplicating the CAS.
 */
async function revealFirstQuestion(
  code: string,
  hostToken: string,
  currentIndex: number,
): Promise<StartGameResult> {
  const result: AdvanceResult = await advance(code, hostToken, currentIndex);
  if (result.status === "advanced") {
    return {
      status: "started",
      index: result.index,
      revealAt: result.revealAt,
      timerMs: result.timerMs,
    };
  }
  // A concurrent start won the race, or there is nothing to reveal.
  return { status: "already_started", index: result.status === "noop" ? result.index : 0 };
}
