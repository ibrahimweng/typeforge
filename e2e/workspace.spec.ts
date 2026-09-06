/**
 * The reflexes a designer brings from every other drawing program.
 *
 * None of this is a feature in the sense of doing something the application
 * could not do. Every operation in the right-click menu was already reachable
 * from a tool or a panel, the canvas could already be panned two ways, and the
 * zoom already had a wheel. What was missing was the shape: where a hand
 * expects to find a thing, and what it expects to happen when it does the
 * thing it does everywhere else.
 *
 * That is worth testing at this level and almost nowhere else. Whether space
 * pans is not a question about a function; it is a question about whether a
 * key pressed at the window reaches a canvas through three listeners that each
 * decide whether the key was meant for them. The only honest way to ask it is
 * to press space and look at the letter.
 */

import { expect, test } from "@playwright/test";

import { openFont, takeUpTool } from "./support";

type Page = import("@playwright/test").Page;

/** How many paths the letter has, off the panel that counts them. */
const pathCount = async (page: Page): Promise<number> =>
  Number.parseInt(await page.locator("text=/^\\d+ paths?$/").first().innerText(), 10);

async function openALetter(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();
  await expect(page.locator("[data-glyph-canvas]")).toBeVisible();
}

/**
 * What the canvas has drawn on it, as a number.
 *
 * Panning moves the letter and changes no font data at all, so there is
 * nothing in the document to assert against. The pixels are the only witness.
 * A hash of them is enough: the question is whether the drawing moved, not
 * where it went.
 */
async function canvasPrint(page: Page): Promise<string> {
  return page.locator("[data-glyph-canvas]").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext("2d")!;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let hash = 0;
    // Every hundredth pixel, which is plenty to notice a letter that moved and
    // is a great deal faster than four million of them.
    for (let at = 0; at < data.length; at += 400) hash = (hash * 31 + data[at]) | 0;
    return String(hash);
  });
}

