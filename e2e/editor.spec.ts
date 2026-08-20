/**
 * Browser checks.
 *
 * The unit and integration tests prove the font engine writes valid fonts.
 * These prove the application around it actually works: a font opens, the views
 * render, edits reach the document, and the exported file that lands in the
 * browser is a real font.
 */

import { existsSync, readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

const FONT_CANDIDATES = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
];
const FONT_PATH = FONT_CANDIDATES.find((path) => existsSync(path));

test.skip(!FONT_PATH, "needs a system font to open");

/**
 * The slider that drives a named family parameter.
 *
 * Found by the name it announces to a screen reader rather than by counting
 * along the panel. The count went out of step whenever a parameter was added,
 * silently pointing the test at the neighbouring control; and the label was
 * being read out of a span that has since gone, because the slider draws its
 * own. The accessible name is the one thing here that is meant to be stable.
 */
async function paramSlider(page: Page, label: string) {
  const panel = page.getByRole("complementary", { name: "Parameters" });
  const slider = panel.getByRole("slider", { name: label });
  await expect(slider, `no family parameter called ${label}`).toBeVisible();
  return slider;
}

/** Open the test font through the file input the toolbar drives. */
async function openFont(page: Page): Promise<void> {
  await page.setInputFiles('input[type="file"]', FONT_PATH!);
  // The toolbar reports the family once parsing finishes.
  await expect(page.getByText("DejaVu Sans", { exact: false }).first()).toBeVisible({
    timeout: 45_000,
  });
}

test("loads with no console errors and prompts for a font", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await expect(page.getByText("Typeforge")).toBeVisible();
  await expect(page.getByText("No font open")).toBeVisible();
  expect(errors).toEqual([]);
});

test("opens a font and fills the grid with drawn glyphs", async ({ page }) => {
  await page.goto("/");
  await openFont(page);

  // Cells are canvases, so check that one actually has ink rather than
  // trusting that the element exists.
  const painted = await page.evaluate(() => {
    const canvases = [...document.querySelectorAll("canvas")];
    return canvases.some((canvas) => {
      const context = canvas.getContext("2d");
      if (!context || canvas.width === 0) return false;
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
      return false;
    });
  });
  expect(painted).toBe(true);

  // The count next to the search box, not the status message that also names it.
  await expect(page.getByText("6,253 glyphs", { exact: true })).toBeVisible();
});

test("searches the grid by typing a letter", async ({ page }) => {
  await page.goto("/");
  await openFont(page);

  await page.getByLabel("Search glyphs").fill("W");
  // Searching a single character matches that glyph by codepoint.
  await expect(page.getByText(/^\d+ of 6,253$/)).toBeVisible();
  const count = await page.locator("canvas").count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThan(50);
});

test("moves through every view without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await openFont(page);

  for (const view of ["Glyph", "Kerning", "Spacing", "Checks", "Font"]) {
    await page.getByRole("button", { name: view, exact: true }).click();
    await page.waitForTimeout(400);
  }
  expect(errors).toEqual([]);
});

test("a family parameter reshapes the glyphs on screen", async ({ page }) => {
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();
  await page.waitForTimeout(500);

  const inkBefore = await measureInk(page);

  // Drive the weight parameter through the slider's keyboard interface, which
  // is the same code path the pointer uses.
  const weight = page.getByRole("slider").nth(1);
  await weight.focus();
  for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(800);

  const inkAfter = await measureInk(page);
  // Adding weight thickens the strokes, so more pixels are covered.
  expect(inkAfter).toBeGreaterThan(inkBefore);
});

test("checks the font and reports what it finds", async ({ page }) => {
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Checks", exact: true }).click();

  // The check runs on its own when the view opens.
  await expect(page.getByText(/glyphs checked/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/errors?$|errors\b/).first()).toBeVisible();

  // DejaVu really does carry stray one-point contours, so this is a true
  // finding rather than a demonstration fixture.
  await expect(page.getByText(/contour that draws nothing/)).toBeVisible();

  // Every finding about a glyph offers a way into it.
  const open = page.getByRole("button", { name: /^Open / }).first();
  await open.click();
  await expect(page.getByRole("button", { name: "Glyph", exact: true })).toBeVisible();
});

