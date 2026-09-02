/**
 * The line that says what to do next.
 *
 * Everything this tool can do was reachable and nothing said which of it to do
 * first, so the order of the work had to be known before you arrived. These pin
 * that the line reads the document rather than guessing, that its button does
 * what it says, that it carries what the checks found, and that somebody who
 * knows the craft can turn it off for good.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect, type Page } from "@playwright/test";

const LINE = "[data-next-step]";

// The one fixture that arrives already kerned, which is the rung above the
// checks. Reached the way a person reaches it: from the folder input.
const UFO = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "test",
  "fixtures",
  "FixtureSans-Regular.ufo",
);

async function sample(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Try the sample font" }).click();
  await expect(page.getByText("221 glyphs", { exact: true })).toBeVisible({ timeout: 30_000 });
}

test("Draw is told to make it theirs, then offered the way on", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Draw", exact: true }).click();

  // Nothing touched yet. The forge draws an alphabet before you arrive, so a
  // letter on screen says nothing about whether this person has done anything.
  await expect(page.locator(LINE)).toHaveAttribute("data-next-step", "forge-touch");
  await expect(page.locator(LINE)).toContainText("drag Weight");

  const weight = page.getByRole("slider", { name: "Weight" }).first();
  await weight.focus();
  await weight.press("ArrowRight");

  await expect(page.locator(LINE)).toHaveAttribute("data-next-step", "forge-hand");
  await expect(
    page.locator(LINE).getByRole("button", { name: "Open in the editor" }),
  ).toBeVisible();
});

test("the line reads the font, and its button goes where it says", async ({ page }) => {
  await page.goto("/");
  await sample(page);

  // The sample has letters and a name, and nothing kerned.
  await expect(page.locator(LINE)).toHaveAttribute("data-next-step", "edit-kern");
  await page.locator(LINE).getByRole("button", { name: "Open kerning" }).click();
  await expect(page.getByRole("button", { name: "Kerning", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("the ladder is about the font and not about the screen", async ({ page }) => {
  await page.goto("/");
  await sample(page);

  /*
   * The sample has nothing kerned, so that is the step wherever you stand. A
   * line that changed with the view would be telling you about the screen, and
   * what somebody needs to know is what the font is still missing.
   */
  for (const view of ["Glyph", "Spacing", "Proof", "Checks"]) {
    await page.getByRole("button", { name: view, exact: true }).click();
    await expect(page.locator(LINE)).toHaveAttribute("data-next-step", "edit-kern");
  }
});

test("somebody who knows the craft turns it off, and it stays off", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await expect(page.locator(LINE)).toBeVisible();

  await page.getByRole("button", { name: "Turn this off" }).click();
  await expect(page.locator(LINE)).toBeHidden();

  await page.reload();
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await expect(page.locator(LINE)).toBeHidden();
});

test("the checks are the last rung, and the line carries what they found", async ({ page }) => {
  test.skip(!existsSync(UFO), "needs the fixture UFO");
  await page.goto("/");
  await page.setInputFiles("[data-open-folder-input]", UFO);
  await expect(page.getByText("Fixture Sans").first()).toBeVisible({ timeout: 30_000 });

  /*
   * This one arrives with letters, a name and a kerned pair, so it is standing
   * on the rung the sample never reaches: nothing has looked at the font yet,
   * and that is worth knowing before it is written out rather than after.
   */
  await expect(page.locator(LINE)).toHaveAttribute("data-next-step", "edit-check");
  // Nothing has run, so the tab carries no count.
  await expect(page.locator("[data-check-count]")).toHaveCount(0);

  await page.locator(LINE).getByRole("button", { name: "Run the checks" }).click();
  await expect(page.getByRole("button", { name: "Checks", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  /*
   * The view checks on arrival, and what it found is now something the rest of
   * the application can say. The number on the line is read off the number in
   * the report rather than written down here, because the point is that they
   * are the same number and not what the number happens to be.
   */
  const errors = page.locator('[data-severity="error"]');
  await expect(errors).toBeVisible({ timeout: 60_000 });
  const count = Number.parseInt((await errors.innerText()).trim(), 10);
  expect(count).toBeGreaterThan(0);

  await expect(page.locator(LINE)).toHaveAttribute("data-next-step", "edit-fix");
  await expect(page.locator(LINE)).toContainText(`${count} thing`);
  await expect(page.locator("[data-check-count]")).toHaveText(String(count));

  /*
   * And the tab is still called what it was called. The count is hidden from
   * the accessible name on purpose -- "Checks 4" is a different tab from
   * "Checks" to a screen reader and to every test that asks for one -- and it
   * reaches a screen reader through the button's description instead.
   */
  const tab = page.getByRole("button", { name: "Checks", exact: true });
  await expect(tab).toHaveCount(1);
  await expect(tab).toHaveAttribute("title", new RegExp(`found ${count} error`));

  /*
   * And the findings go with the document they were read from. Opening a font
   * after this one is a font nothing has looked at: left in place, the tab
   * would carry the last font's error count over a font that has none of them,
   * and the line would offer to fix faults that are not there.
   */
  await page.setInputFiles("[data-open-folder-input]", UFO);
  await expect(page.locator("[data-check-count]")).toHaveCount(0);
  await expect(page.locator(LINE)).toHaveAttribute("data-next-step", "edit-check");
});
