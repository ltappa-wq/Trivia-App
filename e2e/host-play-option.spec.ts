import { test, expect } from "./test";
import { answerFirstOption, hostCreateGame, playerJoin, questionPrompt } from "./helpers";

// Host-only gamemaster path (host-play toggle off). Verifies a non-playing host
// can run the full game: the host is not seated as a player, the host view shows
// the question read-only (no answer controls), and the game reaches results.
// Uses deterministic server fixtures and an isolated local Supabase.

test("host-only gamemaster: not seated, read-only question, runs to results", async ({
  browser, trackGame,
}) => {
  const hostCtx = await browser.newContext();
  const adaCtx = await browser.newContext();

  const { page: host, code } = await hostCreateGame(hostCtx, trackGame, {
    category: "Music",
    count: 1,
    hostPlays: false,
  });
  const ada = await playerJoin(adaCtx, code, "Ada");

  // The host is not a player: the lobby roster shows only the joined player.
  const roster = host.locator("section", { hasText: "Players" }).locator("ul li");
  await expect(roster).toHaveText(["Ada"]);

  // Host starts; both host and player see the same question (broadcast + hydrate).
  await expect(host.getByRole("button", { name: "Start game" })).toBeEnabled();
  await host.getByRole("button", { name: "Start game" }).click();

  await expect(questionPrompt(ada)).toBeVisible();
  const prompt = await questionPrompt(ada).innerText();
  expect(prompt).toBe("Fixture 1: spell the number 0.");
  await expect(questionPrompt(host)).toHaveText(prompt);

  // Host view shows the options read-only — no answer buttons for the host.
  const hostQuestion = host.locator('section[aria-live="polite"]');
  await expect(hostQuestion.locator("ol li").first()).toBeVisible();
  await expect(hostQuestion.locator("ol li button")).toHaveCount(0);

  // Solo active player: submit may race into all-answered review, which
  // unmounts AnswerPanel. Accept either the result chrome or the review overlay.
  await answerFirstOption(ada);
  await expect(
    ada.getByText(/✓ Correct|Answers locked/i).first(),
  ).toBeVisible();

  // Only question → finish.
  await host.getByRole("button", { name: "Finish game" }).click();

  // U7 / R6 / AE5: both reach the end screen in place, without a route change.
  await expect(ada.getByRole("heading", { name: "Final results" })).toBeVisible();
  expect(new URL(ada.url()).pathname).toBe("/play");
  await expect(host.getByRole("heading", { name: "Final results" })).toBeVisible();

  await hostCtx.close();
  await adaCtx.close();
});

test("typed fixture answer is judged correctly and restored on reload", async ({ browser, trackGame }) => {
  const hostCtx = await browser.newContext();
  const playerCtx = await browser.newContext();
  try {
    const { page: host, code } = await hostCreateGame(hostCtx, trackGame, { count: 1, mode: "type_answer" });
    const player = await playerJoin(playerCtx, code, "Ada");
    await host.getByRole("button", { name: "Start game" }).click();
    await expect(questionPrompt(player)).toHaveText("Fixture 1: spell the number 0.");
    await player.getByLabel("Your answer", { exact: true }).fill("zero");
    await player.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(player.getByText(/✓ Correct/)).toBeVisible();
    await player.reload();
    await expect(player.getByText(/Your answer: zero/)).toBeVisible();
    await expect(player.getByLabel("Your answer", { exact: true })).toHaveCount(0);
  } finally {
    await hostCtx.close();
    await playerCtx.close();
  }
});
