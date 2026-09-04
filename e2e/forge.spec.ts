/**
 * Draw: the controls that shape a family, and what they reach.
 *
 * Split out of editor.spec.ts, which had reached a hundred and forty tests
 * across five thousand lines. What these files share is in support.ts.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { FONT_PATH, measureInk, openFont, openForge, paramSlider } from "./support";

test.skip(!FONT_PATH, "needs a system font to open");

test("the canvas says what a click would grab before you press", async ({ page }) => {
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();
  await page.waitForTimeout(600);

  const canvas = page.locator("canvas").first();
  const box = (await canvas.boundingBox())!;

  // Park the pointer on empty space well away from the letter, so the baseline
  // is a canvas with nothing hovered.
  await page.mouse.move(box.x + 12, box.y + 12);
  await page.waitForTimeout(120);
  await expect(canvas).toHaveClass(/cursor-default/);
  const restingInk = await measureInk(page);

  // Sweep for a point. Node positions depend on the outline, so rather than
  // hardcoding a coordinate the test hunts for one the editor reports as
  // grabbable, which is the same answer a click would get.
  let foundGrabbable = false;
  let hoveredInk = restingInk;
  const step = 6;
  for (let y = box.height * 0.2; y < box.height * 0.85 && !foundGrabbable; y += step) {
    for (let x = box.width * 0.2; x < box.width * 0.85; x += step) {
      await page.mouse.move(box.x + x, box.y + y);
      const className = (await canvas.getAttribute("class")) ?? "";
      if (className.includes("cursor-grab")) {
        foundGrabbable = true;
        await page.waitForTimeout(80);
        hoveredInk = await measureInk(page);
        break;
      }
    }
  }

  // The cursor has to change, otherwise the only way to discover what a click
  // grabs is to click and find out.
  expect(foundGrabbable).toBe(true);
  // And it has to be visible on the canvas too, not just in the cursor: the
  // hover ring is drawn into the scene, so it adds covered pixels.
  expect(hoveredInk).toBeGreaterThan(restingInk);
});

test("shows the control letters and what an edit to one carried across", async ({ page }) => {
  await page.goto("/");
  await openFont(page);

  // The panel names the letters that drive the font, and says how many follow.
  await expect(page.getByText("Control letters")).toBeVisible();
  await expect(page.getByText("Draw these and the rest follows", { exact: false })).toBeVisible();

  // Opening one from the panel takes you into it.
  await page.getByTitle(/^Open n\./).click();
  await expect(page.getByRole("button", { name: "Glyph", exact: true })).toBeVisible();

  /*
   * Drag a point on n upwards, which is the gesture that moves the whole font.
   *
   * Upwards, and from the top of the letter down, on purpose. This used to
   * grab whichever point it met first scanning from the middle and pull it
   * sideways, and then assert that the family had moved -- which is a coin
   * toss, because it need not have. The stem reading is the median span across
   * a fan of rays, and n has two stems: moving one wall of one of them can
   * leave the median exactly where it was, and reporting nothing is then the
   * right answer rather than a fault. Raising the top of the arch changes the
   * letter's height, which nothing else can absorb.
   */
  const canvas = page.locator("canvas").first();
  const box = (await canvas.boundingBox())!;
  // Proportional to the canvas: the letter is drawn to fit, so a fixed number
  // of screen pixels is a different number of font units on a shorter window.
  const dragBy = box.height * 0.1;
  let grabbed = false;
  for (let y = box.height * 0.15; y < box.height * 0.7 && !grabbed; y += 6) {
    for (let x = box.width * 0.3; x < box.width * 0.7; x += 6) {
      await page.mouse.move(box.x + x, box.y + y);
      if (((await canvas.getAttribute("class")) ?? "").includes("cursor-grab")) {
        await page.mouse.down();
        await page.mouse.move(box.x + x, box.y + y - dragBy, { steps: 6 });
        await page.mouse.up();
        grabbed = true;
        break;
      }
    }
  }
  expect(grabbed).toBe(true);

  // Whatever it changed, the panel has to say so rather than moving the font
  // silently.
  await page.getByRole("button", { name: "family", exact: true }).click();
  await expect(page.getByText("Last change carried across")).toBeVisible({ timeout: 15_000 });
});

