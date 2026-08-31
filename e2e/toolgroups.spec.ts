/**
 * The tools, driven the way somebody reaches for one.
 *
 * These exist because of a screenshot: twelve paths of litter in one letter,
 * every one of them an outline somebody started and could not finish. The
 * defect was not in any of the maths -- it was that the pen had no verb for
 * "I am done with this", so every abandoned attempt stayed for ever. Nothing
 * about that is visible from reading a function, and nothing in the unit tests
 * could have caught it: each piece worked exactly as written.
 *
 * So the tests here are gestures rather than calls, and the first of them is
 * the screenshot itself, made deliberately and expected not to happen.
 */

import { expect, test } from "@playwright/test";

type Page = import("@playwright/test").Page;

const GROUP: Record<string, string> = {
  select: "select",
  selectPath: "select",
  lasso: "select",
  pen: "pen",
  freehand: "pen",
  addPoint: "pen",
  deletePoint: "pen",
  convertPoint: "pen",
  rectangle: "shape",
  ellipse: "shape",
  polygon: "shape",
  knife: "knife",
  scissors: "knife",
};

const sample = async (page: Page, glyph = "A") => {
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto("/");
  await page.getByRole("button", { name: "Try the sample font" }).click();
  await expect(page.locator(`[data-glyph-cell='${glyph}']`)).toBeVisible({ timeout: 45_000 });
  await page.locator(`[data-glyph-cell='${glyph}']`).dblclick();
  await expect(page.locator("[data-points-panel]")).toBeVisible();
};

/** Take up a tool through its group's flyout, as a person would. */
const pick = async (page: Page, tool: string) => {
  const group = page.locator(`[data-tool-group='${GROUP[tool]}']`);
  await group.click();
  if ((await page.locator(`[data-flyout-tool='${tool}']`).count()) === 0) await group.click();
  await page.locator(`[data-flyout-tool='${tool}']`).click();
  await expect(page.locator(`[data-tool-flyout]`)).toHaveCount(0);
};

const pathCount = async (page: Page): Promise<number> =>
  Number.parseInt(await page.locator("text=/^\\d+ paths?$/").first().innerText(), 10);

const says = (page: Page) => page.locator("[data-tool-says]");

