/**
 * Path operations, moving what is drawn, and the tools that do it.
 *
 * Split out of editor.spec.ts, which had reached a hundred and forty tests
 * across five thousand lines. What these files share is in support.ts.
 */

import { expect, test } from "@playwright/test";

import { FONT_PATH, openFont, takeUpTool } from "./support";

test.skip(!FONT_PATH, "needs a system font to open");

test("the path operations this font engine already knew how to do", async ({ page }) => {
  /*
   * Four operations that had been in the tree since the exporter needed them,
   * and ran once, silently, on the way to a file. There was no way to ask for
   * any of them while drawing -- so the Checks view could report that a
   * letter's extremes were missing and offer nothing to do about it but place
   * the points by hand.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();

  const actions = page.locator("[data-path-actions]");
  await expect(actions).toBeVisible();
  await expect(actions.getByRole("button", { name: "Add extremes" })).toBeVisible();
  await expect(actions.getByRole("button", { name: "Correct direction" })).toBeVisible();
  await expect(actions.getByRole("button", { name: "Remove overlap" })).toBeVisible();

  // The two that need a choice of paths are not offered until one is made.
  await expect(actions.getByRole("button", { name: /^Unite/ })).toHaveCount(0);

  /*
   * Picked by clicking a row and shift-clicking another, which is the same
   * selection the canvas already keeps rather than a second one to hold in
   * step with it.
   */
  await page.locator('[data-path-row="0"]').getByRole("button").first().click();
  await page
    .locator('[data-path-row="1"]')
    .getByRole("button")
    .first()
    .click({ modifiers: ["Shift"] });
  await expect(actions.getByRole("button", { name: "Unite 2" })).toBeVisible();

  /*
   * And the boolean runs, which means the library it needs was fetched and
   * waited for rather than reached for while still on its way.
   *
   * Compared on what the paths say rather than on how many there are. An `A`
   * is an outer and a counter, and cutting the second out of the first is
   * still a shape with a hole in it -- so the count is two before and two
   * after, and a test watching the count would call a working operation a
   * failure.
   */
  const panel = page.locator("[data-paths-panel]");
  const before = await panel.innerText();
  const undo = page.getByRole("button", { name: "Undo" });
  await expect(undo).toBeDisabled();

  await actions.getByRole("button", { name: "Unite 2" }).click();
  await expect.poll(() => panel.innerText(), { timeout: 30_000 }).not.toBe(before);
  await expect(undo).toBeEnabled();

  await undo.click();
  await expect.poll(() => panel.innerText()).toBe(before);
});

test("says so when a subtraction would leave nothing", async ({ page }) => {
  /*
   * Cutting a shape out of one that contains it leaves nothing, which is
   * arithmetic rather than a fault -- and it is what happens when the two
   * paths of an `A` are picked in the order the file lists them, the counter
   * first. Returning quietly made a working button look broken.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();

  await page.locator('[data-path-row="0"]').getByRole("button").first().click();
  await page
    .locator('[data-path-row="1"]')
    .getByRole("button")
    .first()
    .click({ modifiers: ["Shift"] });

  await page.locator("[data-path-actions]").getByRole("button", { name: "Subtract" }).click();
  await expect(page.getByText("nothing would be left", { exact: false })).toBeVisible({
    timeout: 30_000,
  });
  // And the letter is left exactly as it was.
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
});

test("correcting the direction is an edit, not a display change", async ({ page }) => {
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();

  // Turn a path the wrong way round, then ask for it back.
  await page.locator('[aria-label="Reverse path 1"]').click();
  const winding = await page.locator('[data-path-row="0"]').innerText();

  await page
    .locator("[data-path-actions]")
    .getByRole("button", { name: "Correct direction" })
    .click();
  await expect.poll(() => page.locator('[data-path-row="0"]').innerText()).not.toBe(winding);
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
});

test("moving what is drawn: flip, slant and align", async ({ page }) => {
  /*
   * The operations every drawing tool has, and worth having in a type editor
   * specifically because letters are full of repeats: a `b` is a `d` mirrored,
   * a `u` is an `n` turned over, an oblique is the roman leaned twelve degrees.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();

  const panel = page.locator("[data-transform-panel]");
  await expect(panel).toBeVisible();

  // With nothing picked, the whole letter is what moves -- which is what every
  // other drawing tool does and what somebody pressing flip expects.
  await expect(page.locator("[data-transform-scope]")).toHaveText("the whole letter");

  const undo = page.getByRole("button", { name: "Undo" });
  await expect(undo).toBeDisabled();
  await panel.getByRole("button", { name: "Flip ↔" }).click();
  await expect(undo).toBeEnabled();
  await undo.click();

  /*
   * Slant, and what this asks of it.
   *
   * Not that the letter's bounding box widens, which was the first thing tried
   * here and is wrong: an `A` is widest at its feet, and leaning it moves the
   * apex right without moving either foot, so the box does not change at all
   * until the apex overtakes the bottom corner. That is geometry rather than a
   * fault, and a test that assumed otherwise would have reported a working
   * operation as broken.
   *
   * The exact arithmetic is asserted where it can be exact -- the unit tests
   * lean a square and check it widens by its own height times the tangent of
   * the angle. What is worth asking here is that the button is wired to it:
   * that the edit lands, and that leaning back is its inverse.
   */
  const bounds = page.locator("[data-paths-panel]");
  const before = await bounds.innerText();
  await panel.getByRole("button", { name: "Lean", exact: true }).click();
  await expect(undo).toBeEnabled();

  await panel.getByRole("button", { name: "Back", exact: true }).click();
  await expect.poll(() => bounds.innerText()).toBe(before);
});

