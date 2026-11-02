import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { test, expect, localDatabase } from "./test";
import { hostCreateGame, playerJoin, questionPrompt, recordHydrationErrors } from "./helpers";

test.use({ actionTimeout: 20_000 });

async function scan(page: Page, phase: string) {
  await test.step(`axe: ${phase}`, async () => {
    if (await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)) {
      const moving = await page.locator("main, main *").evaluateAll(elements => elements.flatMap(el => {
        if (!el.isConnected) return [];
        const style = getComputedStyle(el);
        return (style.animationName !== "" && style.animationName !== "none") || style.transitionDuration.split(",").some(value => parseFloat(value) > 0)
          ? [el.outerHTML.slice(0, 160)] : [];
      }));
      expect(moving, "Reduced motion must disable animation and transitions throughout the screen").toEqual([]);
    }
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    // Collect findings across phases; soft assertions still fail the test/job.
    expect.soft(result.violations.filter(v => v.impact === "serious" || v.impact === "critical"),
      JSON.stringify(result.violations, null, 2)).toEqual([]);
  });
}

/** Reach a control using actual Tab navigation, never programmatic focus/click. */
async function keyboardActivate(page: Page, target: Locator) {
  for (let i = 0; i < 80; i++) {
    if (await target.evaluate(el => el === document.activeElement)) {
      await page.keyboard.press("Enter");
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error("Control could not be reached by keyboard");
}

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`home, setup and join: ${reducedMotion}, no serious or critical WCAG violations`, async ({ page }) => {
    const hydrationErrors = recordHydrationErrors([page.context()]);
    await page.emulateMedia({ reducedMotion });
    for (const route of ["/", "/setup", "/join", "/display?code=12345"]) {
      await page.goto(route);
      if (route === "/setup") {
        const timer = page.getByRole("combobox", { name: /^Answer timer/ });
        await timer.selectOption("60000");
        await expect(timer).toHaveValue("60000");
      }
      if (route.startsWith("/display")) await expect(page.getByRole("heading", { name: "TV display link required" })).toBeFocused();
      await scan(page, route);
    }
    expect(hydrationErrors).toEqual([]);
  });
}