test("the flyout names every tool in the group", async ({ page }) => {
  await sample(page);
  await page.locator("[data-tool-group='pen']").click();
  await page.locator("[data-tool-group='pen']").click();
  const flyout = page.locator("[data-tool-flyout='pen']");
  await expect(flyout).toBeVisible();
  // By role, because the group's own name appears in the header as well as on
  // its first tool, and a plain text match finds both.
  for (const name of ["Pen", "Freehand", "Add point", "Delete point", "Convert point"]) {
    await expect(flyout.getByRole("menuitemradio", { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  // The key, which used to live in a hover and nowhere else.
  await expect(flyout.getByText("P", { exact: true })).toBeVisible();
});

test("an outline abandoned leaves nothing behind", async ({ page }) => {
  await sample(page);
  const before = await pathCount(page);
  await pick(page, "pen");

  /*
   * The screenshot, made on purpose: start something, think better of it,
   * five times over. Every one of these used to survive as a contour drawing
   * as nothing and sitting in the list for ever.
   */
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.mouse.click(400 + attempt * 40, 250);
    await page.mouse.click(440 + attempt * 40, 250);
    await page.keyboard.press("Escape");
  }
  expect(await pathCount(page)).toBe(before);
});

test("Escape keeps an outline worth keeping, and the next click starts a fresh one", async ({
  page,
}) => {
  await sample(page);
  const before = await pathCount(page);
  await pick(page, "pen");

  await page.mouse.click(400, 250);
  await page.mouse.click(500, 250);
  await page.mouse.click(450, 330);
  await page.keyboard.press("Escape");
  expect(await pathCount(page)).toBe(before + 1);

  /*
   * The bug that hid behind the missing verb: `open` was read off the shape
   * rather than off the session, so a click anywhere reached back and extended
   * an outline already walked away from. Five attempts became one contour
   * wandering across the letter.
   */
  await page.mouse.click(900, 250);
  expect(await pathCount(page)).toBe(before + 2);
  await page.keyboard.press("Escape");
});

test("closing forgives a miss, and says so before the click", async ({ page }) => {
  await sample(page);
  await pick(page, "pen");
  await page.mouse.click(700, 250);
  await page.mouse.click(800, 250);
  await page.mouse.click(750, 330);

  // Twelve pixels off the first point: a normal human miss, which used to
  // silently add a fourth point instead of closing.
  await page.mouse.move(712, 252);
  await expect(says(page)).toContainText("close the outline");
  await page.mouse.click(712, 252);
  await expect(page.getByText("Outline closed.")).toBeVisible();
});

test("the status line keeps up with the gesture", async ({ page }) => {
  await sample(page);
  await pick(page, "pen");

  // Over empty canvas with nothing drawn, the pen names both things a press
  // can be. It used to claim `Click to start an outline` even over an edge
  // where the click would instead put a point on that edge.
  await page.mouse.move(400, 250);
  await expect(says(page)).toContainText("corner");
  await expect(says(page)).toContainText("pull");

  await page.mouse.click(400, 250);
  await page.mouse.click(500, 250);
  await page.mouse.click(450, 330);
  await expect(says(page)).toContainText("Escape");

  // The line is refreshed when the gesture ends, which it never was: it kept
  // the mid-drag sentence until the pointer next moved.
  await page.keyboard.press("Escape");
  await expect(says(page)).toContainText("corner");
});

test("the tools that need a target go blunt where there is none", async ({ page }) => {
  await sample(page, "o");
  const canvas = page.locator("canvas").first();

  for (const tool of ["addPoint", "deletePoint", "convertPoint", "scissors"]) {
    await pick(page, tool);
    // Well away from the letter, in the descender space.
    await page.mouse.move(300, 850);
    await expect(canvas, tool).toHaveClass(/cursor-not-allowed/);
    await expect(says(page), tool).toContainText("Point at");
  }
});

test("add and delete a point on an edge", async ({ page }) => {
  await sample(page, "o");
  const points = async () => (await page.locator("text=/^\\d+ points$/").allInnerTexts()).join("/");
  const before = await points();

  await pick(page, "addPoint");
  await page.mouse.move(503, 553);
  await expect(says(page)).toContainText("Click to put a point here");
  await page.mouse.click(503, 553);
  await expect(async () => expect(await points()).not.toBe(before)).toPass();

  await pick(page, "deletePoint");
  await page.mouse.click(503, 553);
  await expect(async () => expect(await points()).toBe(before)).toPass();
});

test("the lasso picks what a box cannot", async ({ page }) => {
  await sample(page, "o");
  await pick(page, "lasso");
  await page.mouse.move(460, 400);
  await page.mouse.down();
  for (const [x, y] of [
    [760, 400],
    [760, 720],
    [460, 720],
    [460, 400],
  ]) {
    await page.mouse.move(x, y, { steps: 6 });
  }
  await page.mouse.up();
  await expect(page.locator("[data-points-scope]")).toContainText("points");
});

test("the polygon draws the number of sides it is set to", async ({ page }) => {
  await sample(page);
  await pick(page, "polygon");
  const sides = page.locator("[data-polygon-sides]");
  await expect(sides).toBeVisible();
  await sides.getByRole("button", { name: "One side fewer" }).click();
  await sides.getByRole("button", { name: "One side fewer" }).click();
  await sides.getByRole("button", { name: "One side fewer" }).click();

  await page.mouse.move(950, 300);
  await page.mouse.down();
  await page.mouse.move(1120, 470, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator("text=/^3 points$/").last()).toBeVisible();
});

test("scissors open a shape rather than cutting it in two", async ({ page }) => {
  await sample(page, "o");
  const before = await pathCount(page);
  await pick(page, "scissors");
  await page.mouse.move(503, 553);
  await expect(says(page)).toContainText("open the shape");
  await page.mouse.click(503, 553);
  await expect(page.getByText("Opened.", { exact: false })).toBeVisible();
  // Opened, not cut: the same number of paths, one of them no longer closed.
  expect(await pathCount(page)).toBe(before);
});

test("pointing at a path in the list says which one it is", async ({ page }) => {
  await sample(page, "o");
  const row = page.locator('[data-path-row="0"]');
  await row.hover();
  // The highlight is drawn on a canvas, so what is assertable is that hovering
  // costs no selection -- which is what made the list unreadable: the only way
  // to identify a row was to click it and spend whatever you had picked.
  await expect(page.locator("[data-points-scope]")).toHaveText("none picked");
});

test("the knife says when there is nothing to cut", async ({ page }) => {
  await sample(page);
  await pick(page, "knife");
  await page.mouse.move(880, 700);
  await expect(says(page)).toContainText("across a shape");

  // A letter with nothing drawn in it: the same sentence used to appear here,
  // which made the one case worth warning about look exactly like the working one.
  await page.getByRole("button", { name: "New letter" }).click();
  await page.waitForTimeout(400);
  await pick(page, "knife");
  await page.mouse.move(600, 500);
  await expect(says(page)).toContainText("Nothing to cut");
});
