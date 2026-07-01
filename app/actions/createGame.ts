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
  /** The host's own player token — the host plays too. */
  hostPlayerToken: string;
  username: string;
}

export async function createGame(
  raw: SetupInput,
  rawHostName: string,
): Promise<CreateGameResult> {
  const validated = validateSetupInput(raw);
  if (!validated.ok) throw new Error(validated.error);
  const input = validated.value;

  // The host plays too, so they need a name like any player.
  const username = normalizeUsername(rawHostName);
  const nameCheck = validateUsername(username);
  if (!nameCheck.ok) throw new Error(nameCheck.error);

  if (!createLimiter.check(await callerIp())) {
    throw new Error("Too many games created — please wait a moment.");
  }
  if (activeGenerations >= MAX_CONCURRENT_GENERATIONS) {
    throw new Error("The server is busy generating games — please retry shortly.");
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
