import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { test, expect, localDatabase } from "./test";
import { hostCreateGame, playerJoin, questionPrompt } from "./helpers";

test.use({ actionTimeout: 20_000 });

async function scan(page: Page, phase: string) {
  await test.step(`axe: ${phase}`, async () => {
    if (await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)) {
      const moving = await page.locator("main, main *").evaluateAll(elements => elements.flatMap(el => {
        const style = getComputedStyle(el);
        return style.animationName !== "none" || style.transitionDuration.split(",").some(value => parseFloat(value) > 0)
          ? [el.outerHTML.slice(0, 160)] : [];
      }));
      expect(moving, "Reduced motion must disable animation and transitions throughout the screen").toEqual([]);
    }
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(result.violations.filter(v => v.impact === "serious" || v.impact === "critical"),
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
    await page.emulateMedia({ reducedMotion });
    for (const route of ["/", "/setup", "/join"]) {
      await page.goto(route);
      if (route === "/setup") {
        const timer = page.getByRole("combobox", { name: /^Answer timer/ });
        await timer.selectOption("60000");
        await expect(timer).toHaveValue("60000");
      }
      await scan(page, route);
    }
  });
}

for (const mode of ["multiple_choice", "type_answer"] as const) {
  test(`${mode}: host and player phases, axe and keyboard round`, async ({ browser, trackGame }) => {
    test.setTimeout(180_000);
    const hostContext = await browser.newContext({ reducedMotion: "reduce" });
    const playerContext = await browser.newContext({ reducedMotion: "reduce" });
    try {
      const { page: host, code } = await hostCreateGame(hostContext, trackGame, { mode, count: 1, hostPlays: false, answerTimerMs: 60000 });
      const player = await playerJoin(playerContext, code, "Keyboard player");
      await Promise.all([scan(host, "host lobby"), scan(player, "player lobby")]);
      await keyboardActivate(host, host.getByRole("button", { name: "Start game" }));
      // Extend only this isolated fixture's reveal window: axe must finish
      // while both devices are still showing get-ready, even on a cold runner.
      const db = localDatabase();
      const { error: extendError } = await db.from("games").update({ reveal_at: new Date(Date.now() + 60_000).toISOString() }).eq("code", code);
      expect(extendError).toBeNull();
      await Promise.all([host.reload(), player.reload()]);
      await expect(player.getByRole("timer", { name: /Next question in/ })).toBeVisible();
      await Promise.all([scan(host, "host get-ready"), scan(player, "player get-ready")]);
      const { error: revealError } = await db.from("games").update({ reveal_at: new Date(Date.now() + 1500).toISOString() }).eq("code", code);
      expect(revealError).toBeNull();
      await Promise.all([host.reload(), player.reload()]);
      await expect(questionPrompt(player)).toBeVisible();
      await expect(questionPrompt(player)).toBeFocused();
      await Promise.all([scan(host, `host ${mode}`), scan(player, `player ${mode}`)]);

      // Challenge and resolve entirely with the keyboard, before answering.
      await keyboardActivate(player, player.getByRole("button", { name: "Challenge this question" }));
      await expect(host.getByRole("button", { name: "Reject" })).toBeVisible();
      await Promise.all([scan(host, "host paused"), scan(player, "player paused")]);
      await keyboardActivate(host, host.getByRole("button", { name: "Reject" }));
      await expect(questionPrompt(player)).toBeFocused();
      if (mode === "multiple_choice") {
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
      await Promise.all([scan(host, "host review"), scan(player, "player review")]);
      await keyboardActivate(host, host.getByRole("button", { name: "Finish game" }));
      for (const page of [host, player]) {
        await expect(page.getByRole("heading", { name: "Final results" })).toBeFocused();
        await scan(page, "results");
        const motion = await page.locator(".podium-step").evaluateAll(elements => elements.map(el => {
          const style = getComputedStyle(el);
          return { animation: style.animationName, opacity: style.opacity, transition: style.transitionDuration };
        }));
        for (const style of motion) expect(style).toEqual({ animation: "none", opacity: "1", transition: "0s" });
      }
    } finally {
      await hostContext.close();
      await playerContext.close();
    }
  });
}