test("quantises the letters onto a pixel grid", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();
  await page.waitForTimeout(500);

  const inkBefore = await measureInk(page);

  const slider = await paramSlider(page, "Pixel grid");
  await slider.focus();
  // Up to a coarse grid, where the quantising is unmistakable.
  for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(1200);

  const inkAfter = await measureInk(page);
  // Squaring a letter off changes how much of the canvas it covers.
  expect(inkAfter).not.toBe(inkBefore);
  expect(inkAfter).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("puts slab serifs on the stroke ends", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await openFont(page);

  // The editor opens on A, whose sides are diagonal, so it has no flat stroke
  // ends and correctly gets no slabs. H is all right angles.
  await page.getByLabel("Search glyphs").fill("H");
  await page.getByRole("button", { name: /^H$/ }).first().dblclick();
  await page.waitForTimeout(600);

  const inkBefore = await measureInk(page);

  const slider = await paramSlider(page, "Slab serifs");
  await slider.focus();
  for (let i = 0; i < 45; i++) await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(900);

  // Bars laid across the stroke ends cover more of the canvas.
  const inkAfter = await measureInk(page);
  expect(inkAfter).toBeGreaterThan(inkBefore);
  expect(errors).toEqual([]);
});

test("moves the crossbar of a letter that has one", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await openFont(page);
  // H has a crossbar; the letter the editor opens on does not necessarily.
  await page.getByLabel("Search glyphs").fill("H");
  await page.getByRole("button", { name: /^H$/ }).first().dblclick();
  await page.waitForTimeout(600);

  const before = await measureInk(page);

  const slider = await paramSlider(page, "Crossbar");
  await slider.focus();
  for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(900);

  // The bar moves rather than growing, so the letter keeps roughly the same
  // amount of ink while the drawing changes.
  const after = await measureInk(page);
  expect(after).toBeGreaterThan(0);
  expect(Math.abs(after - before) / before).toBeLessThan(0.25);
  expect(errors).toEqual([]);
});

test("the toolbar and panels say which option is selected", async ({ page }) => {
  await page.goto("/");
  await openFont(page);

  // Exactly one view is selected at a time, and it says so rather than only
  // looking different.
  const grid = page.getByRole("button", { name: "Font", exact: true });
  const spacing = page.getByRole("button", { name: "Spacing", exact: true });
  await expect(grid).toHaveAttribute("aria-pressed", "true");
  await expect(spacing).toHaveAttribute("aria-pressed", "false");

  await spacing.click();
  await expect(spacing).toHaveAttribute("aria-pressed", "true");
  await expect(grid).toHaveAttribute("aria-pressed", "false");

  /*
   * The inspector's own tabs behave the same way, checked from a view where
   * the family is what the panel opens on.
   *
   * Back to the grid first, and deliberately: the spacing table is about one
   * letter at a time and the panel follows the row you are on, so arriving
   * there puts the scope on the letter rather than the family. That is the
   * behaviour, not an accident, and asserting the family is selected while
   * standing in the spacing table would be asserting the fault this had.
   */
  await grid.click();
  const family = page.getByRole("button", { name: "family", exact: true });
  const build = page.getByRole("button", { name: "build", exact: true });
  await expect(family).toHaveAttribute("aria-pressed", "true");
  await build.click();
  await expect(build).toHaveAttribute("aria-pressed", "true");
  await expect(family).toHaveAttribute("aria-pressed", "false");

  // The tools appear with the glyph view and track their own selection.
  await page.getByRole("button", { name: "Glyph", exact: true }).click();
  const select = page.getByRole("button", { name: "Select", exact: true });
  const pen = page.getByRole("button", { name: "Pen", exact: true });
  await expect(select).toHaveAttribute("aria-pressed", "true");
  await pen.click();
  await expect(pen).toHaveAttribute("aria-pressed", "true");
  await expect(select).toHaveAttribute("aria-pressed", "false");
});

