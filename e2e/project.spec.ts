/**
 * Naming, adding and exporting -- a project rather than a letter.
 *
 * Split out of editor.spec.ts, which had reached a hundred and forty tests
 * across five thousand lines. What these files share is in support.ts.
 */

import { expect, test } from "@playwright/test";

import { FONT_PATH, openFont, startBlank, takeUpTool } from "./support";

test.skip(!FONT_PATH, "needs a system font to open");

test("export waits until there is something to export, in every mode", async ({ page }) => {
  /*
   * Pressing Export in Trace with nothing read opened a dialog offering to
   * download "0 letters" with its own Download greyed out. Assembling had
   * always known better, and so had the hand-over button beside it.
   */
  await page.goto("/");
  const exportButton = page.getByRole("button", { name: "Export", exact: true });

  await expect(exportButton).toBeDisabled();

  await page.getByRole("button", { name: "Assemble", exact: true }).click();
  await expect(exportButton).toBeDisabled();

  await page.getByRole("button", { name: "Trace", exact: true }).click();
  await expect(exportButton).toBeDisabled();

  // A drawn font is always ready to leave, because the forge always has one.
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await expect(exportButton).toBeEnabled();
});

test("a font can be given a name of its own, which it could not before", async ({ page }) => {
  /*
   * The most serious thing a tour of the capability surface turned up.
   * `setMeta` sat in the store with nothing calling it, so a font opened here
   * kept the identity of the file it came from whatever was done to it:
   * redraw every letter of DejaVu Sans, export, and the file is still called
   * DejaVu Sans, still carrying DejaVu's copyright and naming DejaVu's
   * designer. Draw, Assemble and Trace all offered a name. Edit did not.
   */
  await page.goto("/");
  await openFont(page);

  // The way in is the name itself, which has always been shown and done
  // nothing.
  await page.locator("[data-font-name]").click();
  await expect(page.locator("[data-font-info]")).toBeVisible();

  const family = page.getByRole("dialog", { name: "Font details" }).locator("input").first();
  await family.fill("Ours");
  await family.blur();
  await page.getByRole("button", { name: "Done", exact: true }).click();

  await expect(page.locator("[data-font-name]")).toContainText("Ours");
  await expect(page.locator("[data-font-name]")).not.toContainText("DejaVu");
  // A name is an edit, so it can be taken back.
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
});

