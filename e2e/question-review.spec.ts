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
    await review.getByRole("button", { name: "Regenerate", exact: true }).first().click();
    await expect(review).toContainText("Fixture 101: spell the number 100.");
    await review.getByRole("button", { name: "Remove", exact: true }).last().click();
    await expect(review.getByRole("heading", { name: "Review questions (1)" })).toBeVisible();
    await expect(review.getByRole("button", { name: "Remove" })).toBeDisabled();
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