test("aligning needs two points, and says so rather than doing nothing", async ({ page }) => {
  /*
   * Aligning is not a transform and is not offered as one: every other button
   * in the panel applies one movement to everything selected, and this sends
   * each point somewhere different. Which is what makes it the operation for
   * levelling the two feet of an `n` against each other, and why it means
   * nothing until there are two points to level.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();

  const panel = page.locator("[data-transform-panel]");
  const alignLeft = panel.getByRole("button", { name: "⇤" });
  await expect(alignLeft).toBeDisabled();

  // Picking a whole path picks all of its points, which is more than two.
  await page.locator('[data-path-row="0"]').getByRole("button").first().click();
  await expect(page.locator("[data-transform-scope]")).toContainText("points");
  await expect(alignLeft).toBeEnabled();

  const before = await page.locator('[data-path-row="0"]').innerText();
  await alignLeft.click();
  // Every point on the leftmost of them: the path has no width left.
  await expect.poll(() => page.locator('[data-path-row="0"]').innerText()).not.toBe(before);
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
});

test("changing what a point is: round, tidy, and the guards on the rest", async ({ page }) => {
  /*
   * The panel below the transforms, and the reason it is a separate one: these
   * change what a point *is* rather than where it goes. Which means most of
   * them need to be told which point, where every transform falls back to the
   * whole letter.
   *
   * What is asked here is the wiring and the guards. The arithmetic is asserted
   * where it can be exact -- thirty unit tests on the operations themselves and
   * fourteen on them as edits -- and a browser is the wrong place to check that
   * a corner opened by twenty units landed twenty units away.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();

  const panel = page.locator("[data-points-panel]");
  await expect(panel).toBeVisible();
  await expect(page.locator("[data-points-scope]")).toContainText("none picked");

  // Smoothing every point in a letter with no curves in it is not what
  // pressing a button once means, so it waits to be told which.
  //
  // Exact, for the same reason as the line below it: the picking row above
  // these carries `Pick every smooth point`, and a name matched loosely finds
  // both. The two buttons are properly distinguishable -- one is named for the
  // operation and one for the selection -- and the test has to say which.
  await expect(panel.getByRole("button", { name: "Smooth", exact: true })).toBeDisabled();
  // Exact, because "Open corner" carries the word too.
  await expect(panel.getByRole("button", { name: "Corner", exact: true })).toBeDisabled();
  // These two are about a specific corner and a specific pair.
  await expect(panel.getByRole("button", { name: "Open corner" })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Reconnect" })).toBeDisabled();

  // Picking a whole path picks all of its points: enough for the first two,
  // and too many for the corner pair.
  await page.locator('[data-path-row="0"]').getByRole("button").first().click();
  await expect(page.locator("[data-points-scope]")).toContainText("points");
  await expect(panel.getByRole("button", { name: "Smooth", exact: true })).toBeEnabled();
  await expect(panel.getByRole("button", { name: "Open corner" })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Reconnect" })).toBeDisabled();
});

test("rounding says how many points it moved, and then that there are none", async ({ page }) => {
  /*
   * The two panels used together, which is also the honest way to get a letter
   * off the grid in the first place: scaling by two per cent leaves every
   * coordinate on a fraction.
   *
   * What is asserted is the count, not the coordinates, and that is the point.
   * Every number this application shows is displayed rounded -- the paths
   * panel, the numbers under the canvas, all of it -- so a letter a tenth of a
   * unit off the grid looks identical to one on it. The first thing tried here
   * was that the paths row would change, and it does not and cannot. Pressing
   * the button twice is what proves the first press did something: the second
   * finds nothing left to move.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();

  await page.locator("[data-transform-panel]").getByRole("button", { name: "Bigger" }).click();

  const round = page.locator("[data-points-panel]").getByRole("button", { name: "Round" });
  await round.click();
  await expect(page.getByText("back on whole units", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();

  await round.click();
  await expect(page.getByText("already on a whole unit", { exact: false })).toBeVisible();
});

test("the tidy button says what it would do before it does it", async ({ page }) => {
  /*
   * The one operation in the set that removes something, so it carries its
   * count on the face rather than in the hover. A button that silently deletes
   * four points is a button nobody presses twice.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();

  const tidy = page
    .locator("[data-points-panel]")
    .getByRole("button", { name: /Tidy up|Nothing to tidy/ });
  const label = await tidy.innerText();
  // The label and the state agree: nothing to do means nothing to press.
  if (label.includes("Nothing to tidy")) {
    await expect(tidy).toBeDisabled();
    return;
  }
  const count = Number(label.match(/\((\d+)\)/)![1]);
  expect(count).toBeGreaterThan(0);
  await tidy.click();
  await expect(page.getByText(`Removed ${count} point`, { exact: false })).toBeVisible();
});

test("dragging a shape into a letter, and cutting it back out", async ({ page }) => {
  /*
   * The two tools that make and unmake a whole shape, used together, which is
   * also the only way to test the knife against geometry a test can be sure
   * of: a rectangle dragged into a known corner of the canvas is a rectangle
   * a cut through that corner is certain to cross.
   *
   * The exact arithmetic is asserted where it can be exact -- twenty-seven
   * unit tests on the two modules, including the case that matters most, a
   * cut landing on the points a letter already carries. What is asked here is
   * that a drag on the canvas reaches them.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();

  const canvas = page.locator("canvas").first();
  const area = (await canvas.boundingBox())!;
  const paths = page.locator("[data-paths-panel]");
  const before = await paths.innerText();

  await takeUpTool(page, "shape", "rectangle");
  // Everything that draws starts from a point rather than from something
  // already on the canvas, so everything that draws gets a crosshair.
  await expect(canvas).toHaveClass(/cursor-crosshair/);

  await page.mouse.move(area.x + 40, area.y + 40);
  await page.mouse.down();
  await page.mouse.move(area.x + 170, area.y + 150, { steps: 5 });
  await page.mouse.up();

  await expect.poll(() => paths.innerText()).not.toBe(before);
  // A shape somebody just drew is left picked, because the next thing anybody
  // does with one is move it or scale it.
  await expect(page.locator("[data-transform-scope]")).toContainText("4 points");

  await takeUpTool(page, "knife", "knife");
  await page.mouse.move(area.x + 20, area.y + 95);
  await page.mouse.down();
  await page.mouse.move(area.x + 200, area.y + 95, { steps: 5 });
  await page.mouse.up();

  await expect(page.getByText("Cut into", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
});

test("a knife stroke that misses says so rather than looking like it worked", async ({ page }) => {
  /*
   * A stroke that fell short of the outline, or grazed it without going
   * through, looks exactly like one that worked until you try to drag the half
   * that was never made.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();

  const canvas = page.locator("canvas").first();
  const area = (await canvas.boundingBox())!;
  await page.getByRole("group", { name: "Tool" }).getByRole("button", { name: "Knife" }).click();

  // Along the very top of the canvas, which is above the ascender and so above
  // anything a letter reaches.
  await page.mouse.move(area.x + 5, area.y + 4);
  await page.mouse.down();
  await page.mouse.move(area.x + 60, area.y + 4, { steps: 3 });
  await page.mouse.up();

  await expect(page.getByText("did not go through anything", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
});

test("the tools answer to a single key, as in every drawing application", async ({ page }) => {
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();

  /*
   * One key per group, and the second press walks the group.
   *
   * It used to be one key per tool, which works for six and cannot work for
   * thirteen: there are not thirteen letters to spare beside everything else
   * the editor binds, and the group is what somebody means anyway -- `P` for
   * "the pen, whichever of them I had".
   */
  const tools = page.getByRole("group", { name: "Tool" });
  const armed = (group: string) => tools.locator(`[data-tool-group="${group}"]`);

  await page.keyboard.press("k");
  await expect(armed("knife")).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("r");
  await expect(armed("shape")).toHaveAttribute("aria-pressed", "true");
  await expect(armed("shape")).toHaveAttribute("data-tool", "rectangle");

  // Again, and it walks: rectangle to ellipse to polygon and round.
  await page.keyboard.press("r");
  await expect(armed("shape")).toHaveAttribute("data-tool", "ellipse");
  await page.keyboard.press("r");
  await expect(armed("shape")).toHaveAttribute("data-tool", "polygon");
  await page.keyboard.press("r");
  await expect(armed("shape")).toHaveAttribute("data-tool", "rectangle");

  await page.keyboard.press("v");
  await expect(armed("select")).toHaveAttribute("aria-pressed", "true");

  // And the group remembers: coming back to the shapes hands you the one you
  // left it on, rather than starting at the top every time.
  await page.keyboard.press("r");
  await expect(armed("shape")).toHaveAttribute("data-tool", "rectangle");
});