test("the checks say when an edited font still wears the name it arrived with", async ({
  page,
}) => {
  /*
   * A derivative work that does not say it is one, which is the first thing
   * every type licence asks of you. It fires only once a letter has actually
   * been changed: opening somebody's font to read it is not a licensing
   * question.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();
  await page.locator("[data-transform-panel]").getByRole("button", { name: "Bigger" }).click();

  await page.getByRole("button", { name: "Checks", exact: true }).click();
  await page.getByRole("button", { name: "Run checks", exact: true }).click();
  await expect(page.getByText("still called DejaVu Sans", { exact: false })).toBeVisible({
    timeout: 60_000,
  });
});

test("a new project can be given a letter, which it could not before", async ({ page }) => {
  /*
   * The dead end this closes. `startBlank()` handed back a typeface whose
   * glyph list was empty, and there was no way to put anything into it -- so
   * the New action led to a font that could never contain a letter.
   */
  await page.goto("/");
  await openFont(page);

  // Starting again is a palette action and asks first, because it throws away
  // whatever is open.
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("textbox", { name: "Search everything" }).fill("start a new font");
  await page.getByRole("dialog", { name: "Quick actions" }).getByRole("option").first().click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Go on" }).click();

  await page.getByRole("button", { name: "Font", exact: true }).click();
  // The one glyph every font must carry, and a note saying it is not a letter
  // somebody drew. The grid's older "Nothing here yet" is for a font stripped
  // of even that.
  await expect(page.getByText("No letters yet.", { exact: false })).toBeVisible();

  await page.locator("[data-add-glyph]").click();
  // A letter to draw in, and the editor open on it.
  await expect(page.getByRole("button", { name: "Glyph", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("[data-letter-panel]")).toBeVisible();
});

test("a letter can be named, given a character, copied and taken out", async ({ page }) => {
  /*
   * None of this existed. A font opened here could have its letters redrawn
   * and nothing else: a glyph's codepoints were shown in a grid cell's hover
   * text and used by the search box, and were otherwise unreachable.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();

  const panel = page.locator("[data-letter-panel]");
  await expect(panel).toBeVisible();

  const name = panel.getByLabel("Letter name");
  // A name DejaVu does not already have: it covers Greek, so `alpha` is
  // taken and the store rightly refuses it.
  await name.fill("A.mine");
  await name.blur();
  await expect(page.locator("[data-glyph-numbers]")).toContainText("A.mine");

  // The character, written the way a font's documentation writes one.
  const character = panel.getByLabel("Characters this letter answers to");
  await expect(character).toHaveValue(/U\+/);

  await panel.getByRole("button", { name: "Duplicate" }).click();
  await expect(page.getByText("Copied A.mine to", { exact: false })).toBeVisible();
  // A copy answers to no character, because two letters on one codepoint is a
  // font where one of them can never be typed.
  await expect(panel.getByLabel("Characters this letter answers to")).toHaveValue("");

  await panel.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Removed A.mine", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
});

test("a drawing can be carried from one letter to another", async ({ page }) => {
  /*
   * There was no clipboard of any kind, so every shared part of a family had
   * to be drawn again by hand -- which is the opposite of what a family is.
   * An `m` is started from an `n`.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();

  const carry = page.locator("[data-carry-actions]");
  await carry.getByRole("button", { name: "Copy" }).click();
  await expect(page.getByText("Copied", { exact: false })).toBeVisible();

  // Into a different letter, which is the whole point.
  await page.getByRole("button", { name: "Font", exact: true }).click();
  await page.getByPlaceholder("Search by letter, name or U+ code").fill("m");
  await page.locator('[data-glyph-cell="m"]').first().dblclick();

  const paths = page.locator("[data-paths-panel]");
  const before = await paths.innerText();
  await page.locator("[data-carry-actions]").getByRole("button", { name: "Paste" }).click();
  await expect(page.getByText("Pasted", { exact: false })).toBeVisible();
  await expect.poll(() => paths.innerText()).not.toBe(before);
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
});

test("guides run down the canvas as well as across it", async ({ page }) => {
  /*
   * The type was `{ y: number }`, so every guide was horizontal and there was
   * no way to mark where a stem should stand or where a sidebearing should
   * fall -- which is half of what anybody draws a guide for.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();

  await page.locator("[data-add-guide]").click();
  await page.locator("[data-add-guide-vertical]").click();
  await expect(page.locator("[data-clear-guides]")).toContainText("Clear 2");

  // And they go with the font they were drawn against, because a guide is
  // kept in font units and font units differ from one font to the next.
  await page.locator("[data-clear-guides]").click();
  await expect(page.locator("[data-clear-guides]")).toHaveCount(0);
});

test("a dragged point is pulled onto the lines worth landing on", async ({ page }) => {
  /*
   * Nothing snapped. A point landed wherever the pointer was let go of, and
   * every coordinate this application shows is shown rounded -- so a letter
   * drawn by dragging was off the grid in every coordinate and looked
   * perfectly right until something measured it.
   *
   * What is asserted here is the switch and its wiring; where a point actually
   * lands is asserted exactly in ten unit tests, which is where an assertion
   * about a coordinate belongs.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();

  const snap = page.locator("[data-snap-toggle]");
  // On to begin with, because a font is drawn on whole units and a tool whose
  // help has to be switched on is a tool most people never switch on.
  await expect(snap).toHaveAttribute("aria-pressed", "true");
  await snap.click();
  await expect(snap).toHaveAttribute("aria-pressed", "false");
  await snap.click();
  await expect(snap).toHaveAttribute("aria-pressed", "true");
});

test("freehand draws by hand, and the line becomes an outline", async ({ page }) => {
  /*
   * The last tool, deferred when the canvas tools were built. A pointer
   * reports every few milliseconds, so a stroke drawn in a second arrives as
   * two or three hundred positions -- and a contour with three hundred nodes
   * in it is a recording of a hand rather than a drawing. What lands is a
   * handful of curves; how few is asserted exactly in the unit tests.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();

  const paths = page.locator("[data-paths-panel]");
  const before = await paths.innerText();

  await takeUpTool(page, "pen", "freehand");
  const canvas = page.locator("canvas").first();
  const area = (await canvas.boundingBox())!;
  await page.mouse.move(area.x + 60, area.y + 200);
  await page.mouse.down();
  for (let step = 1; step <= 20; step++) {
    await page.mouse.move(area.x + 60 + step * 8, area.y + 200 + Math.sin(step / 3) * 30);
  }
  await page.mouse.up();

  await expect.poll(() => paths.innerText()).not.toBe(before);
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
});

test("a letter can be built out of another by hand", async ({ page }) => {
  /*
   * `removeComponent` has always existed and nothing ever added one except the
   * accent builder, which runs on its own -- so a letter could be taken apart
   * and never put together on purpose.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();
  // The tab's name is lowercase in the DOM and capitalised only in CSS.
  await page
    .getByRole("group", { name: "Inspector scope" })
    .getByRole("button", { name: "build" })
    .click();

  const part = page.getByLabel("Add a part by name");
  await part.fill("a");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("is now built from a", { exact: false })).toBeVisible();
});

test("a proof can be printed, which is what the proofing advice is about", async ({ page }) => {
  /*
   * A screen shows a letter lit from behind at seventy-two pixels to the inch
   * and paper shows it lit from the front at three hundred, which is why a
   * face that looks even on a monitor can look blotchy in a book. Until now
   * this view could only be looked at.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Proof", exact: true }).click();

  let asked = false;
  await page.exposeFunction("__printed", () => {
    asked = true;
  });
  await page.evaluate(() => {
    window.print = () => (window as unknown as { __printed: () => void }).__printed();
  });
  await page.locator("[data-print-proof]").click();
  expect(asked).toBe(true);

  // The controls are chrome and are not part of the proof: the printed page is
  // the letters and nothing else.
  await expect(page.locator("[data-print-away]").first()).toHaveCount(1);
});

test("a font with nothing in it says so wherever you are standing", async ({ page }) => {
  /*
   * Found by looking at every view of a font just started rather than at one
   * of them. Five of the six showed their furniture over nothing: a spacing
   * table of no rows under its headings, a proof of no text, a kerning list of
   * no pairs, a checks page with a Run button. The glyph editor said "Choose a
   * glyph in the font view", which sends somebody to the one view that would
   * then tell them to press New letter.
   *
   * And the parameter rail was live throughout -- ten sliders describing what
   * they do to letters, on a font with none.
   */
  await page.goto("/");
  await startBlank(page);

  for (const [view, what] of [
    ["Glyph", "draw"],
    ["Spacing", "space"],
    ["Kerning", "kern"],
    ["Proof", "proof"],
    ["Checks", "check"],
  ]) {
    await page.getByRole("button", { name: view, exact: true }).click();
    await expect(
      page.getByText(`no letters yet, so there is nothing to ${what}`, { exact: false }),
      `${view} has no empty state`,
    ).toBeVisible();
    // And the way out of it is here, rather than in some other view.
    await expect(page.locator("[data-add-first-glyph]")).toBeVisible();
  }

  // The parameters go with them: on the letter scope they were the family's
  // values wearing a letter's label, for a letter that did not exist.
  await page.getByRole("button", { name: "Font", exact: true }).click();
  await expect(page.locator("[data-no-letters]")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Parameters" })).not.toContainText(
    "Corner radius",
  );

  // Draw somewhere to stand and they come back.
  await page.locator("[data-add-glyph]").click();
  await expect(page.locator("[data-no-letters]")).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Parameters" })).toContainText("Weight");
});

test("a font just started passes its own checks", async ({ page }) => {
  /*
   * It did not. `startBlank` handed back a typeface with no glyphs at all, and
   * the first thing the checks page said about a font nobody had touched was
   * an error: "No .notdef glyph". Every other generator here -- quill, forge,
   * assemble -- puts one in first, because the format requires it in position
   * zero; this one path did not.
   *
   * Which makes `glyphs.length` the wrong question to ask about a new font, so
   * the views ask `hasLetters` instead and `.notdef` does not count.
   */
  await page.goto("/");
  await startBlank(page);

  await page.getByRole("button", { name: "Font", exact: true }).click();
  await expect(page.getByText("No letters yet.", { exact: false })).toBeVisible();
  await expect(page.locator("[data-glyph-cell]").filter({ hasText: ".notdef" })).toHaveCount(1);
  // One glyph, said as one glyph.
  await expect(page.getByText("1 glyph", { exact: true })).toBeVisible();

  await page.locator("[data-add-glyph]").click();
  await page.getByRole("button", { name: "Checks", exact: true }).click();
  await page.getByRole("button", { name: "Run checks", exact: true }).click();
  await expect(page.getByText("No .notdef glyph", { exact: false })).toHaveCount(0);
});

test("a new letter's name does not claim to be a character it is not", async ({ page }) => {
  /*
   * The grid named it `uni0041`, which by convention *means* U+0041 -- so the
   * font said it had an A while the glyph answered to no character at all, and
   * the codepoint field's `U+0041` placeholder agreed with it. Two lies about
   * one glyph, either of which exports.
   *
   * The three New letter buttons also named it three different ways: the grid
   * `uni0041`, the letter panel `new.mfa3k2x` off a timestamp, and the empty
   * state `new`.
   */
  await page.goto("/");
  await startBlank(page);
  await page.getByRole("button", { name: "Font", exact: true }).click();
  await page.locator("[data-add-glyph]").click();

  const panel = page.locator("[data-letter-panel]");
  await expect(panel.getByLabel("Letter name")).toHaveValue("newGlyph");
  // Nothing claimed, from either field.
  const character = panel.getByLabel("Characters this letter answers to");
  await expect(character).toHaveValue("");
  await expect(character).toHaveAttribute("placeholder", "A or U+0041");

  // And the second one lands beside the first rather than on top of it.
  await panel.getByRole("button", { name: "New letter" }).click();
  await expect(panel.getByLabel("Letter name")).toHaveValue("newGlyph.001");
});

test("letters can be drawn as one, which nothing could ask for before", async ({ page }) => {
  /*
   * The gap this closes. The GSUB writer could write a chained context and
   * nothing else, because that is what a joined script needed -- so a person
   * could draw `f_i`, name it by the convention every font tool follows, watch
   * it appear in the grid and export it, and no reader would ever see it. The
   * drawing was in the file and nothing selected it.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();
  await page
    .getByRole("group", { name: "Inspector scope" })
    .getByRole("button", { name: "build" })
    .click();

  const panel = page.locator("[data-features-panel]");
  await expect(panel).toBeVisible();

  /*
   * The font's own, which it now arrives with. This asserted "None yet" -- true
   * only while an import read no features, which is the very thing that made
   * the panel lie about a face that has drawn `fi` for twenty years.
   */
  const already = await panel.locator("[data-ligature]").count();
  expect(already).toBeGreaterThan(0);

  /*
   * A pair of this font's own choosing, typed. DejaVu carries all five of the
   * standard ligatures already -- `fi`, `fl`, `ff`, `ffi`, `ffl` -- so none of
   * them is offered, which is the suggestion list being right rather than
   * empty. The free-form join is the path that always exists.
   */
  await page.getByLabel("Letters to join").fill("t h");
  await page.getByRole("button", { name: "Join", exact: true }).click();

  await expect(page.getByText("now draws as", { exact: false })).toBeVisible();
  await expect(panel.locator("[data-ligature]")).toHaveCount(already + 1);

  // And it comes back out, leaving the drawing where it was.
  const before = await page.locator("[data-glyph-numbers]").count();
  await panel.locator("[data-ligature]").last().getByRole("button", { name: "Undo" }).click();
  await expect(panel.locator("[data-ligature]")).toHaveCount(already);
  expect(await page.locator("[data-glyph-numbers]").count()).toBe(before);
});

test("a ligature uses the drawing the font already has rather than a second one", async ({
  page,
}) => {
  /*
   * Two conventions are in use and both are correct: `f_i` is what a tool
   * writes when it makes one, `fi` is what a great many shipped fonts call it,
   * DejaVu among them. Looking only for the first offered to *make* a ligature
   * to a font that already draws one -- and making it added a second, empty
   * glyph beside the real one and wired the rule to the blank.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();
  await page
    .getByRole("group", { name: "Inspector scope" })
    .getByRole("button", { name: "build" })
    .click();

  const panel = page.locator("[data-features-panel]");

  /*
   * DejaVu's own `fi` rule is read in now, so it is not offered -- a font that
   * already joins a pair has nothing to be offered about it. Taking the rule
   * out puts the pair back in the list with the drawing still in the font,
   * which is exactly the state this is about: a ligature glyph that exists and
   * has nothing selecting it.
   */
  await panel.locator("[data-ligature='fi']").getByRole("button", { name: "Undo" }).click();

  const offered = panel.locator("[data-make-ligature='fi']");
  await expect(offered).toBeVisible();
  // Without "new", because the drawing is there and only the rule is missing.
  await expect(offered).not.toContainText("new");

  await page.getByRole("button", { name: "Font", exact: true }).click();
  const countBefore = await page.locator("[data-glyph-cell]").count();

  await page.getByRole("button", { name: "Glyph", exact: true }).click();
  await page
    .getByRole("group", { name: "Inspector scope" })
    .getByRole("button", { name: "build" })
    .click();
  await panel.locator("[data-make-ligature='fi']").click();
  await expect(panel.locator("[data-ligature='fi']")).toBeVisible();

  // No glyph was made: the rule points at the one that was already there.
  await page.getByRole("button", { name: "Font", exact: true }).click();
  expect(await page.locator("[data-glyph-cell]").count()).toBe(countBefore);
});
