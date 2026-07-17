"use server";
// U4. Game setup & room creation (F1; R1, R2, R16; KTD7, KTD10).
// The only entry point to generation, so it carries the abuse guard: per-IP
// rate limit + concurrent-generation bound protecting the paid xAI budget. On
// any failure it leaves no half-initialized game.

import { getServiceClient } from "@/lib/supabase/server";
import { generateAndPersistQuestions } from "@/app/actions/generate";
import { generateRoomCode, generateToken, hashToken } from "@/lib/codes";
import { RateLimiter } from "@/lib/rateLimit";
import { callerIp } from "@/lib/serverRequest";
import { validateSetupInput, type SetupInput } from "@/lib/gameConfig";
import {
  checkCategoryFeasibility,
  formatFeasibilityError,
} from "@/lib/generation/preflight";
import { normalizeUsername, validateUsername } from "@/lib/join";

// Module-scoped guards (best-effort per serverless instance, KTD10).
const createLimiter = new RateLimiter(5, 60_000); // 5 games / minute / IP
const MAX_CONCURRENT_GENERATIONS = 3;
let activeGenerations = 0;

export interface CreateGameResult {
  gameId: string;
  code: string;
  /** Plaintext host token — returned once, only the hash is stored (KTD7). */
  hostToken: string;
  /** The host's own player token — present only when the host plays too. */
  hostPlayerToken?: string;
  /** The host's player name — present only when the host plays too. */
  username?: string;
}

/** How the gamemaster participates: playing (with a name) or hosting only. */
export interface HostPlayOption {
  plays: boolean;
  name: string;
}

export async function createGame(
  raw: SetupInput,
  host: HostPlayOption,
): Promise<CreateGameResult> {
  const validated = validateSetupInput(raw);
  if (!validated.ok) throw new Error(validated.error);
  const input = validated.value;

  // When the host plays too, they need a valid name like any player. A
  // host-only gamemaster skips this entirely.
  let username: string | undefined;
  if (host.plays) {
    username = normalizeUsername(host.name);
    const nameCheck = validateUsername(username);
    if (!nameCheck.ok) throw new Error(nameCheck.error);
  }

  if (!createLimiter.check(await callerIp())) {
    throw new Error("Too many games created — please wait a moment.");
  }
  if (activeGenerations >= MAX_CONCURRENT_GENERATIONS) {
    throw new Error("The server is busy generating games — please retry shortly.");
  }

  // Feasibility preflight for free-text customs (presets skip the model). Runs
  // before any game insert so a reject never leaves an orphan lobby.
  const preflight = await checkCategoryFeasibility(input.categories, {
    apiKey: process.env.XAI_API_KEY ?? "",
    baseUrl: process.env.XAI_BASE_URL,
    model: process.env.XAI_MODEL,
  });
  if (!preflight.ok) {
    throw new Error(formatFeasibilityError(preflight.rejected));
  }

  const supabase = getServiceClient();
  const hostToken = generateToken();

  // Insert the game first (retrying on the rare code collision), then generate.
  let gameId: string | undefined;
  let code: string | undefined;
  for (let attempt = 0; attempt < 5 && !gameId; attempt++) {
    const candidate = generateRoomCode();
    const { data, error } = await supabase
      .from("games")
      .insert({
        code: candidate,
        host_token_hash: hashToken(hostToken),
        status: "lobby",
        categories: input.categories,
        question_count: input.questionCount,
        answer_mode: input.answerMode,
        difficulty: input.difficulty,
      })
      .select("id")
      .single();
    if (!error && data) {
      gameId = data.id as string;
      code = candidate;
    } else if (error && error.code !== "23505") {
      // Not a unique-violation on the code — a real error.
      throw new Error(`Failed to create game: ${error.message}`);
    }
  }
  if (!gameId || !code) {
    throw new Error("Could not allocate a unique room code — please retry.");
  }

  activeGenerations++;
  try {
    await generateAndPersistQuestions(gameId, {
      categories: input.categories,
      count: input.questionCount,
      mode: input.answerMode,
      difficulty: input.difficulty,
    });
  } catch (err) {
    // Roll back so a generation failure never leaves a joinable-but-empty game.
    const { error: rollbackError } = await supabase.from("games").delete().eq("id", gameId);
    if (rollbackError) {
      // The rollback itself failed — an orphaned lobby game may exist. Log it so
      // it's detectable rather than silently stranded.
      console.error(
        `[createGame] rollback delete failed for game ${gameId}: ${rollbackError.message}`,
      );
    }
    throw err instanceof Error ? err : new Error("Generation failed");
  } finally {
    activeGenerations--;
  }

  // A host-only gamemaster paces the room without answering — nothing to seat.
  if (!host.plays) {
    return { gameId, code, hostToken };
  }

  // Seat the host as a player (the host plays too). Their own player token lets
  // them submit answers and appear on the leaderboard.
  const hostPlayerToken = generateToken();
  const { error: seatError } = await supabase.from("players").insert({
    game_id: gameId,
    username,
    token: hostPlayerToken,
    is_spectator: false,
  });
  if (seatError) {
    // Don't leave a game the host can pace but not play — roll back.
    await supabase.from("games").delete().eq("id", gameId);
    throw new Error(
      seatError.code === "23505"
        ? "Could not seat the host — please retry."
        : `Could not seat the host: ${seatError.message}`,
    );
  }

  return { gameId, code, hostToken, hostPlayerToken, username };
}
