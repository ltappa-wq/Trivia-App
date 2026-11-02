import AxeBuilder from "@axe-core/playwright";
import { test, expect, localDatabase } from "./test";
import { hostCreateGame, playerJoin, questionPrompt, recordHydrationErrors, answerFirstOption } from "./helpers";

test("family fixture replaces flagged content, retains host note on reload, and plays safely", async ({ browser, trackGame }) => {
  const hostCtx = await browser.newContext();
  const playerCtx = await browser.newContext();
  const errors = recordHydrationErrors([hostCtx, playerCtx]);
  try {
    const { page: host, code } = await hostCreateGame(hostCtx, trackGame, { count: 1, hostPlays: false, familyFriendly: true });
    const player = await playerJoin(playerCtx, code, "Family player");
    await host.getByRole("button", { name: "Review questions first" }).click();
    const review = host.getByRole("region", { name: "Question review" });
    await expect(review).toContainText("Fixture 2: spell the number 1.");
    const note = host.getByText("1 question was replaced to keep it family-friendly.");
    await expect(note).toBeVisible();
    await host.reload();
    await expect(note).toBeVisible();
    expect((await new AxeBuilder({ page: host }).include("main").analyze()).violations).toEqual([]);
    await host.getByRole("button", { name: "Start game", exact: true }).click();
    await expect(questionPrompt(player)).toHaveText("Fixture 2: spell the number 1.");
    await expect(player.getByText(/Fixture flagged/)).toHaveCount(0);
    expect((await new AxeBuilder({ page: player }).include("main").analyze()).violations).toEqual([]);
    await answerFirstOption(player);
    await expect(host.getByText("Correct answer:")).toBeVisible();
    await host.getByRole("button", { name: "Finish game" }).click();
    const { data } = await localDatabase().from("games").select("family_friendly,family_replaced_count").eq("code", code).single();
    expect(data).toEqual({ family_friendly: true, family_replaced_count: 1 });
    expect(errors).toEqual([]);
  } finally { await Promise.all([hostCtx.close(), playerCtx.close()]); }
});
