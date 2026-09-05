/**
 * What a panel puts first.
 *
 * Neither of the two panels somebody lives in was ranked at all. Draw's is
 * eight thousand six hundred pixels tall in an eight hundred pixel window --
 * ten and a half screens -- and it opened with the twenty starting points you
 * choose once, then put nine sections about parts of letters between the pen
 * and the proportions, so Proportions began 4,983 pixels down. The editor's
 * opened with seven hundred and forty pixels of guidance about which letters to
 * draw first, above the parameters it is named for.
 *
 * Nothing was moved out of reach. These pin the order, and that everything that
 * moved down is still there.
 *
 * Read off `data-panel-section` rather than off the prose, because the prose
 * collides with itself: the Sans blurb says "ordinary proportions" above the
 * Proportions heading, and the scope switch says "n alone" above the rule that
 * says the same.
 */
import { test, expect, type Page } from "@playwright/test";

/**
 * The panel's stretches, in the order they are laid out.
 *
 * Waited for before it is read. These panels are fetched when their mode is
 * first shown, so for a moment after the click the column is there and empty,
 * and `evaluateAll` does not wait -- it read that moment as a panel with no
 * sections in it and failed on an order that was about to be right.
 */
async function sections(page: Page, panel: string): Promise<string[]> {
  const marks = page.locator(`${panel} [data-panel-section]`);
  await marks.first().waitFor();
  return marks.evaluateAll((els) => els.map((el) => el.getAttribute("data-panel-section") ?? ""));
}

test("Draw puts the three that decide the font first", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Draw", exact: true }).click();

  expect(await sections(page, 'aside[aria-label="Forge"]')).toEqual([
    "start",
    "pen",
    "proportions",
    "parts",
    "finishing",
    "letter",
  ]);
});

test("nothing Draw moved down went away", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Draw", exact: true }).click();

  const panel = page.locator('aside[aria-label="Forge"]');
  for (const still of ["Joining", "Cut", "Cast", "Draw n yourself"]) {
    await expect(panel.getByText(still, { exact: true }).first()).toBeAttached();
  }
});

test("the editor puts the parameters above the reading", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the sample font" }).click();
  await expect(page.getByText("221 glyphs", { exact: true })).toBeVisible({ timeout: 30_000 });

  expect(await sections(page, 'aside[aria-label="Parameters"]')).toEqual([
    "params",
    "where-to-start",
  ]);
  // And the block that moved down is still there to be read.
  await expect(page.getByText("Control letters").first()).toBeAttached();
});