test("the way to the tools is the same from every view that shows a letter", async ({ page }) => {
  /*
   * The tools used to sit behind a gesture nobody could see. The font grid
   * opened a letter on a double click, the spacing table selected one without
   * opening it, and the proof sheet did neither -- so the shortest way from a
   * letter you were looking at to the pen was to notice a tab, press it, and
   * find the letter again.
   *
   * Above the scope tabs rather than inside one, because the panel opens on
   * the family in three of these four views: under the letter tab it would
   * have moved from one thing nobody presses to another.
   */
  await page.goto("/");
  await openFont(page);

  for (const view of ["Font", "Spacing", "Proof"]) {
    await page.getByRole("button", { name: view, exact: true }).click();
    await expect(page.locator("[data-open-in-editor]")).toBeVisible();
  }

  await page.locator("[data-open-in-editor]").getByRole("button").click();
  await expect(page.getByRole("button", { name: "Glyph", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // And the tools are all there, which is the point of having gone.
  await expect(page.getByRole("group", { name: "Tool" })).toBeVisible();
  await expect(page.locator("[data-points-panel]")).toBeVisible();
  // Once you are in the editor there is nowhere to go, so it is not offered.
  await expect(page.locator("[data-open-in-editor]")).toHaveCount(0);
});

test("a kerning pair offers both of its letters, because a pair is two", async ({ page }) => {
  /*
   * The one view with no inspector, so the button that reaches the tools from
   * everywhere else cannot be here -- and there would be nothing for a single
   * button to mean anyway. A gap that is too wide is often a letter drawn too
   * wide, and that is fixed in the outline rather than in the number on the
   * row.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Kerning", exact: true }).click();

  await page.getByText("T / o", { exact: false }).first().click();
  const row = page.getByText("Edit", { exact: true }).locator("..");
  await expect(row.getByRole("button", { name: "T", exact: true })).toBeVisible();

  await row.getByRole("button", { name: "o", exact: true }).click();
  await expect(page.getByRole("button", { name: "Glyph", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("[data-glyph-numbers]")).toContainText("o");
});

test("letters drawn in Draw can be taken to the tools", async ({ page }) => {
  /*
   * The connection this application did not have. Draw holds no outlines -- a
   * letter there is a skeleton, a pen and a set of parts, redrawn from scratch
   * every time a slider moves -- so the point tools cannot be pointed straight
   * at one: a dragged node would be undone by the next parameter change.
   *
   * The engine already knew how to build a real typeface, because that is what
   * its export dialog does. Until now that typeface only ever went into a
   * file, so the only way to move a point on a letter you had drawn was to
   * export it and open the file you had just written.
   *
   * One letter at a time can now be lent to the tools without leaving Draw, and
   * that is a different thing rather than a smaller one: it works by taking
   * that letter out of the parametric system for good, which a whole family
   * cannot do without leaving nothing to be parametric.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Draw", exact: true }).click();

  await page.locator("[data-take-to-editor]").getByRole("button").click();
  await expect(page.getByRole("button", { name: "Glyph", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
    { timeout: 120_000 },
  );

  // The font in hand is the one that was just drawn, not the one that was open.
  await expect(page.getByText("Untitled", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("DejaVu Sans", { exact: false })).toHaveCount(0);
  // And every tool is pointed at it.
  await expect(page.getByRole("group", { name: "Tool" })).toBeVisible();
  await expect(page.locator("[data-paths-panel]")).toContainText("paths");
});

test("assembling is a way into the tools too, and was the one left out", async ({ page }) => {
  /*
   * Assembling is the third way into a font here and builds a typeface exactly
   * as the other two do -- which is what its export dialog has always used.
   * It was left out of the hand-over, so a pile of drawings could be turned
   * into a file and not into something you could open a letter of. That is the
   * one of the three where somebody is most likely to want to: a drawing that
   * came in from somewhere else is a drawing nobody has checked the points of.
   *
   * With an empty pile it says so rather than offering nothing, which is what
   * the traced panel does and what the button beside it now does as well.
   */
  await page.goto("/");
  await page.getByRole("button", { name: "Assemble", exact: true }).click();

  const handOver = page.locator("[data-take-to-editor]").getByRole("button");
  await expect(handOver).toBeVisible();
  await expect(handOver).toBeDisabled();
});