test("space puts the hand out, and the letter moves rather than the point", async ({ page }) => {
  await openALetter(page);
  const canvas = page.locator("[data-glyph-canvas]");
  const box = (await canvas.boundingBox())!;
  const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  // The knife in hand, so a press that is not a pan would very obviously be
  // something else. Nothing here should reach it.
  await takeUpTool(page, "knife", "knife");
  await canvas.focus();

  const before = await canvasPrint(page);
  const paths = await page.locator("[data-paths-panel]").textContent();

  await page.keyboard.down("Space");
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.down();
  await page.mouse.move(middle.x + 160, middle.y + 90, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await page.waitForTimeout(200);

  expect(await canvasPrint(page), "the letter should have moved under the hand").not.toBe(before);
  // And the knife did not cut, which is the half that says space beat the tool
  // rather than merely also happening.
  expect(await page.locator("[data-paths-panel]").textContent()).toBe(paths);
});

test("space still presses the button it is pressed on", async ({ page }) => {
  /*
   * The half of the hand that is easy to get wrong, and the reason the guard
   * this shares with the editing keys exists at all. Space is how a focused
   * button is pressed from the keyboard. Taking it at the window for the
   * canvas would leave every button on the page pressable by mouse only,
   * which is the same fault as the Tab trap with a different key.
   */
  await openALetter(page);
  const snap = page.locator("[data-snap-toggle]");
  const was = await snap.getAttribute("aria-pressed");

  await snap.focus();
  await page.keyboard.press("Space");
  // Neither the hand nor the palette: the hand stands aside because the focus
  // is on a control, and the palette stands aside because a letter is open.

  await expect(snap).not.toHaveAttribute("aria-pressed", was!);
});

test("the zoom can be typed into, and Fit puts the letter back", async ({ page }) => {
  await openALetter(page);
  const zoom = page.locator("[data-status-bar]").getByRole("textbox", { name: "Zoom" });
  await expect(zoom).toHaveValue("100");

  const fitted = await canvasPrint(page);

  await zoom.fill("240");
  await zoom.press("Enter");
  await page.waitForTimeout(250);
  await expect(zoom).toHaveValue("240");
  expect(await canvasPrint(page), "the letter should be drawn larger").not.toBe(fitted);

  await page.locator("[data-fit-canvas]").click();
  await page.waitForTimeout(250);
  await expect(zoom).toHaveValue("100");
});

test("a right click offers what can be done to the thing under it", async ({ page }) => {
  await openALetter(page);
  const canvas = page.locator("[data-glyph-canvas]");
  const box = (await canvas.boundingBox())!;

  // On empty canvas: the letter's own operations and nothing about a path,
  // because no path was clicked.
  await page.mouse.click(box.x + 20, box.y + 20, { button: "right" });
  const menu = page.locator("[data-canvas-menu]");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Select every point" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Delete this path" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
});

test("the menu acts on the path it was opened on", async ({ page }) => {
  await openALetter(page);
  const canvas = page.locator("[data-glyph-canvas]");
  const box = (await canvas.boundingBox())!;

  /*
   * A rectangle drawn on purpose, rather than a point hunted for on a letter
   * somebody else drew. Its corners are where the drag put them, so the test
   * knows exactly where a point is without working out the view transform for
   * itself -- which would be asserting its own arithmetic against the view's.
   */
  const before = await pathCount(page);
  const corner = { x: box.x + 120, y: box.y + 120 };
  await takeUpTool(page, "shape", "rectangle");
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x + 220, corner.y + 180, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(250);

  const drawn = await pathCount(page);
  expect(drawn, "the rectangle should have been added to the letter").toBe(before + 1);

  await takeUpTool(page, "select", "select");
  await page.mouse.click(corner.x, corner.y, { button: "right" });
  const menu = page.locator("[data-canvas-menu]");
  await expect(menu).toBeVisible();

  /*
   * A freshly drawn rectangle leaves its four points picked, and the click was
   * on one of them -- so the menu offers the four rather than the one. That is
   * what every program does with a right click inside a selection, and picking
   * six points only to lose five of them to a right click would be its own
   * kind of wrong.
   */
  await expect(menu.getByRole("menuitem", { name: "Delete 4 points" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Reverse its direction" })).toBeVisible();

  // With nothing picked it is the one point under the pointer again.
  await menu.getByRole("menuitem", { name: "Pick nothing" }).click();
  await page.mouse.click(corner.x, corner.y, { button: "right" });
  await expect(menu.getByRole("menuitem", { name: "Delete point", exact: true })).toBeVisible();

  await menu.getByRole("menuitem", { name: "Delete this path" }).click();
  await expect(menu).toHaveCount(0);
  await expect
    .poll(() => pathCount(page), { message: "the rectangle should be gone" })
    .toBe(drawn - 1);
});

test("the tools stay where they are, whatever screen you are on", async ({ page }) => {
  await openALetter(page);
  const rail = page.locator("[data-tool-palette]");

  // Live on the letter.
  await expect(rail).toBeVisible();
  await expect(rail).toHaveAttribute("data-tool-rail-drawing", "true");
  await expect(page.locator("[data-tool-group='pen']")).toBeEnabled();

  /*
   * And still there on the spacing table, greyed. It used to be mounted by the
   * view that draws, so it vanished here -- and a rail that comes and goes is
   * a rail nobody builds a habit around.
   */
  await page.getByRole("button", { name: "Spacing", exact: true }).click();
  await expect(rail).toBeVisible();
  await expect(rail).toHaveAttribute("data-tool-rail-drawing", "false");
  await expect(page.locator("[data-tool-group='pen']")).toBeDisabled();

  /*
   * And its key does nothing here, which is what being greyed has to mean.
   *
   * The focus is dropped first, on purpose. Left on the Spacing button the key
   * would be turned away by the guard about where the focus is, and the test
   * would pass without ever reaching the guard it is about.
   */
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("k");
  await page.getByRole("button", { name: "Glyph", exact: true }).click();
  await expect(page.locator("[data-status-tool]")).not.toHaveText("Knife");
});

test("the options bar carries the tool's own controls", async ({ page }) => {
  await openALetter(page);
  const bar = page.locator("[data-options-bar]");
  await expect(bar).toBeVisible();

  await takeUpTool(page, "select", "select");
  await expect(page.locator("[data-options-tool]")).toHaveText("Select");
  // The polygon's side count is the polygon's, so it is not offered here.
  await expect(page.locator("[data-polygon-sides]")).toHaveCount(0);

  await takeUpTool(page, "shape", "polygon");
  await expect(page.locator("[data-options-tool]")).toHaveText("Polygon");
  await expect(bar.locator("[data-polygon-sides]")).toBeVisible();
  const sides = Number(
    (await bar.locator("[data-polygon-sides]").innerText()).replace(/\D+/g, "").slice(-1),
  );
  await bar.getByRole("button", { name: "One side more" }).click();
  await expect(bar.locator("[data-polygon-sides]")).toContainText(String(sides + 1));

  // And the switches about the surface, which used to share a row with the
  // letters standing either side.
  await expect(bar.locator("[data-snap-toggle]")).toBeVisible();
  await expect(bar.locator("[data-add-guide]")).toBeVisible();
});

test("the status bar says where you are and what is in hand", async ({ page }) => {
  await openALetter(page);
  const bar = page.locator("[data-status-bar]");

  await expect(bar.locator("[data-status-document]")).toContainText("DejaVu Sans");
  await expect(bar.locator("[data-status-document]")).toContainText("letters");

  await takeUpTool(page, "knife", "knife");
  await expect(bar.locator("[data-status-tool]")).toHaveText("Knife");

  /*
   * And no zoom where there is no canvas, rather than the last letter's. A
   * zoom control on the spacing table would be a control over a canvas that is
   * not on screen.
   */
  await expect(bar.locator("[data-zoom]")).toBeVisible();
  await page.getByRole("button", { name: "Spacing", exact: true }).click();
  await expect(bar.locator("[data-zoom]")).toHaveCount(0);
  await expect(bar.locator("[data-status-document]")).toContainText("DejaVu Sans");
});
