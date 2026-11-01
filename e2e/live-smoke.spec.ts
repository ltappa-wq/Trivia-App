import { test, expect } from "./test";
import { hostCreateGame, questionPrompt } from "./helpers";

// Explicitly opt in; still uses only local Supabase. One question, one xAI call
// path, no exact-text assertion: this is provider compatibility, not gameplay.
test("live xAI can generate one playable question", async ({ browser, trackGame }) => {
  test.skip(process.env.E2E_LIVE_XAI !== "1", "Set E2E_LIVE_XAI=1 explicitly");
  const context = await browser.newContext();
  try {
    const { page } = await hostCreateGame(context, trackGame, { count: 1 });
    await page.getByRole("button", { name: "Start game" }).click();
    await expect(questionPrompt(page)).toBeVisible({ timeout: 90_000 });
    expect(await questionPrompt(page).innerText()).not.toContain("Fixture ");
  } finally {
    await context.close();
  }
});