test("shows how a letter is built and can build the accented set", async ({ page }) => {
  await page.goto("/");
  await openFont(page);

  // Open an accented letter and see what it is made from.
  await page.getByLabel("Search glyphs").fill("aacute");
  await page.getByRole("button", { name: /^aacute|^á/ }).first().dblclick();
  await page.getByRole("button", { name: "build", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Built from" })).toBeVisible();
  // á is a plus acute, not a drawing of its own.
  await expect(page.getByRole("button", { name: "a", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "acute", exact: true })).toBeVisible();

  // The whole-font actions report what they did.
  await page.getByRole("button", { name: "Read anchors from the font" }).click();
  await expect(page.getByText(/Read anchors from \d+ letters/)).toBeVisible();

  await page.getByRole("button", { name: "Build accented glyphs" }).click();
  // DejaVu already has its accented set, so nothing should be disturbed.
  await expect(page.getByText(/already there|Built \d+ accented/)).toBeVisible();
});

test("a letter reports how many glyphs are built from it", async ({ page }) => {
  await page.goto("/");
  await openFont(page);
  await page.getByLabel("Search glyphs").fill("a");
  await page.getByRole("button", { name: "a", exact: true }).first().dblclick();
  await page.getByRole("button", { name: "build", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Used by" })).toBeVisible();
  await expect(page.getByText(/\d+ glyphs are built from a/)).toBeVisible();
});

test("exports a TrueType file the browser can use as a font", async ({ page }) => {
  await page.goto("/");
  await openFont(page);

  await page.getByRole("button", { name: "Export" }).click();
  await expect(page.getByRole("dialog", { name: "Export font" })).toBeVisible();

  const download = await Promise.race([
    page.waitForEvent("download", { timeout: 60_000 }),
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Export" })
      .click()
      .then(() => page.waitForEvent("download", { timeout: 60_000 })),
  ]);

  const path = await download.path();
  expect(path).toBeTruthy();
  const bytes = readFileSync(path!);
  expect(bytes.length).toBeGreaterThan(10_000);
  // A TrueType file starts with the version tag 0x00010000.
  expect([...bytes.subarray(0, 4)]).toEqual([0, 1, 0, 0]);
  expect(download.suggestedFilename()).toMatch(/\.ttf$/);

  // The strongest check available in a browser: ask it to actually parse the
  // bytes as a font. FontFace.load rejects anything malformed.
  const loaded = await page.evaluate(async (data) => {
    const face = new FontFace("TypeforgeExport", new Uint8Array(data).buffer);
    try {
      await face.load();
      return true;
    } catch {
      return false;
    }
  }, [...bytes]);
  expect(loaded).toBe(true);
});

/** Count the opaque pixels on the largest canvas, as a proxy for the drawn shape. */
async function measureInk(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvases = [...document.querySelectorAll("canvas")];
    const canvas = canvases.sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return 0;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 40) count++;
    return count;
  });
}

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

  // The inspector's own tabs behave the same way.
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

test("hovering a toolbar button changes it before you press", async ({ page }) => {
  await page.goto("/");
  await openFont(page);

  const spacing = page.getByRole("button", { name: "Spacing", exact: true });
  const background = () =>
    spacing.evaluate((element) => getComputedStyle(element).backgroundColor);

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
  await page.getByRole("button", { name: "Draw a font" }).click();

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
test("spreads one edit across the whole alphabet", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Draw a font" }).click();

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
  await page.getByRole("button", { name: "Draw a font" }).click();
  const shoulder = page.locator('[data-forge-part="shoulder"]');
  await expect(shoulder).toBeVisible();
  await expect(shoulder.getByText(/\d+ letters/)).toBeVisible();
});

test("offers every control whichever letter is open, and says which are here", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Draw a font" }).click();

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
  await page.getByRole("button", { name: "Draw a font" }).click();

  const seen = new Set<string>();
  for (const name of ["Sans", "Serif", "Display", "Geometric", "Ribbon", "Technical", "Fairground", "Marker"]) {
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
  await page.getByRole("button", { name: "Draw a font" }).click();
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
  await page.getByRole("button", { name: "Draw a font" }).click();
  await page.getByRole("button", { name: "Download", exact: true }).click();

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

/** Drag a handle across the stage by a number of screen pixels. */
async function dragHandle(page: Page, id: string, dx: number, dy: number): Promise<void> {
  const handle = page.locator(`[data-forge-handle="${id}"]`);
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step++) {
    await page.mouse.move(x + (dx * step) / 10, y + (dy * step) / 10, { steps: 1 });
  }
  await page.mouse.up();
}

async function openForge(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Draw a font" }).click();
  await expect(page.locator("[data-forge-stage]")).toBeVisible();
  // Out of the way of the handles, which sit near the top of the stage.
  await page
    .locator("[data-coach-mark] button")
    .click()
    .catch(() => {});
}

/**
 * Pulling the letter about.
 *
 * Every handle is bound to something the font has a name for, so a drag is the
 * same edit the panel makes. Which means the test that matters is not that the
 * letter under the pointer moved -- it is that the rest of the font moved with
 * it.
 */
test("offers handles for the parts the letter has, and no others", async ({ page }) => {
  await openForge(page);

  const on = async (): Promise<string[]> =>
    (await page.locator("[data-forge-handle]").evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLElement).dataset.forgeHandle ?? ""),
    )).sort();

  // n has an arch, so it has a shoulder to pull and a rhythm to set.
  expect(await on()).toContain("shoulder");
  expect(await on()).toContain("counterWidth");

  // o has neither.
  await page.locator('[data-forge-cell="o"]').click();
  expect(await on()).not.toContain("shoulder");
  expect(await on()).toContain("weight");
});

