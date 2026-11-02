import { test, expect, localDatabase } from "./test";
import { hostCreateGame, playerJoin, questionPrompt } from "./helpers";

test("host reviews, regenerates, removes, reloads, and starts the saved set", async ({ browser, trackGame }) => {
  const db = localDatabase();
  const hostCtx = await browser.newContext(); const playerCtx = await browser.newContext();
  try {
    const { page: host, code } = await hostCreateGame(hostCtx, trackGame, { count: 2, hostPlays: false });
    const player = await playerJoin(playerCtx, code, "Waiting player");
    await host.getByRole("button", { name: "Review questions first" }).click();
    const review = host.getByRole("region", { name: "Question review" });
    await expect(review).toContainText("Fixture 1: spell the number 0.");
    await expect(review).toContainText("zero — Correct answer");
    await expect(questionPrompt(player)).toBeHidden();
    const { data: game } = await db.from("games").select("id,current_index").eq("code", code).eq("status", "lobby").single();
    expect(game?.current_index).toBe(-1);
    await review.getByRole("button", { name: /Regenerate question/ }).first().click();
    await expect(review).toContainText("Fixture 101: spell the number 100.");
    await review.getByRole("button", { name: /Remove question/ }).last().click();
    await expect(review.getByRole("heading", { name: "Review questions (1)" })).toBeVisible();
    await expect(review.getByRole("button", { name: /Remove question/ })).toBeDisabled();
    await host.reload();
    await expect(review).toContainText("Fixture 101: spell the number 100.");
    await host.getByRole("button", { name: "Start game" }).click();
    await expect(questionPrompt(player)).toHaveText("Fixture 101: spell the number 100.");
    const { data: questions } = await db.from("questions").select("index,prompt").eq("game_id", game!.id);
    expect(questions).toEqual([{ index: 0, prompt: "Fixture 101: spell the number 100." }]);
    const { data: started } = await db.from("games").select("question_count,regeneration_count,current_index").eq("id", game!.id).single();
    expect(started).toMatchObject({ question_count: 1, regeneration_count: 1, current_index: 0 });
  } finally { await hostCtx.close(); await playerCtx.close(); }
});

test("prepared default-Start room hides answer keys until this screen opts in", async ({ browser, trackGame }) => {
  const db = localDatabase();
  const context = await browser.newContext();
  try {
    const { page: host, code } = await hostCreateGame(context, trackGame, { count: 2, hostPlays: false });
    const { data: game, error: lookupError } = await db.from("games").select("id").eq("code", code).eq("status", "lobby").single();
    expect(lookupError).toBeNull();
    // Model default Start's persisted set followed by a failed advance.
    const { error } = await db.from("questions").insert([0, 1].map(index => ({
      game_id: game!.id, index, prompt: `Unreviewed question ${index}`, mode: "type_answer", difficulty: "easy",
      accepted_variants: [index ? "Rome" : "Paris"], explanation: "Hidden explanation.",
    })));
    expect(error).toBeNull();
    await expect(host.getByText(/Questions are prepared\. Category suggestions/)).toBeVisible();
    await expect(host.getByRole("region", { name: "Question review" })).toBeHidden();
    await expect(host.getByText("Hidden explanation.", { exact: true })).toBeHidden();
    await host.reload();
    await expect(host.getByText(/Questions are prepared\. Category suggestions/)).toBeVisible();
    await expect(host.getByRole("region", { name: "Question review" })).toBeHidden();
    await host.getByRole("button", { name: "Review questions first" }).click();
    await expect(host.getByRole("region", { name: "Question review" })).toContainText("Accepted answers: Paris");
  } finally { await context.close(); }
});
