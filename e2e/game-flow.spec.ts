import { test, expect } from "./test";
import { answerFirstOption, hostCreateGame, playerJoin, questionPrompt } from "./helpers";

// Full multi-client happy path (Verification Contract: U5, U6, U8, U9).
// Exercises fixture generation, live-lobby roster, host-authoritative reveal,
// cross-device question sync, a challenge pause + adjudication, and results.
// Uses deterministic server fixtures and an isolated local Supabase.

test("host + two players: lobby, sync, challenge/adjudicate, results", async ({ browser, trackGame }) => {
  const hostCtx = await browser.newContext();
  const adaCtx = await browser.newContext();
  const bobCtx = await browser.newContext();

  const { page: host, code } = await hostCreateGame(hostCtx, trackGame, {
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
  expect(prompt).toBe("Fixture 1: spell the number 0.");
  await expect(questionPrompt(bob)).toHaveText(prompt);
  await expect(questionPrompt(host)).toHaveText(prompt);

  // U7 (surface): a player answers and locks in.
  await answerFirstOption(ada);
  await expect(ada.getByText(/✓ Correct/i)).toBeVisible();

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
  await expect(questionPrompt(ada)).toHaveText("Fixture 2: spell the number 1."); // new question synced
  await host.getByRole("button", { name: "Finish game" }).click();

  // U7 / R6 / AE5: the end screen renders in place, with no route change. The
  // old redirect to /results was the only path players had to their standings,
  // so it depended on this view staying mounted and reconciling in time.
  await expect(ada.getByRole("heading", { name: "Final results" })).toBeVisible();
  expect(new URL(ada.url()).pathname).toBe("/play");
  await expect(host.getByRole("heading", { name: "Final results" })).toBeVisible();

  await hostCtx.close();
  await adaCtx.close();
  await bobCtx.close();
});
