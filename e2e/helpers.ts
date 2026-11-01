import { randomUUID } from "node:crypto";
import { type BrowserContext, type Page, expect } from "@playwright/test";

// Shared helpers for the multi-client realtime specs. Each participant runs in
// its own BrowserContext so sessionStorage credentials (host/player tokens,
// keyed by room code) stay isolated — the real "different devices" model.

/** Locator for the active question prompt on either the host or a play view. */
export function questionPrompt(page: Page) {
  return page.locator('.stage [data-question-heading]');
}

/**
 * Drive the setup form to create a game. Uses a small deterministic set. By default the host plays too (with a name);
 * pass `hostPlays: false` to create a host-only game. Returns the host page and
 * the issued code.
 */
export async function hostCreateGame(
  context: BrowserContext,
  trackGame: (gameId: string) => void,
  opts: {
    category?: string;
    count?: number;
    mode?: "multiple_choice" | "type_answer";
    hostPlays?: boolean;
    hostName?: string;
    answerTimerMs?: number;
  } = {},
): Promise<{ page: Page; code: string }> {
  // Isolate the real per-IP create limit across local retries without changing app guards.
  await context.setExtraHTTPHeaders({ "x-real-ip": `e2e-${randomUUID()}` });
  const page = await context.newPage();
  await page.goto("/setup");
  const hostPlays = opts.hostPlays ?? true;
  if (hostPlays) {
    await page.getByLabel("Your name").fill(opts.hostName ?? "Gamemaster");
  } else {
    await page.getByLabel("I’ll play too").uncheck();
  }
  await page.getByLabel(opts.category ?? "Geography").check();
  if (opts.mode === "type_answer") await page.getByLabel("Type the answer", { exact: true }).check();
  await page.getByLabel("Number of questions").fill(String(opts.count ?? 2));
  if (opts.answerTimerMs) await page.getByRole("combobox", { name: /^Answer timer/ }).selectOption(String(opts.answerTimerMs));
  await page.getByRole("button", { name: "Create game" }).click();

  // Setup creates the lobby; generation happens on Start game.
  await page.waitForURL(/\/host\?code=/, { timeout: 90_000 });
  const code = new URL(page.url()).searchParams.get("code")!;
  const gameId = await page.evaluate((roomCode) => {
    const raw = sessionStorage.getItem(`trivia:host:${roomCode}`);
    return raw ? (JSON.parse(raw) as { gameId: string }).gameId : null;
  }, code);
  if (!gameId) throw new Error("Created game credential missing");
  trackGame(gameId);
  await expect(page.getByRole("heading", { name: `Room ${code}` })).toBeVisible();
  return { page, code };
}

/** Join a game as a player from a fresh context; returns the play page. */
export async function playerJoin(
  context: BrowserContext,
  code: string,
  username: string,
): Promise<Page> {
  const page = await context.newPage();
  await page.goto("/join");
  await page.getByLabel("Room code").fill(code);
  await page.getByLabel("Username").fill(username);
  await page.getByRole("button", { name: "Join" }).click();
  await page.waitForURL(/\/play\?code=/, { timeout: 30_000 });
  return page;
}

/** Click the first multiple-choice option on a play view. */
export async function answerFirstOption(page: Page): Promise<void> {
  await page.locator("section ul li button").first().click();
}
