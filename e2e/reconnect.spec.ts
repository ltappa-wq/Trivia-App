import { test, expect } from "@playwright/test";
import { hostCreateGame, playerJoin, questionPrompt } from "./helpers";

// Hydrate-on-reconnect (KTD8; Verification Contract: U6). A client that drops
// and reconnects must recover the live question from Postgres via the hydrate
// RPC on re-subscribe, not stay stranded on stale state.

test("player re-hydrates to the live question after a reload", async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const playerCtx = await browser.newContext();

  // Distinct category from other e2e specs so bank dedup does not exhaust
  // Geography prompts mid-suite (tests share one live question_bank).
  const { page: host, code } = await hostCreateGame(hostCtx, {
    category: "History",
    count: 1,
  });
  const player = await playerJoin(playerCtx, code, "Ada");

  await expect(host.getByRole("button", { name: "Start game" })).toBeEnabled();
  await host.getByRole("button", { name: "Start game" }).click();

  await expect(questionPrompt(player)).toBeVisible();
  const prompt = await questionPrompt(player).innerText();

  // Simulate a dropped/reconnected client: full reload (credential persists in
  // sessionStorage; the page must re-subscribe and hydrate current state).
  await player.reload();

  await expect(questionPrompt(player)).toHaveText(prompt);
  await expect(player.getByText(/waiting for the host/i)).toBeHidden();

  await hostCtx.close();
  await playerCtx.close();
});
