/**
 * What the application says back.
 *
 * The application could already find every one of these faults and only ever
 * said so on a separate page, which is a page somebody has to know to go and
 * visit. An unclosed outline is a thing to fix while the pen is still in your
 * hand.
 *
 * These pin that the strip over the canvas is live -- it appears when the fault
 * is made and goes when it is fixed, without anything being run by hand -- and
 * that it is not drawn at all when there is nothing to say.
 *
 * And the other half of the same idea: Undo took something back without ever
 * saying what, which on a screen where the change is small, or in a letter you
 * are no longer looking at, is indistinguishable from pressing a dead button.
 */
import { expect, test, type Page } from "@playwright/test";

const OPEN_CONTOUR = "An outline is not closed";

async function sampleGlyph(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto("/");
  await page.getByRole("button", { name: "Try the sample font" }).click();
  await expect(page.locator("[data-glyph-cell='o']")).toBeVisible({ timeout: 45_000 });
  await page.locator("[data-glyph-cell='o']").dblclick();
  await expect(page.locator("[data-points-panel]")).toBeVisible();
}

test("an unclosed outline is reported as it is drawn, and forgotten as it is closed", async ({
  page,
}) => {
  await sampleGlyph(page);

  const fault = page.locator("[data-glyph-fault]").filter({ hasText: OPEN_CONTOUR });
  await expect(fault).toHaveCount(0);

  await page.locator("[data-tool='pen']").click();
  // Three points placed with a pull, which is a curve rather than a polygon,
  // and left open.
  for (const [at, to] of [
    [
      { x: 950, y: 250 },
      { x: 1000, y: 210 },
    ],
    [
      { x: 1050, y: 350 },
      { x: 1090, y: 400 },
    ],
    [
      { x: 880, y: 380 },
      { x: 850, y: 420 },
    ],
  ] as const) {
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
  }

  // Nobody ran anything. The fault is on screen because the fault exists.
  await expect(fault).toHaveCount(1);
  await expect(fault).toHaveAttribute("data-glyph-fault", "error");

  // Back onto the first point, which is how an outline is closed.
  await page.mouse.move(950, 250);
  await expect(page.locator("[data-tool-says]")).toContainText("close");
  await page.mouse.click(950, 250);
  await expect(page.getByText("Outline closed.")).toBeVisible();

  await expect(fault).toHaveCount(0);
});

test("a letter with nothing wrong gets no strip at all", async ({ page }) => {
  await sampleGlyph(page);

  /*
   * Measured across o, a, e, n and s of the sample: no strip on any of them,
   * and no fault inside one. A warning that is on screen all the time is a
   * warning nobody reads, so the price of showing faults here is that a clean
   * letter is given nothing at all.
   */
  await expect(page.locator("[data-glyph-faults]")).toHaveCount(0);

  for (const letter of ["a", "e", "n"]) {
    await page.getByRole("button", { name: "Font", exact: true }).click();
    await page.locator(`[data-glyph-cell='${letter}']`).dblclick();
    await expect(page.locator("[data-points-panel]")).toBeVisible();
    await expect(page.locator("[data-glyph-faults]")).toHaveCount(0);
  }
});

test("undo and redo say what they moved", async ({ page }) => {
  await sampleGlyph(page);

  // One click, one entry on the stack, and the stack has always known its
  // name: "Reverse path direction".
  await page.locator('[aria-label="Reverse path 1"]').click();

  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeEnabled();
  await expect(undo).toHaveAttribute("title", "Undo reverse path direction (⌘Z)");

  await undo.click();
  await expect(page.getByText("Undone: Reverse path direction")).toBeVisible();

  const redo = page.getByRole("button", { name: "Redo", exact: true });
  await expect(redo).toHaveAttribute("title", "Redo reverse path direction (⇧⌘Z)");
  await redo.click();
  await expect(page.getByText("Redone: Reverse path direction")).toBeVisible();
});