test("pulls the weight out of one letter and every letter follows", async ({ page }) => {
  await openForge(page);
  const before = await page.locator('[data-forge-cell="o"] path').getAttribute("d");
  const alsoBefore = await page.locator('[data-forge-cell="Z"] path').getAttribute("d");

  await dragHandle(page, "weight", 50, 0);

  await expect
    .poll(() => page.locator('[data-forge-cell="o"] path').getAttribute("d"))
    .not.toBe(before);
  expect(await page.locator('[data-forge-cell="Z"] path').getAttribute("d")).not.toBe(alsoBefore);
});

test("moves the shoulder on every arched letter at once", async ({ page }) => {
  await openForge(page);
  const before = await page.locator('[data-forge-cell="m"] path').getAttribute("d");
  const round = await page.locator('[data-forge-cell="o"] path').getAttribute("d");

  await dragHandle(page, "shoulder", 0, -40);

  await expect
    .poll(() => page.locator('[data-forge-cell="m"] path').getAttribute("d"))
    .not.toBe(before);
  // An o has no shoulder, so it must be untouched.
  expect(await page.locator('[data-forge-cell="o"] path').getAttribute("d")).toBe(round);
});

/**
 * A drag is one thing that happened, so it is one thing to undo. Recorded as
 * written it arrived as a run of changes, and taking one back moved the stem a
 * few units and stopped.
 */
test("takes a whole drag back in one undo", async ({ page }) => {
  await openForge(page);
  const stage = page.locator("[data-forge-stage] path").first();
  const before = await stage.getAttribute("d");

  await dragHandle(page, "weight", 50, 0);
  await expect.poll(() => stage.getAttribute("d")).not.toBe(before);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => stage.getAttribute("d")).toBe(before);
});

/** A serif face leaves its hyphen, slash and quotes bare, as every serif face does. */
test("keeps the serifs off the marks that never wear them", async ({ page }) => {
  await openForge(page);
  const bare = ["hyphen", "slash", "quotesingle", "quotedbl"];
  const before: Record<string, string | null> = {};
  for (const mark of [...bare, "l"]) {
    before[mark] = await page.locator(`[data-forge-cell="${mark}"] path`).getAttribute("d");
  }

  await page.locator('[data-forge-part="slab"]').getByRole("switch", { name: "Serifs" }).click();

  // The letters gained serifs...
  await expect
    .poll(() => page.locator('[data-forge-cell="l"] path').getAttribute("d"))
    .not.toBe(before.l);
  // ...and the marks did not.
  for (const mark of bare) {
    expect(
      await page.locator(`[data-forge-cell="${mark}"] path`).getAttribute("d"),
      `${mark} grew a serif`,
    ).toBe(before[mark]);
  }
});

/**
 * Seeing the thing being edited.
 *
 * This half of the application is about skeletons, and until the overlay
 * existed there was no way to look at one. A control that moves where an arch
 * springs from is far easier to understand next to the line it moves than next
 * to a number.
 */
