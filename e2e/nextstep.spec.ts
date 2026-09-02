/**
 * The line that says what to do next.
 *
 * Everything this tool can do was reachable and nothing said which of it to do
 * first, so the order of the work had to be known before you arrived. These pin
 * that the line reads the document rather than guessing, that its button does
 * what it says, that somebody who knows the craft can turn it off for good, and
 * and that somebody who knows the craft can turn it off for good.
 */
import { test, expect, type Page } from "@playwright/test";

const LINE = "[data-next-step]";

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