for (const mode of ["multiple_choice", "type_answer"] as const) {
  test(`${mode}: host and player phases, axe and keyboard round`, async ({ browser, trackGame }) => {
    test.setTimeout(180_000);
    const hostContext = await browser.newContext({ reducedMotion: "reduce" });
    const playerContext = await browser.newContext({ reducedMotion: "reduce" });
    const tvContext = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1920, height: 1080 } });
    const hydrationErrors = recordHydrationErrors([hostContext, playerContext, tvContext]);
    try {
      const { page: host, code } = await hostCreateGame(hostContext, trackGame, { mode, count: 1, hostPlays: false, answerTimerMs: 60000 });
      const player = await playerJoin(playerContext, code, "Keyboard player");
      await expect(host.getByRole("listitem").filter({ hasText: "Keyboard player" })).toBeVisible();
      await Promise.all([scan(host, "host lobby"), scan(player, "player lobby")]);
      await keyboardActivate(host, host.getByRole("button", { name: "Open TV display", exact: true }));
      const displayLink = host.getByRole("link", { name: "Open read-only TV screen" });
      await expect(displayLink).toBeFocused();
      await scan(host, "display link ready");
      const tv = await tvContext.newPage();
      await tv.goto((await displayLink.getAttribute("href"))!);
      await expect(tv.getByRole("heading", { name: "Join the game" })).toBeFocused();
      await scan(tv, "TV lobby");
      await keyboardActivate(host, host.getByRole("button", { name: "Regenerate TV display link" }));
      await expect(host.getByRole("status").filter({ hasText: "TV display link ready" })).toBeAttached();
      await expect(tv.getByRole("heading", { name: "TV display link required" })).toBeFocused();
      await expect(displayLink).toBeFocused();
      await tv.goto((await displayLink.getAttribute("href"))!);
      await expect(tv.getByRole("heading", { name: "Join the game" })).toBeVisible();
      await expect.poll(() => tv.evaluate(room => sessionStorage.getItem(`trivia:display:${room}`), code)).not.toBeNull();
      await scan(host, "display link regenerated");
      await keyboardActivate(host, host.getByRole("button", { name: "Start game" }));
      await expect(host.getByRole("timer", { name: /Next question in/ })).toBeVisible();
      // Extend only this isolated fixture's reveal window: axe must finish
      // while both devices are still showing get-ready, even on a cold runner.
      const db = localDatabase();
      const { error: extendError } = await db.from("games").update({ reveal_at: new Date(Date.now() + 60_000).toISOString() }).eq("code", code);
      expect(extendError).toBeNull();
      await Promise.all([host.reload(), player.reload(), tv.reload()]);
      await expect(player.getByRole("timer", { name: /Next question in/ })).toBeVisible();
      await expect(tv.getByRole("timer", { name: /Next question in/ })).toBeVisible();
      await Promise.all([scan(host, "host get-ready"), scan(player, "player get-ready"), scan(tv, "TV get-ready")]);
      const { error: revealError } = await db.from("games").update({ reveal_at: new Date(Date.now() + 1500).toISOString() }).eq("code", code);
      expect(revealError).toBeNull();
      await Promise.all([host.reload(), player.reload(), tv.reload()]);
      await expect(questionPrompt(player)).toBeVisible();
      await expect(questionPrompt(player)).toBeFocused();
      await expect(tv.getByRole("heading", { name: "Fixture 1: spell the number 0." })).toBeFocused();
      await Promise.all([scan(host, `host ${mode}`), scan(player, `player ${mode}`), scan(tv, `TV ${mode}`)]);

      // Challenge and resolve entirely with the keyboard, before answering.
      await keyboardActivate(player, player.getByRole("button", { name: "Challenge this question" }));
      await expect(host.getByRole("button", { name: "Reject" })).toBeVisible();
      await expect(tv.getByRole("heading", { name: "Paused", exact: true })).toBeFocused();
      await Promise.all([scan(host, "host paused"), scan(player, "player paused"), scan(tv, "TV paused")]);
      await keyboardActivate(host, host.getByRole("button", { name: "Reject" }));
      await expect(player.getByText(/Paused for review/i)).toBeHidden();
      await expect(questionPrompt(player)).toBeFocused();
      if (mode === "multiple_choice") {
        await player.keyboard.press("ArrowRight");
        await expect(player.getByRole("button", { name: /^A, triangle:/ })).toBeFocused();
        await player.keyboard.press("ArrowRight");
        await expect(player.getByRole("button", { name: /^B, diamond:/ })).toBeFocused();
        await player.keyboard.press("ArrowLeft");
        await player.keyboard.press("1");
      } else {
        await player.keyboard.press("Tab");
        await expect(player.getByLabel("Your answer", { exact: true })).toBeFocused();
        await player.keyboard.type("zero");
        await player.keyboard.press("Enter");
      }
      for (const page of [host, player]) {
        await expect(page.getByRole("heading", { name: "Question review" })).toBeFocused();
      }
      await expect(tv.getByText("Correct answer:", { exact: true })).toBeVisible();
      await Promise.all([scan(host, "host review"), scan(player, "player review"), scan(tv, "TV review")]);
      await keyboardActivate(host, host.getByRole("button", { name: "Finish game" }));
      for (const page of [host, player]) {
        await expect(page.getByRole("heading", { name: "Final results" })).toBeFocused();
        await expect(page.getByRole("heading", { name: "Room highlights" })).toBeVisible();
        await scan(page, "results");
        const motion = await page.locator(".podium-step").evaluateAll(elements => elements.map(el => {
          const style = getComputedStyle(el);
          return { animation: style.animationName, opacity: style.opacity, transition: style.transitionDuration };
        }));
        for (const style of motion) expect(style).toEqual({ animation: "none", opacity: "1", transition: "0s" });
      }
      await expect(tv.getByRole("heading", { name: "Final standings" })).toBeFocused();
      await scan(tv, "TV results");
      await expect(player.getByRole("heading", { name: "Your recap" })).toBeVisible();
      const summary = player.locator(".game-recap > details > summary");
      await keyboardActivate(player, summary);
      await expect(player.locator(".game-recap > details")).toHaveAttribute("open", "");
      const questionSummary = player.locator(".game-recap__questions summary").first();
      await keyboardActivate(player, questionSummary);
      await expect(questionSummary).toBeFocused();
      await expect(player.locator(".game-recap__questions details").first()).toHaveAttribute("open", "");
      await scan(player, "personal recap expanded");
      await player.keyboard.press("Enter");
      await expect(questionSummary).toBeFocused();
      await expect(player.locator(".game-recap__questions details").first()).not.toHaveAttribute("open", "");
      await player.goto(`/results?code=${code}`);
      await expect(player.getByRole("heading", { name: "Final results" })).toBeFocused();
      await expect(player.getByRole("heading", { name: "Your recap" })).toBeVisible();
      await scan(player, "standalone results and recap");
      await keyboardActivate(host, host.getByRole("button", { name: "Revoke TV display link", exact: true }));
      await expect(host.getByRole("button", { name: "Open TV display", exact: true })).toBeFocused();
      await expect(tv.getByRole("heading", { name: "TV display link required" })).toBeFocused();
      await scan(tv, "TV revoked link");
      await scan(host, "display link revoked");
      await keyboardActivate(host, host.getByRole("button", { name: "Play again (same players)" }));
      await expect.poll(() => new URL(host.url()).searchParams.get("code")).not.toBe(code);
      const nextCode = new URL(host.url()).searchParams.get("code")!;
      const nextId = await host.evaluate(room => JSON.parse(sessionStorage.getItem(`trivia:host:${room}`)!).gameId as string, nextCode);
      trackGame(nextId);
      await expect.poll(() => new URL(player.url()).searchParams.get("code")).toBe(nextCode);
      await expect(host.getByRole("heading", { name: `Room ${nextCode}` })).toBeFocused();
      await expect(player.getByRole("heading", { name: "Keyboard player" })).toBeFocused();
      for (const page of [host, player]) {
        await expect(page.getByRole("status").filter({ hasText: `Room ${nextCode}.` })).toBeAttached();
        await scan(page, "rematch lobby transfer");
      }
    } finally {
      await hostContext.close();
      await playerContext.close();
      await tvContext.close();
      expect.soft(hydrationErrors, "No hydration errors across game phases, reloads and rematch transfer").toEqual([]);
    }
  });
}