test("shows the skeleton the letter is grown from", async ({ page }) => {
  await openForge(page);
  const stage = page.locator("[data-forge-stage]");
  const strokes = stage.locator("path[stroke]");
  await expect(strokes).toHaveCount(0);

  await page.locator("[data-forge-skeleton]").click();
  await expect.poll(() => strokes.count()).toBeGreaterThan(0);

  // And the ink steps back so the skeleton can be read against it.
  await expect(stage.locator('path[fill="var(--foreground)"]')).toHaveAttribute("opacity", "0.32");

  await page.locator("[data-forge-skeleton]").click();
  await expect(strokes).toHaveCount(0);
});

/**
 * The specimen is typed rather than fixed, because the word that shows the
 * problem is different for every font and nobody can guess it in advance.
 */
test("sets the specimen in whatever is typed into it", async ({ page }) => {
  await openForge(page);
  const line = page.getByRole("img", { name: "Specimen" });
  const before = await line.locator("path").count();

  await page.locator("[data-forge-specimen]").fill("mmm");
  await expect.poll(() => line.locator("path").count()).toBe(3);
  expect(before).not.toBe(3);

  // A character the font has no glyph for takes its space and draws nothing,
  // so the words of a specimen line do not run together.
  await page.locator("[data-forge-specimen]").fill("a a");
  await expect.poll(() => line.locator("path").count()).toBe(2);
});

test("shows the specimen the other way up", async ({ page }) => {
  await openForge(page);
  const fill = page.getByRole("img", { name: "Specimen" }).locator("g");
  await expect(fill).toHaveAttribute("fill", "var(--foreground)");
  await page.locator("[data-forge-reverse]").click();
  await expect(fill).toHaveAttribute("fill", "var(--canvas)");
});

/**
 * Saying what has closed up while the slider that closed it is still under the
 * hand, rather than leaving it to be found later.
 */
test("says which letters a setting has closed up", async ({ page }) => {
  await openForge(page);
  await expect(page.locator("[data-forge-warnings]")).toHaveCount(0);

  // Heavy and condensed together, which is where the figures lose their holes.
  const weight = page.getByRole("slider", { name: "Weight" });
  await weight.focus();
  for (let step = 0; step < 60; step++) await page.keyboard.press("ArrowRight");
  const width = page.getByRole("slider", { name: "Width", exact: true });
  await width.focus();
  for (let step = 0; step < 90; step++) await page.keyboard.press("ArrowLeft");

  const warnings = page.locator("[data-forge-warnings]");
  await expect(warnings).toBeVisible();
  await expect(warnings.getByText("Counters closing up")).toBeVisible();

  // And the letters it names are a way of getting to them.
  await warnings.getByRole("button", { name: "eight" }).click();
  await expect(page.locator("[data-forge-stage]")).toHaveAttribute("data-forge-stage", "eight");
});

/**
 * An alternate is a per-letter choice, which is the one decision here that does
 * not reach the whole font. Everything else still reaches it.
 */
test("draws one letter from another skeleton and leaves the rest alone", async ({ page }) => {
  await openForge(page);
  await page.locator('[data-forge-cell="a"]').click();

  const a = () => page.locator('[data-forge-cell="a"] path').getAttribute("d");
  const o = () => page.locator('[data-forge-cell="o"] path').getAttribute("d");
  const wasA = await a();
  const wasO = await o();

  await page.locator('[data-forge-forms="a"]').locator('[data-forge-form="double"]').click();
  await expect.poll(a).not.toBe(wasA);
  expect(await o()).toBe(wasO);

  // The pen still reaches the letter that changed shape.
  const weight = page.getByRole("slider", { name: "Weight" });
  await weight.focus();
  const doubled = await a();
  for (let step = 0; step < 20; step++) await page.keyboard.press("ArrowRight");
  await expect.poll(a).not.toBe(doubled);
});

test("zooms into the letter and back out again", async ({ page }) => {
  await openForge(page);
  const stage = page.locator("[data-forge-stage]");
  const before = await stage.getAttribute("viewBox");

  await stage.hover();
  await page.mouse.wheel(0, -400);
  await expect.poll(() => stage.getAttribute("viewBox")).not.toBe(before);

  await page.getByRole("button", { name: /fit$/ }).click();
  await expect.poll(() => stage.getAttribute("viewBox")).toBe(before);
});
