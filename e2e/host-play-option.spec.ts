import { test, expect } from "@playwright/test";
import { answerFirstOption, hostCreateGame, playerJoin, questionPrompt } from "./helpers";

// Host-only gamemaster path (host-play toggle off). Verifies a non-playing host
// can run the full game: the host is not seated as a player, the host view shows
// the question read-only (no answer controls), and the game reaches results.
// NOTE: hits live Supabase + xAI — needs env configured and costs a little.

test("host-only gamemaster: not seated, read-only question, runs to results", async ({
  browser,
}) => {
  const hostCtx = await browser.newContext();
  const adaCtx = await browser.newContext();

  // Single question + underused category keeps generation cheap/reliable while
  // still covering host-only seating, read-only host view, and results.
  const { page: host, code } = await hostCreateGame(hostCtx, {
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
  await expect(questionPrompt(host)).toHaveText(prompt);

  // Host view shows the options read-only — no answer buttons for the host.
  const hostQuestion = host.locator('section[aria-live="polite"]');
  await expect(hostQuestion.locator("ol li").first()).toBeVisible();
  await expect(hostQuestion.locator("ol li button")).toHaveCount(0);

  // Solo active player: submit may race into all-answered review, which
  // unmounts AnswerPanel. Accept either the result chrome or the review overlay.
  await answerFirstOption(ada);
  await expect(
    ada.getByText(/✓ Correct|✗ Answer locked in|Answers locked/i).first(),
  ).toBeVisible();

  // Only question → finish.
  await host.getByRole("button", { name: "Finish game" }).click();

  // Both land on results.
  await ada.waitForURL(/\/results/);
  await expect(ada.getByRole("heading", { name: "Final results" })).toBeVisible();
  await expect(host.getByRole("heading", { name: "Final results" })).toBeVisible();

  await hostCtx.close();
  await adaCtx.close();
});
