import { createClient } from "@supabase/supabase-js";
import { test, expect, localDatabase } from "./test";
import { answerFirstOption, hostCreateGame, playerJoin, questionPrompt } from "./helpers";

test("explanations are withheld while answerable and revealed to everyone in review", async ({ browser, trackGame }) => {
  localDatabase(); // Reject hosted targets before creating any test clients.
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const hostCtx = await browser.newContext();
  const playerCtx = await browser.newContext();
  try {
    const { page: host, code } = await hostCreateGame(hostCtx, trackGame, { count: 1, hostPlays: false });
    const player = await playerJoin(playerCtx, code, "Fact fan");
    const hostToken = await host.evaluate(room => JSON.parse(sessionStorage.getItem(`trivia:host:${room}`)!).token as string, code);
    const playerToken = await player.evaluate(room => JSON.parse(sessionStorage.getItem(`trivia:player:${room}`)!).token as string, code);
    const reveal = async (token: string) => {
      const { data, error } = await db.rpc("reveal_answer", { p_token: token });
      expect(error).toBeNull();
      return data;
    };
    expect(await reveal(hostToken)).toBeNull(); // Lobby.
    expect(await reveal("invalid-token")).toBeNull();
    await host.getByRole("button", { name: "Start game" }).click();
    await expect(questionPrompt(player)).toBeVisible();
    for (const token of [hostToken, playerToken]) expect(await reveal(token)).toBeNull();
    for (const page of [host, player]) await expect(page.getByRole("complementary", { name: "Did you know?" })).toBeHidden();
    await answerFirstOption(player);
    const explanation = "The number 0 is written as zero in English.";
    for (const page of [host, player]) {
      await expect(page.getByRole("complementary", { name: "Did you know?" })).toContainText(explanation);
    }
    for (const token of [hostToken, playerToken]) expect((await reveal(token)).explanation).toBe(explanation);
    await host.getByRole("button", { name: "Finish game" }).click();
    await expect(host.getByRole("heading", { name: "Final results" })).toBeVisible();
    expect((await reveal(playerToken)).explanation).toBe(explanation);
  } finally {
    await hostCtx.close();
    await playerCtx.close();
  }
});
