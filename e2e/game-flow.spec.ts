import { test, expect } from "@playwright/test";
import { answerFirstOption, hostCreateGame, playerJoin, questionPrompt } from "./helpers";

// Full multi-client happy path (Verification Contract: U5, U6, U8, U9).
// Exercises real generation, live-lobby roster, host-authoritative reveal,
// cross-device question sync, a challenge pause + adjudication, and results.
// NOTE: hits live Supabase + xAI — needs env configured and costs a little.

test("host + two players: lobby, sync, challenge/adjudicate, results", async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const adaCtx = await browser.newContext();
  const bobCtx = await browser.newContext();

  // Distinct category from other e2e specs so bank dedup does not exhaust a
  // single category mid-suite (tests share one live question_bank).
  const { page: host, code } = await hostCreateGame(hostCtx, {
    category: "Sports",
    count: 2,
  });
  const ada = await playerJoin(adaCtx, code, "Ada");
  const bob = await playerJoin(bobCtx, code, "Bob");

  // U5: joins reach the host lobby live (player-joined broadcast + hydrate).
  // Target roster chips (li), not the join-toast spans that share the name text.
  await expect(host.getByRole("listitem").filter({ hasText: "Ada" })).toBeVisible();
  await expect(host.getByRole("listitem").filter({ hasText: "Bob" })).toBeVisible();
  await expect(ada.getByText(/waiting for the host/i)).toBeVisible();

  // U6: host starts; both players see the SAME question (broadcast + hydrate).
  await expect(host.getByRole("button", { name: "Start game" })).toBeEnabled();
  await host.getByRole("button", { name: "Start game" }).click();

  await expect(questionPrompt(ada)).toBeVisible();
  const prompt = await questionPrompt(ada).innerText();
  expect(prompt.length).toBeGreaterThan(0);
  await expect(questionPrompt(bob)).toHaveText(prompt);
  await expect(questionPrompt(host)).toHaveText(prompt);

  // U7 (surface): a player answers and locks in.
  await answerFirstOption(ada);
  await expect(ada.getByText(/✓ Correct|✗ Answer locked in/i)).toBeVisible();

  // U8: Bob challenges -> game pauses for everyone; host gets the panel.
  await bob.getByRole("button", { name: "Challenge this question" }).click();
  await expect(ada.getByText(/Paused for review/i)).toBeVisible();
  await expect(host.getByRole("heading", { name: /Paused/i })).toBeVisible();
  await expect(host.getByRole("button", { name: "Uphold" })).toBeVisible();

  // Host upholds -> the question is voided and play resumes.
  await host.getByRole("button", { name: "Uphold" }).click();
  await expect(ada.getByText(/voided/i)).toBeVisible();

  // Advance to the last question, then finish.
  await host.getByRole("button", { name: "Next question" }).click();
  await expect(questionPrompt(ada)).not.toHaveText(prompt); // new question synced
  await host.getByRole("button", { name: "Finish game" }).click();

  // U9: players land on results with a final standings view.
  await ada.waitForURL(/\/results/);
  await expect(ada.getByRole("heading", { name: "Final results" })).toBeVisible();
  await expect(host.getByRole("heading", { name: "Final results" })).toBeVisible();

  await hostCtx.close();
  await adaCtx.close();
  await bobCtx.close();
});
