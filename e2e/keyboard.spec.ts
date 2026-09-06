/**
 * Editing a letter without a pointer, and getting back out again.
 *
 * This view has answered keys for a long time -- Tab walks the points of an
 * outline, arrows nudge what is picked, Enter closes it -- and none of it was
 * reachable. The canvas took no focus, had no name and no role, so a screen
 * reader had nothing to announce and a keyboard had no way to arrive.
 *
 * The half that was worse was the half that was not about disability at all.
 * `Tab` is bound here to walk the points of an outline, it called
 * `preventDefault`, and it was answered wherever the focus happened to be. So
 * with a letter open, anybody on a keyboard who pressed Tab did not move to
 * the next control. They did not move at all, anywhere on the page. That is a
 * keyboard trap, and the first test below is the one that would have caught it.
 *
 * Tab alone, as far as anybody has measured. The other keys were checked for
 * the same fault and did not have it, and the last test here says so, because
 * the fix changes the rule they all go through.
 */

import { expect, test } from "@playwright/test";

import { openFont } from "./support";

async function openALetter(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();
  await expect(page.locator("[data-glyph-canvas]")).toBeVisible();
}

test("Tab moves the focus on, rather than being eaten by the letter", async ({ page }) => {
  await openALetter(page);

  /*
   * From a real control in the chrome, which is where a keyboard user actually
   * is. Before this, pressing Tab here did nothing whatsoever: the glyph view's
   * listener took the key, called `preventDefault`, stepped a selection nobody
   * could see, and the focus stayed on the button for ever.
   */
  const open = page.locator("[data-open-file]");
  await open.focus();
  await expect(open).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(open, "Tab must move the focus off the button").not.toBeFocused();
});

test("the canvas can be reached, and says what it is when you get there", async ({ page }) => {
  await openALetter(page);
  const canvas = page.locator("[data-glyph-canvas]");

  // Named for the letter rather than for the element. "Canvas" says nothing
  // about which of six thousand letters is on screen.
  await expect(canvas).toHaveAttribute("aria-label", /Outline editor, editing/);
  await expect(canvas).toHaveAttribute("role", "application");
  await expect(canvas).toHaveAttribute("tabindex", "0");

  // And the keys are described, which is what makes the role honest: a screen
  // reader hands every keystroke through, so it has to say what they do.
  const describedBy = await canvas.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  await expect(page.locator(`#${describedBy}`)).toContainText("Tab and Shift Tab walk the points");

  // Reachable from the keyboard alone, which is the point of all of the above.
  let reached = false;
  for (let press = 0; press < 60 && !reached; press++) {
    reached = await canvas.evaluate((element) => document.activeElement === element);
    if (!reached) await page.keyboard.press("Tab");
  }
  expect(reached, "the canvas should be in the tab order").toBe(true);
});

test("a point can be picked, moved and taken back without a pointer", async ({ page }) => {
  await openALetter(page);
  const canvas = page.locator("[data-glyph-canvas]");
  const scope = page.locator("[data-points-scope]");

  // Focused the way a keyboard reaches it, not by clicking.
  await canvas.focus();
  await expect(scope).toHaveText("none picked");

  await page.keyboard.press("Tab");
  await expect(scope).toHaveText("1 point");

  // Nudged, and the letter has to actually change: a selection that moves
  // nothing is a highlight, not an edit.
  const outline = () => page.locator("[data-paths-panel]").textContent();
  const before = await outline();
  for (let press = 0; press < 10; press++) await page.keyboard.press("ArrowUp");
  const moved = page.locator("[data-glyph-picked]");
  await expect(moved).not.toHaveText(/at .*, 0\./);

  await page.keyboard.press("ControlOrMeta+z");
  expect(await outline()).toBe(before);
});

test("every step along an outline is said out loud", async ({ page }) => {
  /*
   * Walking an outline moves a highlight around a drawing. For somebody who
   * cannot see the drawing that is no feedback at all, so each step is put
   * into a live region as a sentence.
   *
   * By where the point is rather than by its number alone: a letter has no
   * names for its points, and "point 4 of 16" says nothing about the shape
   * being walked. The coordinates do, and they are the numbers the panel shows.
   */
  await openALetter(page);
  await page.locator("[data-glyph-canvas]").focus();
  const said = page.locator("[data-glyph-picked]");

  await expect(said).toHaveText("No points picked.");

  await page.keyboard.press("Tab");
  await expect(said).toHaveText(/point 1 of \d+, path 1, at -?\d+, -?\d+\./);
  const first = await said.textContent();

  await page.keyboard.press("Tab");
  await expect(said).not.toHaveText(first!);
  await expect(said).toHaveText(/point 2 of \d+/);

  await page.keyboard.press("ControlOrMeta+a");
  await expect(said).toHaveText(/^\d+ points picked\.$/);
});

test("the letter's keys keep out of the rest of the application", async ({ page }) => {
  /*
   * This one held before the change as well, and it is here because the change
   * is what could break it. The rule used to be "not an input or a textarea"
   * and is now "at the canvas, or nowhere in particular", which is a different
   * rule that happens to give the same answer here. A test that only covered
   * the part that was broken would not notice the part that was not.
   *
   * Worth saying plainly, because both of the other things this looked like
   * were checked and were not true: a slider was never caught, since the thing
   * that takes its focus is the hidden `input type=range` inside it, and an
   * arrow pressed at a focused button did not move a picked point either.
   * Tab was the only key that was actually going wrong.
   */
  await openALetter(page);
  const canvas = page.locator("[data-glyph-canvas]");
  const picked = page.locator("[data-glyph-picked]");

  await canvas.focus();
  await page.keyboard.press("Tab");
  await expect(picked).toHaveText(/point 1 of/);
  const before = await picked.textContent();

  await page.locator("[data-open-file]").focus();
  for (let press = 0; press < 5; press++) await page.keyboard.press("ArrowUp");

  // The announcement carries the coordinates, so this is the letter itself
  // being checked and not only which point is picked.
  expect(await picked.textContent()).toBe(before);
});
