/**
 * The pen, and the operations that only make sense once it draws real curves.
 *
 * The maths is covered in `src/font/pen.test.ts` and the store's wiring in
 * `src/state/store.test.ts`; neither needs a browser and neither would have
 * caught what is here. What is left for this file is the part that exists only
 * as a gesture: whether holding and pulling makes a curve, whether a click on
 * an existing edge lands a point on it, and whether the sentence under the
 * canvas keeps up with the hand. Each of those failed at least once in a way
 * that read perfectly well on the page.
 */

import { expect, test } from "@playwright/test";

const sample = async (page: import("@playwright/test").Page) => {
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto("/");
  await page.getByRole("button", { name: "Try the sample font" }).click();
  await expect(page.locator("[data-glyph-cell='o']")).toBeVisible({ timeout: 45_000 });
  await page.locator("[data-glyph-cell='o']").dblclick();
  await expect(page.locator("[data-points-panel]")).toBeVisible();
};

/** How many points each path has, as the Paths panel reports them. */
const pathCounts = async (page: import("@playwright/test").Page): Promise<number[]> => {
  const lines = await page.locator("text=/^\\d+ points$/").allInnerTexts();
  return lines.map((one) => Number.parseInt(one, 10));
};

test("draws a closed curve by holding and pulling", async ({ page }) => {
  await sample(page);
  const before = (await pathCounts(page)).length;
  await page.locator("[data-tool='pen']").click();

  /*
   * Three points, each placed with a pull rather than a click. A pen that only
   * clicks draws polygons -- which is what this did, and why a person could
   * draw a perfectly good `o` and get a lozenge.
   */
  for (const [at, to] of [
    [{ x: 950, y: 250 }, { x: 1000, y: 210 }],
    [{ x: 1050, y: 350 }, { x: 1090, y: 400 }],
    [{ x: 880, y: 380 }, { x: 850, y: 420 }],
  ] as const) {
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
  }

  // Back to the first point, which is how an outline is closed.
  await page.mouse.move(950, 250);
  await expect(page.locator("[data-tool-says]")).toContainText("close");
  await page.mouse.click(950, 250);

  const after = await pathCounts(page);
  expect(after).toHaveLength(before + 1);
  expect(after[after.length - 1]).toBe(3);
  // Closed, so it fills: an open contour reports itself as a path either way,
  // and the status line is what says which happened.
  await expect(page.getByText("Outline closed.")).toBeVisible();
});

test("puts a point on an edge that is already there", async ({ page }) => {
  await sample(page);
  const before = await pathCounts(page);
  await page.locator("[data-tool='pen']").click();

  // The left flank of the `o`, which is a segment rather than a node.
  await page.mouse.click(503, 553);
  const after = await pathCounts(page);
  expect(after.reduce((a, b) => a + b, 0)).toBe(before.reduce((a, b) => a + b, 0) + 1);
});

test("the sentence under the canvas follows the tool", async ({ page }) => {
  await sample(page);
  const says = page.locator("[data-tool-says]");

  await page.locator("[data-tool='pen']").click();
  await page.mouse.move(950, 250);
  await expect(says).toContainText("outline");

  await page.locator("[data-tool='knife']").click();
  await page.mouse.move(950, 250);
  await expect(says).toContainText("cut");

  await page.locator("[data-tool='select']").click();
  await page.mouse.move(950, 250);
  await expect(says).not.toContainText("cut");
});

test("picks points by kind, and walks the path", async ({ page }) => {
  await sample(page);
  const scope = page.locator("[data-points-scope]");

  await page.locator("[data-select-row] button", { hasText: "All" }).click();
  await expect(scope).toHaveText("16 points");

  // An `o` has no corners, which is the check that this asks the geometry
  // rather than counting everything.
  await page.locator("[data-select-row] button", { hasText: "Corners" }).click();
  await expect(scope).toHaveText("none picked");

  await page.locator("[data-select-row] button", { hasText: "Smooths" }).click();
  await expect(scope).toHaveText("16 points");

  await page.locator("[data-select-row] button", { hasText: "None" }).click();
  await expect(scope).toHaveText("none picked");

  await page.locator("canvas").first().click({ position: { x: 40, y: 40 } });
  await page.keyboard.press("Tab");
  await expect(scope).toHaveText("1 point");
  await page.keyboard.press("ControlOrMeta+a");
  await expect(scope).toHaveText("16 points");
});

test("simplify says what it would cost before it runs", async ({ page }) => {
  await sample(page);
  const button = page.locator("[data-simplify] button").last();

  // The sample `o` is drawn on its extremes: at a close tolerance there is
  // nothing to take out, and saying so is the whole job.
  await page.locator("[data-simplify] button", { hasText: "Close" }).click();
  await expect(button).toHaveText("Nothing to simplify");

  await page.locator("[data-simplify] button", { hasText: "Far" }).click();
  await expect(button).toContainText("→");
  await button.click();
  await expect(page.getByText(/points out, \d+ left/)).toBeVisible();
});

test("the faults toggle rings what it finds and stays off until asked", async ({ page }) => {
  await sample(page);
  const toggle = page.locator("[data-marks-toggle]");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
});
