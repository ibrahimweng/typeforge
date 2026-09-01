/**
 * The quick action palette, driven the way somebody would drive it.
 *
 * The search itself is checked in `src/palette/search.test.ts`, where the
 * ranking can be asserted without a browser. What is left for here is the part
 * that only exists in a browser: that the shortcut opens it over whatever is in
 * front, that the keyboard walks it, that picking a control moves the real font
 * rather than just closing the box, and that the two actions which throw work
 * away stop and ask first.
 */

import { expect, test } from "@playwright/test";

const open = async (page: import("@playwright/test").Page) => {
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("dialog", { name: "Quick actions" })).toBeVisible();
};

const dialog = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog", { name: "Quick actions" });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Draw", exact: true }).click();
});

test("opens on the shortcut and closes on escape", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Quick actions" })).toBeHidden();
});

test("shows somewhere to start before anything is typed", async ({ page }) => {
  await open(page);
  const dialog = page.getByRole("dialog", { name: "Quick actions" });
  await expect(dialog.getByRole("option").first()).toBeVisible();
});

test("finds a control from a description rather than its name", async ({ page }) => {
  await open(page);
  await page.getByRole("textbox", { name: "Search everything" }).fill("the letters are too close together");
  const dialog = page.getByRole("dialog", { name: "Quick actions" });
  // Whatever wins, it has to be about spacing rather than about a letter.
  await expect(dialog.getByRole("option").first()).toContainText(/spac|kern|sidebearing|aperture/i);
});

test("adjusts a control in the palette, and the font moves behind it", async ({ page }) => {
  await open(page);
  await page.getByRole("textbox", { name: "Search everything" }).fill("~squareness");
  const dialog = page.getByRole("dialog", { name: "Quick actions" });
  const first = dialog.getByRole("option").first();
  await expect(first).toContainText(/squareness/i);
  await first.click();
  // The row opens a slider rather than closing the palette.
  await expect(dialog).toBeVisible();

  /*
   * Dragged, and the number checked afterwards.
   *
   * Asserting that the slider is on screen is not the same as asserting that
   * it works, and the difference is not academic: this test passed while a
   * drag across the whole track moved the value by one step, because the
   * palette read the control back after every change and handed the slider
   * the value from before the change it had just made.
   *
   * The drag has to take hold of the thumb. The element carrying the slider
   * role is the whole group, six hundred pixels of it, and pressing on that
   * does something quite different.
   */
  const group = dialog.locator('[role="group"]').first();
  const thumb = group.locator('[class*="slider-thumb"]').first();
  const track = group.locator('[class*="slider-track"]').first();
  const from = await thumb.boundingBox();
  const along = await track.boundingBox();
  if (!from || !along) throw new Error("no slider to drag");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(along.x + along.width * 0.8, from.y + from.height / 2, { steps: 15 });
  await page.mouse.up();

  // Squareness runs nought to one, so four fifths along is nothing like where
  // it started and nothing like a rounding of it either.
  await expect(group).toContainText(/0\.[678]/);
});

test("asks before throwing the work away", async ({ page }) => {
  await open(page);
  await page.getByRole("textbox", { name: "Search everything" }).fill("start a new font");
  await page.getByRole("dialog", { name: "Quick actions" }).getByRole("option").first().click();
  const asking = page.getByRole("alertdialog");
  await expect(asking).toBeVisible();
  await expect(asking).toContainText(/no undo/i);
  await asking.getByRole("button", { name: "Keep it" }).click();
  await expect(asking).toBeHidden();
});

test("walks the list with the arrow keys", async ({ page }) => {
  await open(page);
  await page.getByRole("textbox", { name: "Search everything" }).fill("export");
  const dialog = page.getByRole("dialog", { name: "Quick actions" });
  await expect(dialog.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(dialog.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");
});

/**
 * The outline the forge is drawing, as a string.
 *
 * Read off the stage rather than from a screenshot, because the question is
 * whether the letter was redrawn and not whether it was repainted: a shadow
 * moving under an unchanged letter would pass a pixel comparison and this is
 * about the palette reaching the drawing at all.
 */
const outlineOf = async (page: import("@playwright/test").Page): Promise<string> =>
  page
    .locator("[data-forge-stage] path")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("d") ?? "").join("|"));

/*
 * These two drive controls that were not in the palette at all until the
 * reachability run went looking for them: the catalogue read `PARAMS` and
 * `PART_SPECS` and stopped, so the pen and the operations -- half the controls
 * in the product -- had no rows here. `catalogue.test.ts` counts them; these
 * check the wiring underneath actually reaches the drawing, which a count
 * cannot say.
 */
test("turns a cut on from a description of what it looks like", async ({ page }) => {
  await open(page);
  const before = await outlineOf(page);
  expect(before.length).toBeGreaterThan(50);

  await page.getByRole("textbox", { name: "Search everything" }).fill("stripes across the letters");
  const dialog = page.getByRole("dialog", { name: "Quick actions" });
  const first = dialog.getByRole("option").first();
  await expect(first).toContainText(/slot/i);
  await first.click();

  // The row opens its switch rather than closing the palette.
  const toggle = dialog.getByRole("button", { name: /^(On|Off)$/ }).first();
  await expect(toggle).toHaveText("Off");
  await toggle.click();
  await expect(toggle).toHaveText("On");

  await expect.poll(() => outlineOf(page)).not.toBe(before);
});

test("moves the pen itself, which lives nowhere near the family's numbers", async ({ page }) => {
  await open(page);
  const before = await outlineOf(page);

  await page.getByRole("textbox", { name: "Search everything" }).fill("~contrast");
  const dialog = page.getByRole("dialog", { name: "Quick actions" });
  const first = dialog.getByRole("option").first();
  await expect(first).toContainText(/contrast/i);
  await first.click();

  const group = dialog.locator('[role="group"]').first();
  const thumb = group.locator('[class*="slider-thumb"]').first();
  const track = group.locator('[class*="slider-track"]').first();
  const from = await thumb.boundingBox();
  const along = await track.boundingBox();
  if (!from || !along) throw new Error("no slider to drag");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(along.x + along.width * 0.75, from.y + from.height / 2, { steps: 15 });
  await page.mouse.up();

  await expect.poll(() => outlineOf(page)).not.toBe(before);
});


/*
 * Space opens it too, and the whole difficulty of space is the places it must
 * not: it is a character in a text field and it is how a keyboard presses a
 * button. Cmd-K stays for exactly that reason -- it is the one that still works
 * when the caret is in a box.
 */
test("opens on the space bar", async ({ page }) => {
  await page.keyboard.press("Space");
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
});

test("leaves the space bar alone while typing, and Cmd-K still works there", async ({ page }) => {
  await open(page);
  const box = page.getByRole("textbox", { name: "Search everything" });
  await box.fill("bowl");
  await box.press("Space");
  // The space was typed rather than swallowed by a second opening.
  await expect(box).toHaveValue("bowl ");
  await expect(dialog(page)).toBeVisible();
});

/*
 * A button keeps the focus after it is clicked, and people click constantly, so
 * a space that stood aside for whatever was last pressed would be a shortcut
 * that stopped working almost immediately. It does not stand aside, and it can
 * afford not to: a button answers to Enter as well, which is the key most
 * people reach for anyway. Only the controls with nothing but a space -- a
 * checkbox, a radio, a switch -- keep it.
 */
test("still opens with a button focused, which is where the pointer leaves it", async ({ page }) => {
  const button = page.getByRole("button").first();
  await button.click();
  await expect(dialog(page)).toBeHidden();
  await page.keyboard.press("Space");
  await expect(dialog(page)).toBeVisible();
});