test("pre-game review: keyboard regeneration/removal, focus recovery and axe", async ({ browser, trackGame }) => {
  const hostContext = await browser.newContext({ reducedMotion: "reduce" });
  const playerContext = await browser.newContext({ reducedMotion: "reduce" });
  const hydrationErrors = recordHydrationErrors([hostContext, playerContext]);
  try {
    const { page: host, code } = await hostCreateGame(hostContext, trackGame, { count: 2, hostPlays: false });
    const player = await playerJoin(playerContext, code, "Review spectator");
    await expect(host.getByRole("button", { name: "Review questions first" })).toBeEnabled();
    await keyboardActivate(host, host.getByRole("button", { name: "Review questions first" }));
    const review = host.getByRole("region", { name: "Question review" });
    await expect(review.getByRole("heading", { name: "Review questions (2)" })).toBeFocused();
    await Promise.all([scan(host, "pre-game question review"), scan(player, "waiting while host reviews")]);
    await keyboardActivate(host, review.getByRole("button", { name: "Regenerate question 1", exact: true }));
    await expect(review.getByRole("heading", { name: /Fixture 101:/ })).toBeFocused();
    await scan(host, "regenerated question review");
    await keyboardActivate(host, review.getByRole("button", { name: "Remove question 2", exact: true }));
    await expect(review.getByRole("heading", { name: "Review questions (1)" })).toBeFocused();
    await expect(review.getByRole("button", { name: "Remove question 1" })).toBeDisabled();
    await expect(review.getByRole("status")).toContainText("Question edit finished");
    await scan(host, "question removed from review");
    await keyboardActivate(host, host.getByRole("button", { name: "Start game", exact: true }));
    await expect(questionPrompt(player)).toHaveText("Fixture 101: spell the number 100.");
  } finally { await hostContext.close(); await playerContext.close(); expect.soft(hydrationErrors).toEqual([]); }
});