/*
 * Nothing in the toolbar is allowed off the side.
 *
 * Every control in it is fixed-width, and a flex row that will not wrap does
 * not hide what does not fit -- it puts it past the right-hand edge, where
 * there is no scrollbar and no way to reach it. It has happened twice: once
 * when the modes were called "Edit a font", "Draw a font" and "Assemble a
 * font", and once when the status message was allowed twenty-eight rem. Both
 * times the button that went over the side was Export.
 *
 * Checked in edit mode, which carries the most: the modes, the five views, undo
 * and redo, the open font's name, the status, and four actions.
 */
for (const width of [1440, 1280, 1152, 1024]) {
  test(`keeps every toolbar button on screen at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await openFont(page);
    await page.getByRole("button", { name: "Glyph", exact: true }).click();

    const over = await page.evaluate((edge) => {
      const names: string[] = [];
      for (const button of document.querySelectorAll("header button")) {
        const box = button.getBoundingClientRect();
        // Half a pixel of slack, for a sub-pixel layout that rounds outwards.
        if (box.right > edge + 0.5 || box.left < -0.5)
          names.push(button.textContent?.trim() ?? "?");
      }
      return names;
    }, width);
    expect(over, `off the side at ${width}`).toEqual([]);
  });
}

test("hovering a toolbar button changes it before you press", async ({ page }) => {
  await page.goto("/");
  await openFont(page);

  const spacing = page.getByRole("button", { name: "Spacing", exact: true });
  const background = () => spacing.evaluate((element) => getComputedStyle(element).backgroundColor);

  // Park the pointer well away, then read the resting appearance.
  await page.mouse.move(5, 300);
  await page.waitForTimeout(150);
  const resting = await background();

  await spacing.hover();
  await page.waitForTimeout(200);
  const hovered = await background();

  // An unselected tab has to react to the pointer, not just to the click.
  expect(hovered).not.toBe(resting);
});

/**
 * Someone arriving with no font of their own.
 *
 * The tool does nothing at all until a font is open, so without a sample the
 * first thing it asks of a visitor is that they go and find a .ttf. This is the
 * path most people will take on their first visit and it has to work without
 * anything else being set up -- note that this test never touches the file
 * input.
 */
test("opens the sample font without a file of your own", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await page.getByRole("button", { name: "Try the sample font" }).click();

  await expect(page.getByText("Typeforge Sample", { exact: false }).first()).toBeVisible({
    timeout: 45_000,
  });
  // A real font, drawn: the grid fills with glyph cells.
  await expect(page.locator("canvas").first()).toBeVisible();
  expect(await page.locator("canvas").count()).toBeGreaterThan(20);

  /*
   * The control letters have to be there.
   *
   * Which is a check on how the sample is built, not on the application.
   * Subsetting a font drops its glyph names by default, renaming every glyph to
   * glyph37 and writing a post table with nothing in it -- and the control
   * letters are found by name, so the panel read "0 of 7" and the one feature
   * the sample exists to demonstrate did nothing at all. It looked fine.
   */
  await expect(page.getByText("7 of 7")).toBeVisible();

  // And the controls work on it, which is the whole point of shipping one.
  const weight = await paramSlider(page, "Weight");
  await weight.focus();
  for (let press = 0; press < 12; press++) await page.keyboard.press("ArrowRight");
  expect(errors).toEqual([]);
});

/**
 * The tips: shown once, where they apply, then gone.
 *
 * The thing worth testing is the "then gone" -- a tip that reappears on every
 * visit stops being help and becomes furniture.
 */
test("introduces each view once and then stays out of the way", async ({ page }) => {
  await page.goto("/");
  await openFont(page);

  const gridTip = page.locator("[data-coach-mark=grid]");
  await expect(gridTip).toBeVisible();

  await gridTip.getByRole("button", { name: "Got it" }).click();
  await expect(gridTip).toBeHidden();

  // Somewhere else and back: it does not return.
  await page.getByRole("button", { name: "Kerning", exact: true }).click();
  await expect(page.locator("[data-coach-mark=kerning]")).toBeVisible();
  await page.getByRole("button", { name: "Font", exact: true }).click();
  await expect(gridTip).toBeHidden();

  // Nor after a reload, which is what the remembering is for.
  await page.reload();
  await openFont(page);
  await expect(gridTip).toBeHidden();
});

/**
 * The help drawer.
 *
 * Its parameter section is generated from the same list the inspector draws its
 * sliders from, so the check that matters is that the two agree: every slider
 * on screen is explained, and nothing is explained that is not there.
 */
test("explains every parameter the inspector actually offers", async ({ page }) => {
  await page.goto("/");
  await openFont(page);

  const panel = page.getByRole("complementary", { name: "Parameters" });
  const sliders = panel.getByRole("slider");
  const parameters: string[] = [];
  for (let index = 0; index < (await sliders.count()); index++) {
    const name = await sliders.nth(index).getAttribute("aria-label");
    if (name) parameters.push(name);
  }
  expect(parameters.length).toBeGreaterThan(5);

  await page.getByRole("button", { name: "Help", exact: true }).click();
  const help = page.getByRole("dialog", { name: "Help" });
  await expect(help).toBeVisible();

  // Scoped to the half this panel belongs to. Both halves have a weight and a
  // width and they mean different things, so an unscoped search would be
  // answered by whichever section happened to come first.
  const explained = help.locator('[data-help-half="imported"]');
  for (const label of parameters) {
    await expect(explained.getByText(label, { exact: true })).toBeVisible();
  }

  // And it closes on Escape, as every panel in the application does.
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();
});

test("can bring the tips back after they have been dismissed", async ({ page }) => {
  await page.goto("/");
  await openFont(page);

  const gridTip = page.locator("[data-coach-mark=grid]");
  await gridTip.getByRole("button", { name: "Got it" }).click();
  await expect(gridTip).toBeHidden();

  await page.getByRole("button", { name: "Help", exact: true }).click();
  await page.getByRole("button", { name: "Show the tips again" }).click();
  await expect(gridTip).toBeVisible();
});

/**
 * Drawing a font from nothing.
 *
 * This half of the application needs no font to be open, which is the whole
 * point of it, so none of these tests touch the file input.
 */
test("draws a font with no font open", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await page.getByRole("button", { name: "Draw", exact: true }).click();

  // A letter on the stage, a specimen line, and the whole alphabet under it.
  await expect(page.locator("[data-forge-stage]")).toBeVisible();
  await expect(page.getByRole("img", { name: "Specimen" })).toBeVisible();
  expect(await page.locator("[data-forge-cell]").count()).toBeGreaterThan(60);
  expect(errors).toEqual([]);
});

/**
 * The behaviour the whole idea rests on, checked through the interface rather
 * than through the model: turn the serifs on and watch the alphabet change.
 */
/**
 * The accented letters, end to end.
 *
 * Checked through the interface and then through the file, because the two can
 * disagree: a letter can be in the grid and still be missing from the font, and
 * a font can carry a glyph nothing maps to. The last assertion is the one that
 * matters -- the browser is asked to set accented text in the exported font and
 * to say how wide it came out, which nothing but a real, complete font can do.
 */
test("draws the accented letters and writes them into the font", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openForge(page);

  // In the alphabet, with the letters that are not a letter and a mark.
  for (const name of ["eacute", "Ntilde", "aring", "ccedilla", "oslash", "germandbls", "AE"]) {
    await expect(page.locator(`[data-forge-cell="${name}"]`)).toBeVisible();
  }

  // And in a line of type, which is where somebody would notice them missing.
  await page.locator('input[value="Handgloves"]').fill("Ångström café Ærø");
  const line = page.getByRole("img", { name: "Specimen" });
  await expect.poll(() => line.locator("path").count()).toBe(15);

  const download = await Promise.race([
    page.waitForEvent("download", { timeout: 90_000 }),
    page
      .getByRole("button", { name: "Export", exact: true })
      .click()
      .then(() =>
        page
          .getByRole("dialog")
          .getByRole("button", { name: "Download", exact: true })
          .click()
          .then(() => page.waitForEvent("download", { timeout: 90_000 })),
      ),
  ]);
  const bytes = readFileSync((await download.path())!);

  const measured = await page.evaluate(
    async (data) => {
      const face = new FontFace("Accented", new Uint8Array(data).buffer as ArrayBuffer);
      await face.load();
      document.fonts.add(face);
      const context = document.createElement("canvas").getContext("2d")!;
      context.font = "100px Accented";
      const width = (text: string) => context.measureText(text).width;
      return {
        // A character the font has no glyph for, to measure the others against.
        blank: width("\uFFFF"),
        accented: ["é", "ñ", "å", "ç", "ø", "ß", "æ", "þ", "í"].map(width),
      };
    },
    [...bytes],
  );

  for (const width of measured.accented) {
    expect(width).toBeGreaterThan(0);
    expect(Math.abs(width - measured.blank)).toBeGreaterThan(0.5);
  }
  expect(errors).toEqual([]);
});

/**
 * The symbols, end to end.
 *
 * The half of a character set nobody notices until they set a line of real text
 * in the font they just made: no ampersand, no at sign, no brackets, no
 * currency, no arithmetic. Checked in the grid, then in a line of type, and
 * then in the file -- because the three can disagree, and the file is the one
 * that decides whether the font is usable.
 */
test("draws the symbols and writes them into the font", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openForge(page);

  // Every character the other half offers a box for, which is the whole set.
  expect(await page.locator("[data-forge-cell]").count()).toBeGreaterThanOrEqual(189);
  for (const name of [
    "ampersand",
    "at",
    "sterling",
    "braceleft",
    "onehalf",
    "questiondown",
    "mu",
  ]) {
    await expect(page.locator(`[data-forge-cell="${name}"]`)).toBeVisible();
  }

  // And in a line of type, which is where somebody would notice them missing:
  // the specimen draws one outline per character it can find and nothing at all
  // for the ones it cannot.
  await page.locator('input[value="Handgloves"]').fill("& @ £ ½ ¿ ~ § ¶");
  const line = page.getByRole("img", { name: "Specimen" });
  await expect.poll(() => line.locator("path").count()).toBe(8);

  const download = await Promise.race([
    page.waitForEvent("download", { timeout: 90_000 }),
    page
      .getByRole("button", { name: "Export", exact: true })
      .click()
      .then(() =>
        page
          .getByRole("dialog")
          .getByRole("button", { name: "Download", exact: true })
          .click()
          .then(() => page.waitForEvent("download", { timeout: 90_000 })),
      ),
  ]);
  const bytes = readFileSync((await download.path())!);

  const measured = await page.evaluate(
    async (data) => {
      const face = new FontFace("Symbols", new Uint8Array(data).buffer as ArrayBuffer);
      await face.load();
      document.fonts.add(face);
      const context = document.createElement("canvas").getContext("2d")!;
      context.font = "100px Symbols";
      const width = (text: string) => context.measureText(text).width;
      return {
        // A character the font has no glyph for, to measure the others against.
        blank: width("\uFFFF"),
        symbols: "&@£½¿~§¶#%*+<=>[]{}|©®°±²µ·»¼×÷"
          .split("")
          .map((one) => [one, width(one)] as const),
      };
    },
    [...bytes],
  );

  const missing = measured.symbols
    .filter(([, width]) => width === 0 || Math.abs(width - measured.blank) < 0.5)
    .map(([character]) => character);
  expect(missing.join(" "), "the font went out without these").toBe("");
  expect(errors).toEqual([]);
});

/**
 * A family rather than a font.
 *
 * The application drew one weight, which is a specimen rather than something
 * anybody can typeset with: a text face with no bold cannot emphasise a word.
 * Checked through the interface -- the specimen gains a line per weight, so
 * what is promised is also what is shown -- and then in the file, because a
 * zip of nine fonts that a font menu will not group is nine fonts and not a
 * family.
 */
test("draws a family and downloads every weight of it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openForge(page);

  // One weight to begin with: one line of specimen and no labels beside it.
  await expect(page.locator("[data-forge-specimen-line]")).toHaveCount(1);
  await expect(page.locator("[data-forge-weight-label]")).toHaveCount(0);

  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator('[data-weight="400"]')).toHaveAttribute("data-weight-on", "yes");
  await expect(dialog.locator('[data-weight="700"]')).toHaveAttribute("data-weight-on", "no");

  await dialog.locator('[data-weight="300"]').click();
  await dialog.locator('[data-weight="700"]').click();
  await expect(dialog.locator("[data-download-family]")).toHaveText("Download 3");
  await expect(dialog.locator("[data-weight-note]")).toContainText("3 weights");

  // The specimen says so too, which is the point of showing it there.
  await expect(page.locator("[data-forge-specimen-line]")).toHaveCount(3);
  await expect(page.locator('[data-forge-weight-label="700"]')).toHaveText("Bold");

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 120_000 }),
    dialog.locator("[data-download-family]").click(),
  ]);
  expect(download.suggestedFilename()).toBe("Untitled.zip");
  const saved = test.info().outputPath("family.zip");
  await download.saveAs(saved);

  /*
   * Opened by something that is not this application. A zip written and read
   * by the same code is a zip that agrees with itself; the one that matters is
   * the one on the machine it lands on.
   */
  const listed = execFileSync("python3", [
    "-c",
    "import zipfile,sys;print('\\n'.join(sorted(n.filename for n in zipfile.ZipFile(sys.argv[1]).infolist())))",
    saved,
  ])
    .toString()
    .trim()
    .split("\n");
  expect(listed).toEqual(["Untitled-Bold.ttf", "Untitled-Light.ttf", "Untitled-Regular.ttf"]);
  expect(errors).toEqual([]);
});

/**
 * The weight a drawing already is.
 *
 * Half the faces offered here are not a Regular, and calling one a Regular and
 * asking for a Bold of it is asking for a stem half again as wide as the one
 * that was already closing the counters. The display face is read as heavy when
 * it is chosen, so its family runs downward from where it actually is.
 *
 * Eight hundred rather than seven: the display face is a fat face, and its stem
 * is not a bold's. The number is measured off the drawing rather than declared,
 * so it moved when the face did.
 */
test("knows the display face is already a heavy", async ({ page }) => {
  await openForge(page);
  await page.getByRole("button", { name: "Display", exact: true }).click();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByRole("dialog").locator("[data-drawn-weight]")).toHaveValue("800");
  await expect(page.getByRole("dialog").locator('[data-weight="800"]')).toBeDisabled();
});

test("spreads one edit across the whole alphabet", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Draw", exact: true }).click();

  const before = await page.locator('[data-forge-cell="b"] path').getAttribute("d");
  const alsoBefore = await page.locator('[data-forge-cell="H"] path').getAttribute("d");

  // The serif is a part of n, so its controls are on screen without hunting.
  await page.locator('[data-forge-part="slab"]').getByRole("switch", { name: "Serifs" }).click();

  await expect
    .poll(() => page.locator('[data-forge-cell="b"] path').getAttribute("d"))
    .not.toBe(before);
  expect(await page.locator('[data-forge-cell="H"] path').getAttribute("d")).not.toBe(alsoBefore);
});

test("says how many letters an edit will reach", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  const shoulder = page.locator('[data-forge-part="shoulder"]');
  await expect(shoulder).toBeVisible();
  await expect(shoulder.getByText(/\d+ letters/)).toBeVisible();
});

test("offers every control whichever letter is open, and says which are here", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Draw", exact: true }).click();

  /*
   * The panel used to show only the parts the open letter had, which read well
   * and hid the two controls that change a face most. The application opens on
   * n; squareness lives on an o and corner rounding lives on an A or a k, so
   * neither was on screen, and there was no way to discover the tool could
   * square a bowl without first guessing you should go and click a different
   * letter.
   */
  const parts = ["bowl", "corner", "shoulder", "slab", "terminal", "crossbar"];
  for (const part of parts) {
    await expect(page.locator(`[data-forge-part="${part}"]`)).toBeVisible();
  }

  // n has a shoulder and no bowl, and the panel says so rather than hiding it.
  await expect(page.locator('[data-forge-part="shoulder"]')).toHaveAttribute(
    "data-forge-part-here",
    "yes",
  );
  await expect(page.locator('[data-forge-part="bowl"]')).toHaveAttribute(
    "data-forge-part-here",
    "no",
  );

  // o is the other way round, and nothing has moved on the screen.
  await page.locator('[data-forge-cell="o"]').click();
  await expect(page.locator('[data-forge-part="bowl"]')).toHaveAttribute(
    "data-forge-part-here",
    "yes",
  );
  await expect(page.locator('[data-forge-part="shoulder"]')).toHaveAttribute(
    "data-forge-part-here",
    "no",
  );
});

/**
 * The starting points exist because the controls that reach these shapes are
 * not ones anybody finds by turning knobs: squareness takes a circle to a
 * rectangle with no halfway house that suggests it.
 */
test("starts from any of the eight, and every one draws a different font", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Draw", exact: true }).click();

  const seen = new Set<string>();
  for (const name of [
    "Sans",
    "Serif",
    "Display",
    "Geometric",
    "Ribbon",
    "Technical",
    "Fairground",
    "Marker",
  ]) {
    await page.locator(`[data-forge-base="${name}"]`).click();
    await expect
      .poll(async () => {
        const drawn = await page.locator('[data-forge-cell="o"] path').getAttribute("d");
        return drawn && !seen.has(drawn);
      })
      .toBe(true);
    seen.add((await page.locator('[data-forge-cell="o"] path').getAttribute("d"))!);
  }
  expect(seen.size).toBe(8);
});

/**
 * A letter told to keep its own version keeps it, and is marked so it can be
 * found again -- otherwise the only way back would be to remember which letter
 * it was.
 */
test("lets one letter hold its own version of a part", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await page.locator('[data-forge-part="slab"]').getByRole("switch", { name: "Serifs" }).click();

  await page.locator('[data-forge-cell="p"]').click();
  await page.getByRole("button", { name: "p alone" }).click();
  const reach = page.locator('[data-forge-part="slab"]').getByRole("slider", { name: "Reach" });
  await reach.focus();
  for (let press = 0; press < 20; press++) await page.keyboard.press("ArrowRight");

  await expect(page.locator('[data-forge-part="slab"]').getByText("held · release")).toBeVisible();
  await page.getByRole("button", { name: "Whole font" }).click();
  await expect(page.locator('[data-forge-cell="b"]')).toBeVisible();
});

/**
 * The end of the road: a font drawn here has to come out as a file a browser
 * will actually load, or none of the rest of it counts for anything.
 */
test("writes a font file the browser can use", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await page.getByRole("button", { name: "Export", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Download font" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Font name" }).fill("Forged Test");

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 90_000 }),
    dialog.getByRole("button", { name: "Download" }).click(),
  ]);
  const path = await download.path();
  expect(path).toBeTruthy();

  const bytes = readFileSync(path!);
  expect(bytes.byteLength).toBeGreaterThan(2000);

  // The browser is the judge: if it accepts the bytes as a font and measures
  // text with it, it is a font.
  const measured = await page.evaluate(async (data) => {
    const face = new FontFace("ForgedTest", new Uint8Array(data).buffer);
    await face.load();
    document.fonts.add(face);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d")!;
    context.font = "100px ForgedTest";
    return context.measureText("Handgloves").width;
  }, Array.from(bytes));
  expect(measured).toBeGreaterThan(10);
});
