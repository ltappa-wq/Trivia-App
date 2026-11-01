import { test, expect } from "./test";
import { hostCreateGame, playerJoin } from "./helpers";

test("host mints a read-only TV link, TV follows play, and revoke invalidates it", async ({ browser, trackGame }) => {
  const hostContext = await browser.newContext();
  const tvContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const playerContext = await browser.newContext();
  try {
    const { page: host, code } = await hostCreateGame(hostContext, trackGame, { hostPlays: false, count: 2 });
    await playerJoin(playerContext, code, "TV player");
    await host.getByRole("button", { name: "Open TV display", exact: true }).click();
    const url = await host.getByRole("link", { name: "Open read-only TV screen" }).getAttribute("href");
    expect(url).toContain("#t=");
    const tv = await tvContext.newPage();
    await tv.goto(url!);
    await expect(tv.getByRole("heading", { name: "Join the game" })).toBeVisible();
    await expect(tv.getByText("TV player", { exact: true })).toBeVisible();
    await expect(tv.getByRole("img", { name: "Scan to join this trivia game" })).toBeVisible();
    await expect.poll(() => new URL(tv.url()).hash).toBe("");
    await expect(tv.getByRole("button")).toHaveCount(0);
    await tv.reload();
    await expect(tv.getByRole("heading", { name: "Join the game" })).toBeVisible();
    await host.getByRole("button", { name: "Start game", exact: true }).click();
    await expect(tv.getByRole("heading", { name: "Fixture 1: spell the number 0." })).toBeVisible({ timeout: 30000 });
    await expect(tv.getByText("Correct answer:")).toHaveCount(0);
    await expect(tv.getByRole("button")).toHaveCount(0);
    await host.getByRole("button", { name: "End question now" }).click();
    await expect(tv.getByText("Correct answer:")).toBeVisible();
    await tv.setViewportSize({ width: 3840, height: 2160 });
    await expect(tv.getByRole("heading", { name: "Round leaderboard" })).toBeVisible();
    await host.getByRole("button", { name: "Revoke TV display link", exact: true }).click();
    await expect(tv.getByRole("heading", { name: "TV display link required" })).toBeVisible({ timeout: 20000 });
  } finally {
    await Promise.all([hostContext.close(), tvContext.close(), playerContext.close()]);
  }
});
