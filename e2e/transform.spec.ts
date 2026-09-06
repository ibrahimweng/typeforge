/**
 * The box round the selection, driven the way a hand drives it.
 *
 * The arithmetic has its own tests and they run without a browser. What those
 * cannot say is whether the box is on screen, whether its handles can be
 * grabbed, and whether grabbing one moves the letter rather than starting a
 * fresh selection -- which is what the first version of this did, because a
 * box drawn round some points has its corners on those very points.
 */

import { expect, test } from "@playwright/test";

import { pointOnAnEdge, takeUpTool } from "./support";

type Page = import("@playwright/test").Page;

async function aLetterWithPoints(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto("/");
  await page.getByRole("button", { name: "Try the sample font" }).click();
  await expect(page.locator("[data-glyph-cell='o']")).toBeVisible({ timeout: 45_000 });
  await page.locator("[data-glyph-cell='o']").dblclick();
  await expect(page.locator("[data-points-panel]")).toBeVisible();
}

/** The outline as a number, so a change to it can be noticed. */
const shape = (page: Page): Promise<string> =>
  page.locator("[data-glyph-canvas]").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const { data } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    let hash = 0;
    for (let at = 0; at < data.length; at += 400) hash = (hash * 31 + data[at]) | 0;
    return String(hash);
  });

/**
 * Where the box's corners are on the page.
 *
 * The view publishes them in canvas coordinates, because where the canvas sits
 * on the page is not something it knows. Adding that here is the one thing a
 * test has that the view does not.
 */
async function cornersOnPage(
  page: Page,
): Promise<
  Record<"bottomLeft" | "bottomRight" | "topRight" | "topLeft", { x: number; y: number }>
> {
  const said = await page.locator("[data-transform-box]").getAttribute("data-transform-corners");
  expect(said, "the box should say where its corners are").not.toBeNull();
  const on = JSON.parse(said!) as Record<string, { x: number; y: number }>;
  const canvas = (await page.locator("[data-glyph-canvas]").boundingBox())!;
  return Object.fromEntries(
    Object.entries(on).map(([name, at]) => [name, { x: canvas.x + at.x, y: canvas.y + at.y }]),
  ) as never;
}

/** How many points each path has, which no matrix should change. */
const pointCounts = async (page: Page): Promise<string[]> =>
  page.locator("[data-paths-panel]").locator("text=/^\\d+ points$/").allInnerTexts();

/** Pick every point of the letter, which is what the box is drawn round. */
async function pickEverything(page: Page): Promise<void> {
  await takeUpTool(page, "select", "select");
  await page.locator("[data-glyph-canvas]").focus();
  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.locator("[data-points-scope]")).toContainText("points");
}

test("a selection gets a box, and a single point does not", async ({ page }) => {
  await aLetterWithPoints(page);
  const canvas = page.locator("[data-glyph-canvas]");

  await takeUpTool(page, "select", "select");
  await canvas.focus();
  await page.keyboard.press("Tab");
  await expect(page.locator("[data-points-scope]")).toHaveText("1 point");
  // One point has no box: eight handles in the same place are eight things to
  // grab that all do the same thing.
  await expect(page.locator("[data-transform-box]")).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.locator("[data-transform-box]")).toHaveAttribute("data-transform-box", "true");
});

test("a point of the selection can still be dragged", async ({ page }) => {
  /*
   * The regression this feature arrived with, and the reason the box stands
   * off the selection. A box drawn round some points has its corners on the
   * outermost of those points, so a handle drawn there sits on a node -- and
   * the first version took the press, which meant the very points defining the
   * selection were the ones that could no longer be moved.
   */
  await aLetterWithPoints(page);
  await pickEverything(page);
  const before = await shape(page);

  const edge = await pointOnAnEdge(page);
  await takeUpTool(page, "select", "select");
  await page.keyboard.press("ControlOrMeta+a");
  await page.mouse.move(edge.x, edge.y);
  await page.mouse.down();
  await page.mouse.move(edge.x, edge.y - 40, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  expect(await shape(page), "dragging a point should still move the letter").not.toBe(before);
});

test("the corner handle scales what is selected, as one step to undo", async ({ page }) => {
  await aLetterWithPoints(page);
  await pickEverything(page);

  const box = await cornersOnPage(page);

  const before = await shape(page);
  const counts = await pointCounts(page);

  await page.mouse.move(box.topRight.x, box.topRight.y);
  await page.mouse.down();
  await page.mouse.move(box.topRight.x + 120, box.topRight.y - 120, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(250);

  expect(await shape(page), "the letter should have grown").not.toBe(before);
  /*
   * And no points were added. Only a field warp cuts, and a scale is a matrix.
   *
   * The counts rather than the whole panel: the panel also prints each path's
   * width and height, which a scale is supposed to change, so comparing all of
   * it asserts that scaling did nothing.
   */
  expect(await pointCounts(page)).toEqual(counts);

  // And the whole drag is one thing to take back, not sixty.
  await page.locator("[data-glyph-canvas]").focus();
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(250);
  expect(await shape(page), "one undo should put the letter back").toBe(before);
});

test("the ring outside a corner turns the selection", async ({ page }) => {
  await aLetterWithPoints(page);
  await pickEverything(page);

  const box = await cornersOnPage(page);
  const before = await shape(page);

  // Outside the corner, where the rotation zone is and the scale handle is not.
  const from = { x: box.topRight.x + 14, y: box.topRight.y - 14 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - 60, from.y + 90, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(250);

  expect(await shape(page), "the letter should have turned").not.toBe(before);
});
