/**
 * Browser checks.
 *
 * The unit and integration tests prove the font engine writes valid fonts.
 * These prove the application around it actually works: a font opens, the views
 * render, edits reach the document, and the exported file that lands in the
 * browser is a real font.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  await page.setInputFiles("[data-open-input]", FONT_PATH!);
  // The toolbar reports the family once parsing finishes.
  await expect(page.getByText("DejaVu Sans", { exact: false }).first()).toBeVisible({
    timeout: 45_000,
  });
}

/**
 * A font with nothing in it, reached the way somebody would reach it.
 *
 * Through the palette rather than by calling the store, because starting again
 * throws away whatever is open and so asks first -- and because a test that
 * reaches past the confirmation is not testing the path anybody takes.
 */
async function startBlank(page: Page): Promise<void> {
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("textbox", { name: "Search everything" }).fill("start a new font");
  await page.getByRole("dialog", { name: "Quick actions" }).getByRole("option").first().click();
  const confirm = page.getByRole("alertdialog").getByRole("button", { name: "Go on" });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
}

test("loads with no console errors and prompts for a font", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  // The wordmark itself, not the word wherever it appears -- the empty state
  // mentions the project format by name, and matching loosely picked up both.
  await expect(page.getByText("Typeforge", { exact: true })).toBeVisible();
  await expect(page.getByText("No font open")).toBeVisible();
  expect(errors).toEqual([]);
});

/**
 * Opening a WOFF2.
 *
 * Worth a test of its own rather than folding into the one above, because the
 * two arrive by different routes: a TrueType file is read straight off, and a
 * WOFF2 has to be unpacked by a WebAssembly decoder first. That decoder has to
 * be told where its own `.wasm` lives, and when it is not it fails with a
 * message naming neither WOFF2 nor the font -- so every compressed font, which
 * is to say every font the library fetches, failed to open while a suite full
 * of TrueType tests stayed green.
 *
 * The file is made here rather than kept as a fixture, so what is opened is a
 * real WOFF2 produced by the same encoder rather than a blob nobody can check.
 */
test("opens a WOFF2, which is what the web serves", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  const woff2Path = join(tmpdir(), "typeforge-sample.woff2");
  if (!existsSync(woff2Path)) {
    const { Font, woff2 } = await import("fonteditor-core");
    await woff2.init();
    const ttf = readFileSync(FONT_PATH!);
    const font = Font.create(
      ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength) as ArrayBuffer,
      { type: "ttf", hinting: true },
    );
    writeFileSync(woff2Path, new Uint8Array(font.write({ type: "woff2", hinting: true })));
  }
  // The magic every WOFF2 starts with, so a broken fixture fails here and not
  // as a mystery in the application.
  expect(readFileSync(woff2Path).subarray(0, 4).toString("latin1")).toBe("wOF2");

  await page.goto("/");
  await page.setInputFiles("[data-open-input]", woff2Path);

  // The whole font, unpacked and drawn: the same count the TrueType of it
  // gives, since a WOFF2 is that file compressed and nothing else.
  await expect(page.getByText("6,253 glyphs", { exact: true })).toBeVisible({ timeout: 60_000 });

  // Cells are canvases, so check that one has ink rather than trusting that
  // the element exists -- an empty grid would pass every other assertion here.
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

/*
 * Opening a second font must not cost more than opening the first.
 *
 * It cost two minutes. React's development performance track diffs a
 * component's previous props against its next ones and writes out whatever
 * differs, and every cell in the grid was handed the whole typeface -- six
 * thousand glyphs of outlines, eighty times over, the moment there was an
 * earlier font to compare against. Nothing was wrong with the font or the
 * parsing, so nothing in the suite noticed: the tab simply stopped.
 *
 * The number below is not a claim about speed. Opening a font is well under a
 * second and this allows thirty, which is the difference between "the machine
 * is slow today" and "the interface has stopped".
 */
test("opens a second font as quickly as the first", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await openFont(page);

  // Away and back, so the cells on screen have an earlier font behind them --
  // a freshly mounted cell has nothing to be diffed against and is never slow.
  await page.getByRole("button", { name: "Kerning", exact: true }).click();
  await page.getByRole("button", { name: "Spacing", exact: true }).click();
  await page.getByRole("button", { name: "Font", exact: true }).click();
  await expect(page.getByText("6,253 glyphs", { exact: true })).toBeVisible();

  const started = Date.now();
  await page.setInputFiles("[data-open-input]", FONT_PATH!);
  await expect(page.getByText("6,253 glyphs", { exact: true })).toBeVisible({ timeout: 120_000 });
  expect(Date.now() - started, "the second open took long enough to look broken").toBeLessThan(
    30_000,
  );
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
  await expect(page.getByRole("dialog", { name: "Download font" })).toBeVisible();

  const download = await Promise.race([
    page.waitForEvent("download", { timeout: 60_000 }),
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Download" })
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
        if (box.right > edge + 0.5 || box.left < -0.5) names.push(button.textContent?.trim() ?? "?");
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
  await page.getByRole("button", { name: "Draw" }).click();

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

  const measured = await page.evaluate(async (data) => {
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
  }, [...bytes]);

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
  for (const name of ["ampersand", "at", "sterling", "braceleft", "onehalf", "questiondown", "mu"]) {
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

  const measured = await page.evaluate(async (data) => {
    const face = new FontFace("Symbols", new Uint8Array(data).buffer as ArrayBuffer);
    await face.load();
    document.fonts.add(face);
    const context = document.createElement("canvas").getContext("2d")!;
    context.font = "100px Symbols";
    const width = (text: string) => context.measureText(text).width;
    return {
      // A character the font has no glyph for, to measure the others against.
      blank: width("\uFFFF"),
      symbols: "&@£½¿~§¶#%*+<=>[]{}|©®°±²µ·»¼×÷".split("").map((one) => [one, width(one)] as const),
    };
  }, [...bytes]);

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
  const saved = join(tmpdir(), "family.zip");
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
  expect(listed).toEqual([
    "Untitled-Bold.ttf",
    "Untitled-Light.ttf",
    "Untitled-Regular.ttf",
  ]);
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
  await page.getByRole("button", { name: "Draw" }).click();

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
  await page.getByRole("button", { name: "Draw" }).click();
  const shoulder = page.locator('[data-forge-part="shoulder"]');
  await expect(shoulder).toBeVisible();
  await expect(shoulder.getByText(/\d+ letters/)).toBeVisible();
});

test("offers every control whichever letter is open, and says which are here", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Draw" }).click();

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
  await page.getByRole("button", { name: "Draw" }).click();

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
  await page.getByRole("button", { name: "Draw" }).click();
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
  await page.getByRole("button", { name: "Draw" }).click();
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

/** Drag a handle across the stage by a number of screen pixels. */
async function dragHandle(page: Page, id: string, dx: number, dy: number): Promise<void> {
  const handle = page.locator(`[data-forge-handle="${id}"]`);
  // Hovering first waits for the thing to be there and to stop moving, so the
  // box measured is the box that is still under the pointer a moment later.
  await handle.hover();
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

/**
 * Double-click a spot on the letter, given where that spot is in font units.
 *
 * Through the browser's own matrix rather than by working out where the letter
 * landed: the drawing is fitted into whatever room the window gave it, and a
 * second copy of that sum in the tests would be a second thing to keep right.
 */
async function pressSpot(page: Page, x: number, y: number): Promise<void> {
  const at = await page.evaluate(([fx, fy]) => {
    const svg = document.querySelector("[data-forge-stage]") as SVGSVGElement | null;
    const screen = svg?.getScreenCTM();
    if (!svg || !screen) return null;
    // The letter is drawn inside a flip, because font y runs up.
    const spot = new DOMPoint(fx, -fy).matrixTransform(screen);
    return { x: spot.x, y: spot.y };
  }, [x, y]);
  if (!at) throw new Error("no stage to press");
  await page.mouse.dblclick(at.x, at.y);
}

async function openForge(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Draw" }).click();
  await expect(page.locator("[data-forge-stage]")).toBeVisible();
  await settle(page);
}

/**
 * Wait for the first-run tip to be gone, not merely clicked.
 *
 * The tip is a row rather than an overlay, so dismissing it takes a line of
 * height out of the page and everything under it moves up -- and it does that a
 * hundred and fifty milliseconds after the click, once the fade has finished,
 * which is deliberate so a row of content does not jump under the pointer
 * mid-click.
 *
 * Clicking and carrying straight on meant a drag could measure where a handle
 * was, have the layout legitimately move under it, and then press forty pixels
 * below the thing it meant to press. Nothing changed, the test asked why, and
 * the answer had nothing to do with dragging. It never showed up on a fast
 * machine and failed twice in a row on a slow one.
 */
async function settle(page: Page): Promise<void> {
  const mark = page.locator("[data-coach-mark]");
  if ((await mark.count()) === 0) return;
  await mark.getByRole("button", { name: "Got it" }).click();
  await expect(mark).toHaveCount(0);
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

/*
 * Pressing a spot instead of reading the panel.
 *
 * The panel has forty controls in it and knowing that the curve where an arch
 * leaves its stem is called the shoulder is most of what it takes to find the
 * right one. Pressing the curve asks for none of that -- so what these check is
 * that the answer is the one a person would give, that it arrives in both
 * places at once, and that pulling it still moves the whole font.
 */
test("double-clicking the arch of an n opens the shoulder", async ({ page }) => {
  await openForge(page);

  // The outside of the curve, where the arch leaves the stem.
  await pressSpot(page, 110, 447);

  // A handle on the edge that was pressed.
  await expect(page.locator('[data-forge-probed="part:shoulder:spring"]')).toBeVisible();
  // Said in the words the panel uses, with how far a pull would carry.
  await expect(page.locator("[data-forge-found]")).toContainText("Springing");
  await expect(page.locator("[data-forge-found]")).toContainText("reaches");
  // And the panel is on that control, marked and scrolled to.
  const row = page.locator('[data-forge-control="part:shoulder:spring"]');
  await expect(row).toBeInViewport();
  await expect(row).toHaveClass(/ring-1/);
});

test("double-clicking the bar of an H opens the crossbar, and pulling it moves the font", async ({
  page,
}) => {
  await openForge(page);
  await page.locator('[data-forge-cell="H"]').click();
  await settle(page);

  const before = {
    H: await page.locator('[data-forge-cell="H"] path').getAttribute("d"),
    E: await page.locator('[data-forge-cell="E"] path').getAttribute("d"),
    o: await page.locator('[data-forge-cell="o"] path').getAttribute("d"),
  };

  // Just above the middle of the letter, which is where the bar is.
  await pressSpot(page, 332, 397);
  await expect(page.locator('[data-forge-probed="part:crossbar:height"]')).toBeVisible();

  await dragHandle(page, "part:crossbar:height", 0, -40);

  // The letter it was pulled on, and the other letters with a bar.
  await expect
    .poll(() => page.locator('[data-forge-cell="H"] path').getAttribute("d"))
    .not.toBe(before.H);
  await expect
    .poll(() => page.locator('[data-forge-cell="E"] path').getAttribute("d"))
    .not.toBe(before.E);
  // And not the ones without: an o has no bar to move.
  expect(await page.locator('[data-forge-cell="o"] path').getAttribute("d")).toBe(before.o);
});

test("says so when nothing shapes the spot", async ({ page }) => {
  await openForge(page);

  // The middle of the counter of an n, which is a hole rather than an edge.
  await pressSpot(page, 350, 250);

  await expect(page.locator('[data-forge-found="nothing"]')).toBeVisible();
  await expect(page.locator("[data-forge-probed]")).toHaveCount(0);
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

/**
 * And a run of key presses the same way.
 *
 * A slider reports the end of a pointer drag, which is how everything
 * downstream knows a hand has come off it. It also reports one after every
 * arrow press, and those are not endings: a run of ten presses is one
 * adjustment, and taking it back should cost one undo rather than ten. The two
 * are told apart by where the commit came from, and this is what says so.
 */
test("takes a run of key presses back in one undo too", async ({ page }) => {
  await openForge(page);
  const stage = page.locator("[data-forge-stage] path").first();
  const before = await stage.getAttribute("d");

  const weight = page.getByRole("slider", { name: "Weight" });
  await weight.focus();
  for (let step = 0; step < 10; step++) await page.keyboard.press("ArrowRight");
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

/**
 * A setting that is on or off, rather than a quantity.
 *
 * Worth its own test because the panel draws these from a list, and the list
 * gained a switch before the panel knew how to draw one. Handed to a slider,
 * a setting with no number took the whole view down -- so the check is not
 * only that the switch works, but that the view is still standing.
 */
test("offers the settings that are on or off as switches", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openForge(page);

  const panel = page.getByRole("complementary", { name: "Forge" });
  const oneWidth = panel.getByRole("switch", { name: "One width" });
  await expect(oneWidth).toBeVisible();
  await expect(oneWidth).toHaveAttribute("aria-checked", "false");

  // Every letter on one advance: an i is as wide as an m afterwards, and was
  // not before.
  const advance = (letter: string) =>
    page.locator(`[data-forge-cell="${letter}"] svg`).getAttribute("viewBox");
  const narrow = await advance("i");
  expect(narrow).not.toBe(await advance("m"));

  await oneWidth.click();
  await expect(oneWidth).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => advance("i")).toBe(await advance("m"));

  await expect(page.locator("[data-forge-stage]")).toBeVisible();
  expect(errors).toEqual([]);
});

/*
 * Cutting.
 *
 * The one thing here that takes material away rather than adding it, and the
 * one that needs a browser to be believed: the geometry is fetched after the
 * application has started, so a letter is drawn uncut for a moment and then
 * again with its slots. A test that only asked the store would pass whether or
 * not that second drawing ever arrived.
 */
test("cuts every letter in the font, and says what it did", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openForge(page);

  const panel = page.getByRole("complementary", { name: "Forge" });
  const slots = panel.getByRole("switch", { name: "Slots" });
  await expect(slots).toHaveAttribute("aria-checked", "false");
  // Nothing is cut to begin with, so nothing is said about it.
  await expect(page.locator("[data-forge-warnings]")).toHaveCount(0);

  const outline = (letter: string) =>
    page.locator(`[data-forge-cell="${letter}"] path`).getAttribute("d");
  const whole = await outline("H");

  await slots.click();
  await expect(slots).toHaveAttribute("aria-checked", "true");

  // The letter is drawn again, in pieces. Polled rather than awaited once,
  // because the library it needs is still on its way when the switch is
  // pressed and the first drawing after it is the uncut one.
  await expect.poll(() => outline("H")).not.toBe(whole);
  await expect.poll(async () => ((await outline("H")) ?? "").split("Z").length).toBeGreaterThan(3);

  // And the warning strip says so, in a count rather than in a list: most of
  // the alphabet is in pieces, which is what tells somebody this is a stencil
  // rather than an accident.
  const warnings = page.locator("[data-forge-warnings]");
  await expect(warnings).toContainText("cut into pieces");

  // The controls only appear once the cut is on, so the panel is six rows
  // until somebody wants more than six rows.
  await expect(panel.locator('[data-cut-control="slot:width"]')).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(slots).toHaveAttribute("aria-checked", "false");
  await expect.poll(() => outline("H")).toBe(whole);
  await expect(page.locator("[data-forge-warnings]")).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("cuts one letter differently from the rest", async ({ page }) => {
  await openForge(page);
  const panel = page.getByRole("complementary", { name: "Forge" });

  const outline = (letter: string) =>
    page.locator(`[data-forge-cell="${letter}"] path`).getAttribute("d");
  /*
   * The uncut letter first, so what follows can wait for the cut one by name.
   *
   * The strip puts the cuts on a few letters at a time rather than all at once,
   * so for a frame or two after the switch it is still showing the letter as it
   * was -- and an H with slots through it and an H without both answer to
   * "more than three pieces", which is what this used to wait for. It waited
   * for nothing, took the uncut H as its starting point, and then asked for a
   * change that had already happened.
   */
  const whole = { H: await outline("H"), o: await outline("o") };
  await panel.getByRole("switch", { name: "Slots" }).click();
  await expect.poll(() => outline("H")).not.toBe(whole.H);
  const before = { H: await outline("H"), o: await outline("o") };

  // In letter scope the switch lands on this letter alone.
  await page.locator('[data-forge-cell="H"]').click();
  await panel.getByRole("button", { name: "H alone" }).click();
  await panel.getByRole("switch", { name: "Slots" }).click();

  await expect.poll(() => outline("H")).not.toBe(before.H);
  expect(await outline("o")).toBe(before.o);
  // And the panel says the letter is holding its own, with a way to let it go.
  await expect(panel.locator("[data-forge-release-cuts]")).toBeVisible();

  await panel.locator("[data-forge-release-cuts]").click();
  await expect.poll(() => outline("H")).toBe(before.H);
});

test("cuts a letter somebody drew, with the rest of the font", async ({ page }) => {
  await openForge(page);
  await page.locator('[data-forge-cell="a"]').click();

  // Put a shape into the a that no recipe would ever draw, so what is on the
  // stage afterwards can only be the drawing.
  const download = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    page.locator('[data-forge-send-svg="a"]').click(),
  ]).then(([one]) => one);
  const sheet = readFileSync((await download.path())!, "utf8");
  const wedge = sheet.replace(
    /<path id="typeforge-ink"[^>]*\/>/,
    '<path id="typeforge-ink" data-typeforge="ink" d="M100 700 L500 700 L500 100 L100 100 Z"/>',
  );
  await page.setInputFiles('[data-forge-svg-input="a"]', {
    name: "a.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(wedge),
  });
  await expect(page.locator('[data-forge-imported="a"]')).toBeVisible();

  const drawn = () => page.locator('[data-forge-cell="a"] path').getAttribute("d");
  const solid = await drawn();

  const panel = page.getByRole("complementary", { name: "Forge" });
  await panel.getByRole("switch", { name: "Slots" }).click();

  // The drawing is cut with everything else, rather than sitting solid in the
  // middle of a striped word.
  await expect.poll(drawn).not.toBe(solid);
  await expect.poll(async () => ((await drawn()) ?? "").split("Z").length).toBeGreaterThan(2);

  // The two made out of the skeleton cannot reach it, and say so where it can
  // be read rather than leaving it to be noticed.
  const slotted = await drawn();
  await panel.getByRole("switch", { name: "Breaks" }).click();
  await expect(panel.getByText(/this one is made out of the skeleton/)).toBeVisible();
  await expect.poll(drawn).toBe(slotted);
});

/*
 * Building on a grid.
 *
 * The third way to make a letter here, and the one that most needs a browser
 * to be believed: it is an editor before it is a setting. Switching it on has
 * to put a whole alphabet on the grid, the grid has to appear over the letter,
 * and pressing one place on one cell has to change that letter and nothing
 * else.
 */
test("builds the alphabet on a grid, and edits it a cell at a time", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openForge(page);

  const panel = page.getByRole("complementary", { name: "Forge" });
  const grid = panel.getByRole("switch", { name: "Build on a grid" });
  await expect(grid).toHaveAttribute("aria-checked", "false");
  // No grid over the letter until there is one to show.
  await expect(page.locator("[data-forge-cells]")).toHaveCount(0);

  const outline = (letter: string) =>
    page.locator(`[data-forge-cell="${letter}"] path`).getAttribute("d");
  const drawn = { H: await outline("H"), o: await outline("o") };

  await grid.click();
  await expect(grid).toHaveAttribute("aria-checked", "true");

  // The whole alphabet is laid out, not just the letter on the stage.
  await expect.poll(() => outline("H")).not.toBe(drawn.H);
  await expect.poll(() => outline("o")).not.toBe(drawn.o);
  await expect(page.locator("[data-forge-cells]")).toBeVisible();
  await expect(panel).toContainText(/\d+ letters are laid out/);

  // The handles are gone: nothing behind a letter built from cells for them to
  // pull, and a handle that moves nothing is worse than no handle.
  await expect(page.locator("[data-forge-handle]")).toHaveCount(0);

  // One press on one place on one cell changes that letter and no other.
  const letter = await page.locator("[data-forge-stage]").getAttribute("data-forge-stage");
  const before = { own: await outline(letter!), other: await outline("o") };
  const port = page.locator("[data-forge-port]").first();
  await expect(port).toBeVisible();
  await port.click({ force: true });
  await expect.poll(() => outline(letter!)).not.toBe(before.own);
  expect(await outline("o")).toBe(before.other);

  // And it is one undo, like every other edit here.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => outline(letter!)).toBe(before.own);

  expect(errors).toEqual([]);
});

test("puts a letter back on the grid, and empties it", async ({ page }) => {
  await openForge(page);
  const panel = page.getByRole("complementary", { name: "Forge" });
  await panel.getByRole("switch", { name: "Build on a grid" }).click();

  const outline = () => page.locator('[data-forge-cell="n"] path').getAttribute("d");
  await expect(page.locator("[data-forge-cells]")).toBeVisible();
  const laid = await outline();

  await panel.locator("[data-forge-kit-clear]").click();
  // Emptied, the letter has no cells -- so it falls back to its own skeleton
  // rather than leaving a hole in the alphabet.
  await expect.poll(outline).not.toBe(laid);

  await panel.locator("[data-forge-kit-relay]").click();
  await expect.poll(outline).toBe(laid);
});

test("stamps filled shapes into cells, and takes them out again", async ({ page }) => {
  await openForge(page);
  const panel = page.getByRole("complementary", { name: "Forge" });
  await panel.getByRole("switch", { name: "Build on a grid" }).click();
  await expect(page.locator("[data-forge-cells]")).toBeVisible();

  // Start from an empty letter, so what appears can only be what was stamped.
  const outline = () => page.locator('[data-forge-cell="n"] path').getAttribute("d");
  const laid = await outline();
  await panel.locator("[data-forge-kit-clear]").click();
  /*
   * Waited for, rather than read straight after the press.
   *
   * `empty` is what the last assertion in this test compares against, and the
   * letter takes a moment to fall back to its own skeleton. Read too early it
   * held the cell-built outline instead -- so the test ended by asking a letter
   * with its stamps taken out to look like a letter that still had them, and
   * failed on a slow enough machine. It went flaky on CI before it went red.
   */
  await expect.poll(outline).not.toBe(laid);
  const empty = await outline();

  // Nothing is chosen to begin with, which is the eraser: a press on the stage
  // cannot quietly fill a cell in.
  await expect(panel.locator('[data-forge-fill="none"]')).toHaveAttribute("aria-pressed", "true");

  await panel.locator('[data-forge-fill="pie"]').click();
  await expect(panel.locator('[data-forge-fill="pie"]')).toHaveAttribute("aria-pressed", "true");

  const cell = page.locator('[data-forge-cell-box="0,0"]');
  await cell.click({ force: true });
  await expect.poll(outline).not.toBe(empty);
  const stamped = await outline();

  // Turning changes which way the shape faces, and stamps a different tile.
  await panel.locator("[data-forge-fill-turn]").click();
  await cell.click({ force: true });
  await expect.poll(outline).not.toBe(stamped);

  // And pressing a cell with the shape it already has takes it out, so there
  // is no eraser to go and find.
  await cell.click({ force: true });
  await expect.poll(outline).toBe(empty);
});

/*
 * The font library.
 *
 * The two services it reaches are somebody else's, and a test that depends on
 * them passing is a test that fails on a bad afternoon in a datacentre
 * somewhere. So the catalogue is answered here and the font files are served
 * out of the repository's own sample. What is being checked is this
 * application: that the list appears, that choosing a family measures it, that
 * the four things you can do with it do them, and that a service being down
 * leaves a usable picker rather than an empty one.
 */
const CATALOGUE = [
  { id: "inter", family: "Inter", category: "sans-serif", weights: [400, 700], styles: ["normal"], variable: true },
  { id: "playfair-display", family: "Playfair Display", category: "serif", weights: [400], styles: ["normal"], variable: false },
  { id: "roboto-mono", family: "Roboto Mono", category: "monospace", weights: [400], styles: ["normal"], variable: false },
];

/** Answer the catalogue, and serve the sample font for any file asked for. */
async function stubLibrary(page: Page, options: { catalogue?: boolean } = {}): Promise<void> {
  const bytes = readFileSync(FONT_PATH!);
  await page.route("**://api.fontsource.org/**", async (route) => {
    if (options.catalogue === false) {
      await route.fulfill({ status: 503, contentType: "text/plain", body: "no" });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(CATALOGUE),
    });
  });
  await page.route("**://fonts.googleapis.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/css",
      body: "@font-face{src:url(https://fonts.gstatic.com/s/x/v1/sample.ttf) format('truetype');}",
    });
  });
  await page.route("**://fonts.gstatic.com/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "font/ttf", body: bytes });
  });
  await page.route("**://cdn.jsdelivr.net/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "font/ttf", body: bytes });
  });
}

async function openLibrary(page: Page): Promise<void> {
  await page.locator("[data-open-library]").click();
  await expect(page.getByRole("dialog", { name: "Font library" })).toBeVisible();
}

test("lists the catalogue and measures what you choose", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await stubLibrary(page);
  await openForge(page);
  await openLibrary(page);

  await expect(page.locator("[data-library-font]")).toHaveCount(CATALOGUE.length);
  await expect(page.locator("[data-library-footer]")).toContainText("from Fontsource");

  await page.locator('[data-library-font="playfair-display"]').click();
  // Fetched, parsed and measured: the panel says what it is made of, and the
  // sample is drawn from the font's own outlines.
  await expect(page.locator("[data-library-measured]")).toBeVisible();
  await expect(page.locator("[data-library-measured]")).toContainText("Contrast");
  await expect(page.locator("[data-library-sample] path").first()).toBeVisible();
  await expect(page.locator("[data-library-action]")).toHaveCount(4);
  expect(errors).toEqual([]);
});

test("narrows the catalogue by name and by kind", async ({ page }) => {
  await stubLibrary(page);
  await openForge(page);
  await openLibrary(page);

  await page.locator("[data-library-search]").fill("play");
  await expect(page.locator("[data-library-font]")).toHaveCount(1);

  await page.locator("[data-library-search]").fill("");
  await page.locator('[data-library-category="monospace"]').click();
  await expect(page.locator("[data-library-font]")).toHaveCount(1);
  await expect(page.locator('[data-library-font="roboto-mono"]')).toBeVisible();
});

test("still offers a list when the catalogue cannot be reached", async ({ page }) => {
  await stubLibrary(page, { catalogue: false });
  await openForge(page);
  await openLibrary(page);

  // Not empty, and it says why rather than looking broken.
  await expect(page.locator("[data-library-footer]")).toContainText("built in");
  expect(await page.locator("[data-library-font]").count()).toBeGreaterThan(20);
});

test("starts a drawing from a font's proportions", async ({ page }) => {
  await stubLibrary(page);
  await openForge(page);

  const before = await page.locator('[data-forge-cell="n"] path').getAttribute("d");
  await openLibrary(page);
  await page.locator('[data-library-font="playfair-display"]').click();
  await expect(page.locator("[data-library-measured]")).toBeVisible();
  await page.locator('[data-library-action="seed"]').click();

  // The dialog closes, the drawing changed, and the toolbar says where it came
  // from. The letters are drawn from a description, so they are not the
  // font's letters -- but they are its proportions.
  await expect(page.getByRole("dialog", { name: "Font library" })).toBeHidden();
  await expect.poll(() => page.locator('[data-forge-cell="n"] path').getAttribute("d")).not.toBe(before);
  await expect(page.locator("header").first()).toContainText("My ");
});

test("shows a font behind your own letters, and puts it down again", async ({ page }) => {
  await stubLibrary(page);
  await openForge(page);
  await openLibrary(page);
  await page.locator('[data-library-font="inter"]').click();
  await expect(page.locator("[data-library-measured]")).toBeVisible();

  await page.locator('[data-library-action="reference"]').click();
  await page.getByRole("button", { name: "Close the library" }).click();
  await expect(page.locator("[data-reference]")).toBeVisible();

  await openLibrary(page);
  await page.locator('[data-library-action="reference"]').click();
  await page.getByRole("button", { name: "Close the library" }).click();
  await expect(page.locator("[data-reference]")).toHaveCount(0);
});

test("borrows a font's spacing onto a set of drawings", async ({ page }) => {
  await stubLibrary(page);
  await openAssemble(page);
  await dropFolder(page, PILE);
  await expect(page.locator('[data-assemble-filled="yes"]')).toHaveCount(5);

  const advanceOf = async (character: string): Promise<string | null> => {
    await page.locator(`[data-assemble-box="${character}"]`).click();
    return page.locator(`[data-assemble-stage="${character}"] ~ p`).innerText();
  };
  const before = await advanceOf("H");

  await openLibrary(page);
  await page.locator('[data-library-font="inter"]').click();
  await expect(page.locator("[data-library-measured]")).toBeVisible();
  await page.locator('[data-library-action="borrow"]').click();
  await expect(page.locator("[data-library-actions]")).toContainText("Took the spacing");
  await page.getByRole("button", { name: "Close the library" }).click();

  await expect.poll(() => advanceOf("H")).not.toBe(before);
});

/*
 * Assembling a font out of drawings.
 *
 * The drawings are made here rather than kept as fixtures, because what they
 * are matters: a box of a known height and a wedge of the same height, drawn
 * on one canvas with a baseline a hundred units up from the bottom. That makes
 * every assertion below something with a right answer -- the box must land on
 * the cap height, and the wedge must be given less white than the box.
 */
function drawing(inner: string, height = 800): { name: string; mimeType: string; buffer: Buffer } {
  return {
    name: "x.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 ${height}">${inner}</svg>`,
    ),
  };
}

/** A rectangle standing on the baseline, `tall` units high. */
function bar(tall: number, wide = 300) {
  return drawing(`<rect x="50" y="${700 - tall}" width="${wide}" height="${tall}"/>`);
}

/** A triangle standing on the baseline, like an A with no crossbar. */
function point(tall: number, wide = 600) {
  const top = 700 - tall;
  return drawing(`<polygon points="${50 + wide / 2},${top} ${50 + wide},700 50,700"/>`);
}

/** The same triangle upside down, like a V. */
function funnel(tall: number, wide = 600) {
  const top = 700 - tall;
  return drawing(`<polygon points="50,${top} ${50 + wide},${top} ${50 + wide / 2},700"/>`);
}

const PILE = [
  { ...bar(400), name: "H_.svg" },
  { ...bar(400, 120), name: "I_.svg" },
  { ...point(400), name: "A_.svg" },
  { ...funnel(400), name: "V_.svg" },
  { ...bar(280), name: "x.svg" },
];

async function openAssemble(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Assemble" }).click();
  await expect(page.locator("[data-assemble-instructions]")).toBeVisible();
}

/** Put a drawing in a named box, as double-clicking it would. */
async function fillBox(page: Page, character: string, file: { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
  await page.setInputFiles(`[data-assemble-box-input="${character}"]`, file);
  await expect(page.locator(`[data-assemble-box="${character}"]`)).toHaveAttribute(
    "data-assemble-filled",
    "yes",
  );
}

/** The bulk route, which still guesses characters from the file names. */
async function dropFolder(page: Page, files: Array<{ name: string; mimeType: string; buffer: Buffer }>): Promise<void> {
  await page.setInputFiles("[data-assemble-panel-input]", files);
}

/** Drag a file onto something, which no file input can stand in for. */
async function dragOnto(
  page: Page,
  selector: string,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  const transfer = await page.evaluateHandle(
    ({ name, mimeType, text }) => {
      const carried = new DataTransfer();
      carried.items.add(new File([text], name, { type: mimeType }));
      return carried;
    },
    { name: file.name, mimeType: file.mimeType, text: file.buffer.toString("utf8") },
  );
  const target = page.locator(selector);
  await target.dispatchEvent("dragover", { dataTransfer: transfer });
  await target.dispatchEvent("drop", { dataTransfer: transfer });
}

test("opens on a full set of empty boxes", async ({ page }) => {
  await openAssemble(page);

  // Every character the font will hold, waiting, and none of them filled.
  await expect(page.locator("[data-assemble-box]")).toHaveCount(189);
  await expect(page.locator("[data-assemble-placeholder]")).toHaveCount(189);
  await expect(page.locator('[data-assemble-filled="yes"]')).toHaveCount(0);
  await expect(page.locator("[data-assemble-group]")).toHaveCount(7);

  // The faint ones are the characters themselves, not a stand-in mark.
  await expect(page.locator('[data-assemble-placeholder="A"]')).toHaveText("A");
  await expect(page.locator('[data-assemble-placeholder="7"]')).toHaveText("7");
  await expect(page.locator('[data-assemble-placeholder="é"]')).toHaveText("é");
});

test("puts a drawing in the box that was chosen, whatever the file is called", async ({ page }) => {
  await openAssemble(page);

  // The file says H as loudly as a file can. The box says A, and the box wins.
  await fillBox(page, "A", { ...bar(400), name: "H_.svg" });

  await expect(page.locator('[data-assemble-filled="yes"]')).toHaveCount(1);
  await expect(page.locator('[data-assemble-box="H"]')).toHaveAttribute(
    "data-assemble-filled",
    "no",
  );
  // And it is a drawing now: the box holds ink rather than the faint letter.
  await expect(page.locator('[data-assemble-box="A"] path')).toBeVisible();
  await expect(page.locator('[data-assemble-placeholder="A"]')).toHaveCount(0);
  await expect(page.locator("[data-assemble-trouble]")).toHaveCount(0);
});

test("empties a box again", async ({ page }) => {
  await openAssemble(page);
  await fillBox(page, "Q", { ...bar(400), name: "anything.svg" });

  // Filling a box opens it, and the box that is open offers its ×.
  await expect(page.locator('[data-assemble-empty="Q"]')).toBeVisible();

  // Open another and the first tucks its × away again, until pointed at.
  await fillBox(page, "R", { ...bar(400), name: "another.svg" });
  await expect(page.locator('[data-assemble-empty="Q"]')).toBeHidden();
  await page.locator('[data-assemble-box="Q"]').hover();
  await expect(page.locator('[data-assemble-empty="Q"]')).toBeVisible();

  await page.locator('[data-assemble-empty="Q"]').click();

  await expect(page.locator('[data-assemble-box="Q"]')).toHaveAttribute(
    "data-assemble-filled",
    "no",
  );
  await expect(page.locator('[data-assemble-placeholder="Q"]')).toHaveText("Q");
  await expect(page.locator('[data-assemble-filled="yes"]')).toHaveCount(1);
});

test("takes a drawing dropped straight onto a box", async ({ page }) => {
  await openAssemble(page);

  await dragOnto(page, '[data-assemble-box="7"]', { ...bar(400), name: "V_.svg" });

  // Dropped on the 7, so it is the 7 -- the V in the name reaches nothing.
  await expect(page.locator('[data-assemble-box="7"]')).toHaveAttribute(
    "data-assemble-filled",
    "yes",
  );
  await expect(page.locator('[data-assemble-filled="yes"]')).toHaveCount(1);
});

test("replaces what is in a box without leaving the old drawing behind", async ({ page }) => {
  await openAssemble(page);
  await fillBox(page, "A", { ...bar(400), name: "first.svg" });
  const first = await page.locator('[data-assemble-box="A"] path').getAttribute("d");

  await page.setInputFiles('[data-assemble-box-input="A"]', {
    ...point(400),
    name: "second.svg",
  });

  await expect.poll(() => page.locator('[data-assemble-box="A"] path').getAttribute("d")).not.toBe(
    first,
  );
  // One drawing in the slot, not two -- and nothing stranded in the list.
  await expect(page.locator('[data-assemble-filled="yes"]')).toHaveCount(1);
  await expect(page.locator("[data-assemble-list] li")).toHaveCount(1);
  await expect(page.locator("[data-assemble-trouble]")).toHaveCount(0);
});

test("assembles a font from a pile of SVG drawings", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openAssemble(page);

  await dropFolder(page, PILE);

  // Every file placed, from its name alone.
  await expect(page.locator('[data-assemble-filled="yes"]')).toHaveCount(5);
  for (const character of ["H", "I", "A", "V", "x"]) {
    await expect(page.locator(`[data-assemble-box="${character}"]`)).toHaveAttribute("data-assemble-filled", "yes");
  }
  // They share a canvas height, so they are fitted against each other.
  await expect(page.locator('[data-assemble-fit="together"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(errors).toEqual([]);
});


test("cuts a font it did not draw, and lets one letter keep out of it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await openFont(page);

  const panel = page.locator('[data-cut-panel="edit"]');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Cutting the whole font.");

  /*
   * Counted off the canvas the grid draws on, because that is the only place
   * that answers the actual question -- whether what is on the screen is the
   * cut letter. A model that has been cut and a grid still drawing the file's
   * own outlines would pass every other check in this suite.
   */
  const inkInCell = async (): Promise<number> =>
    page.evaluate(() => {
      const cell = document.querySelector('[data-glyph-cell="H"] canvas') as HTMLCanvasElement;
      const context = cell?.getContext("2d");
      if (!context) return -1;
      const { data } = context.getImageData(0, 0, cell.width, cell.height);
      let lit = 0;
      for (let at = 3; at < data.length; at += 4) if (data[at] > 8) lit++;
      return lit;
    });

  const whole = await inkInCell();
  expect(whole).toBeGreaterThan(0);

  await panel.locator('[data-cut-switch="slot"]').click();
  await expect(panel.locator('[data-cut-switch="slot"]')).toHaveAttribute("aria-checked", "true");
  // Bands taken out of the letter leave less of it lit than there was.
  await expect.poll(inkInCell, { timeout: 20_000 }).toBeLessThan(whole * 0.97);

  // The two made out of a skeleton say so rather than doing nothing quietly.
  await panel.locator('[data-cut-switch="inline"]').click();
  await expect(panel).toContainText("made out of the skeleton");

  expect(errors).toEqual([]);
});

test("cuts a pile of drawings, and one drawing its own way", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openAssemble(page);
  await dropFolder(page, PILE);
  await expect(page.locator('[data-assemble-filled="yes"]')).toHaveCount(5);

  const panel = page.locator('[data-cut-panel="assemble"]');
  await expect(panel).toBeVisible();
  // The pile is what a cut reaches by default. Following the selected drawing
  // instead would cut one letter and leave the rest, which is neither what it
  // looks like nor what anybody wants first.
  await expect(panel).toContainText("Cutting every drawing in the pile.");

  await panel.locator('[data-cut-switch="slot"]').click();
  await expect(panel.locator('[data-cut-switch="slot"]')).toHaveAttribute("aria-checked", "true");

  // Now take one drawing out of the pile's cuts and give it its own.
  await page.locator('[data-cut-scope="one"]').click();
  await expect(panel).toContainText("alone. The rest of the pile keeps its own.");
  await panel.locator('[data-cut-switch="tooth"]').click();

  // Only the operation that was actually changed is marked as held: taking a
  // letter out starts it as a copy, and marking all six would say it had been
  // cut its own way six times over.
  await expect(panel.locator('[data-cut-release="tooth"]')).toBeVisible();
  await expect(panel.locator('[data-cut-release="slot"]')).toHaveCount(0);

  // And it can be put back to being cut like the rest.
  await panel.locator('[data-cut-release="tooth"]').click();
  await expect(panel.locator('[data-cut-release="tooth"]')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("gives a drawing that leans away less white than one that does not", async ({ page }) => {
  await openAssemble(page);
  await dropFolder(page, PILE);
  await expect(page.locator('[data-assemble-filled="yes"]')).toHaveCount(5);

  /* The stage reports the letter's two sidebearings and its advance. */
  const bearings = async (character: string): Promise<number[]> => {
    await page.locator(`[data-assemble-box="${character}"]`).click();
    await expect(page.locator(`[data-assemble-stage="${character}"]`)).toBeVisible();
    const text = (await page.locator("[data-assemble-stage] ~ p").innerText()).trim();
    const numbers = text.match(/-?\d+/g) ?? [];
    return numbers.slice(-3).map(Number);
  };

  const [flatLeft] = await bearings("H");
  const [leaningLeft] = await bearings("A");
  expect(leaningLeft).toBeLessThan(flatLeft);
});

test("takes a drawing whose name says nothing, once told what it is", async ({ page }) => {
  await openAssemble(page);
  await dropFolder(page, [
    ...PILE,
    { ...bar(400, 200), name: "logo-final-v3.svg" },
  ]);

  // It came in, it is in the list, and it is not in the font.
  await expect(page.locator("[data-assemble-trouble]")).toContainText("not placed");
  await expect(page.locator('[data-assemble-filled="yes"]')).toHaveCount(5);

  await page.locator('[data-assemble-map="logo-final-v3.svg"]').fill("E");
  await expect(page.locator('[data-assemble-filled="yes"]')).toHaveCount(6);
  await expect(page.locator('[data-assemble-box="E"]')).toHaveAttribute(
    "data-assemble-filled",
    "yes",
  );
  await expect(page.locator("[data-assemble-trouble]")).toHaveCount(0);
});

test("kerns the pair that leans apart and leaves the flat pair alone", async ({ page }) => {
  await openAssemble(page);
  await dropFolder(page, PILE);
  await expect(page.locator('[data-assemble-filled="yes"]')).toHaveCount(5);

  const kernOf = async (pair: string): Promise<number> => {
    await page.locator("[data-assemble-pair-input]").fill(pair);
    await expect(page.locator(`[data-assemble-pair="${pair}"]`)).toBeVisible();
    // Exact, or this also matches the "Kerning" strength slider above it.
    const slider = page.getByRole("slider", { name: "Kern", exact: true });
    return Number(await slider.getAttribute("aria-valuenow"));
  };

  // Two flat-sided bars are already right.
  expect(await kernOf("HI")).toBe(0);
  // So is a wedge beside a bar: the wedge's foot comes right up to it, and
  // where two letters already touch at their nearest point there is nothing
  // to take out.
  expect(await kernOf("AI")).toBe(0);
  // Two wedges leaning apart are the case kerning exists for -- the white
  // between them is wide at every row, the nearest included.
  expect(await kernOf("AV")).toBeLessThan(0);
  expect(await kernOf("VA")).toBeLessThan(0);
});

test("writes a real font out of the pile", async ({ page }) => {
  await openAssemble(page);
  await dropFolder(page, PILE);
  await expect(page.locator('[data-assemble-filled="yes"]')).toHaveCount(5);

  await page.getByRole("button", { name: "Export" }).click();
  await expect(page.getByRole("dialog", { name: "Download font" })).toBeVisible();

  const download = await Promise.race([
    page.waitForEvent("download", { timeout: 60_000 }),
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Download" })
      .click()
      .then(() => page.waitForEvent("download", { timeout: 60_000 })),
  ]);
  const bytes = readFileSync((await download.path())!);
  expect([...bytes.subarray(0, 4)]).toEqual([0, 1, 0, 0]);

  // The strongest check available in a browser: ask it to parse the file.
  const parsed = await page.evaluate(async (data) => {
    const face = new FontFace("Assembled", new Uint8Array(data).buffer as ArrayBuffer);
    await face.load();
    return face.status;
  }, [...bytes]);
  expect(parsed).toBe("loaded");
});

/**
 * The escape hatch, end to end.
 *
 * Download the letter, change it outside the application, put it back, and
 * check that what returns is the changed drawing sitting in the same slot --
 * then hand it back to the family and check the drawn letter returns.
 *
 * Worth doing in a browser rather than against the model, because the two
 * halves of this trip are a Blob download and a file input, and neither of
 * those exists anywhere the unit tests run.
 */
test("takes a letter out as SVG, changes it, and puts it back", async ({ page }) => {
  await openForge(page);
  await page.locator('[data-forge-cell="a"]').click();

  const drawn = () => page.locator('[data-forge-cell="a"] path').getAttribute("d");
  const before = await drawn();

  const download = await Promise.race([
    page.waitForEvent("download", { timeout: 30_000 }),
    page
      .locator('[data-forge-send-svg="a"]')
      .click()
      .then(() => page.waitForEvent("download", { timeout: 30_000 })),
  ]);
  expect(download.suggestedFilename()).toBe("a.svg");

  const sheet = readFileSync((await download.path())!, "utf8");
  expect(sheet).toContain('data-typeforge-name="a"');

  // Somebody has drawn something else. A triangle is enough: it is nothing
  // the recipes would ever produce, so seeing it on the stage proves the
  // drawing arrived rather than the letter being redrawn.
  const wedge = sheet.replace(
    /<path id="typeforge-ink"[^>]*\/>/,
    '<path id="typeforge-ink" data-typeforge="ink" d="M100 700 L400 700 L400 300 Z"/>',
  );
  expect(wedge).not.toBe(sheet);

  await page.setInputFiles('[data-forge-svg-input="a"]', {
    name: "a.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(wedge),
  });

  // The letter is the drawing now, the panel says so, and the alphabet marks it.
  await expect.poll(drawn).not.toBe(before);
  await expect(page.locator('[data-forge-imported="a"]')).toBeVisible();
  await expect(page.locator('[data-forge-outside="a"]')).toBeVisible();

  // And nothing in the panel reaches it: the family still moves, this does not.
  const weight = page.getByRole("slider", { name: "Weight" });
  await weight.focus();
  const wedged = await drawn();
  const otherBefore = await page.locator('[data-forge-cell="n"] path').getAttribute("d");
  for (let step = 0; step < 20; step++) await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => page.locator('[data-forge-cell="n"] path').getAttribute("d"))
    .not.toBe(otherBefore);
  expect(await drawn()).toBe(wedged);

  // Handing it back to the family draws it again.
  await page.locator('[data-forge-redraw="a"]').click();
  await expect(page.locator('[data-forge-imported="a"]')).toHaveCount(0);
  await expect.poll(drawn).not.toBe(wedged);
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

/**
 * Keeping the work.
 *
 * The two halves of this are not the same promise. A file is portable and
 * deliberate -- it answers "I want this on my other machine". Autosave is
 * neither, and answers the thing nobody plans for: the tab closed, the laptop
 * slept, the browser updated itself overnight. Only the second one can be
 * checked by reloading, and only the first can be checked by walking into a
 * browser that has never seen this person before, so both are here.
 */

/** The n in the alphabet, as its own outline. */
function drawnN(page: Page): Promise<string | null> {
  return page.locator('[data-forge-cell="n"] path').first().getAttribute("d");
}

/**
 * The session as the browser has it written down.
 *
 * Read out of IndexedDB rather than waited for with a timer, because the write
 * is on a pause after the last edit and a timer would either be flaky or be
 * slow. This asks the actual question -- is it kept yet.
 */
function keptHalves(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const request = indexedDB.open("typeforge", 1);
        request.onerror = () => resolve([]);
        request.onsuccess = () => {
          const database = request.result;
          const get = database.transaction("session", "readonly").objectStore("session").get("current");
          get.onerror = () => {
            database.close();
            resolve([]);
          };
          get.onsuccess = () => {
            database.close();
            const project = get.result as Record<string, unknown> | undefined;
            if (!project) {
              resolve([]);
              return;
            }
            resolve(["draw", "assemble", "edit"].filter((half) => project[half]));
          };
        };
      }),
  );
}

test("picks the drawing back up after the tab has been closed", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openForge(page);

  const plain = await drawnN(page);
  await page.locator('[data-forge-part="slab"]').getByRole("switch", { name: "Serifs" }).click();
  await expect.poll(() => drawnN(page)).not.toBe(plain);
  const serifed = await drawnN(page);

  // The toolbar says this browser is keeping things, which is what the rest of
  // the test rests on -- and what somebody is told when it is not.
  await expect(page.locator("[data-save-project]")).toHaveAttribute("data-keeping", "kept");
  await expect(page.locator('[data-keeping="off"]')).toHaveCount(0);
  await expect.poll(() => keptHalves(page)).toContain("draw");

  await page.reload();

  // Back in Draw, on the same letters, without anybody asking for either.
  await expect(page.locator("[data-forge-stage]")).toBeVisible();
  await expect.poll(() => drawnN(page)).toBe(serifed);
  await expect(
    page.locator('[data-forge-part="slab"]').getByRole("switch", { name: "Serifs" }),
  ).toHaveAttribute("aria-checked", "true");
  expect(errors).toEqual([]);
});

test("keeps an opened font and the letters changed in it", async ({ page }) => {
  await page.goto("/");
  await openFont(page);

  /*
   * An override on one glyph: the narrowest thing the format has to carry.
   *
   * A font is six thousand glyphs and the document keeps the touched ones, so
   * this is the case where the saving and the losing look identical until the
   * reload -- and it is the case that was actually broken, since setting an
   * override never marked the letter as touched at all.
   */
  await page.locator('[data-glyph-cell="A"]').click();
  const panel = page.getByRole("complementary", { name: "Parameters" });
  await panel.getByRole("button", { name: "Letter A", exact: true }).click();
  const weight = panel.getByRole("slider", { name: "Weight" });
  await weight.focus();
  for (let press = 0; press < 10; press++) await page.keyboard.press("ArrowRight");
  await expect(page.locator('[data-glyph-cell="A"]')).toHaveAttribute("data-glyph-changed", "yes");
  await expect.poll(() => keptHalves(page), { timeout: 30_000 }).toContain("edit");

  await page.reload();

  // The file is read again from its own bytes, so this takes as long as opening
  // it did -- but it comes back, and it comes back edited.
  await expect(page.getByText("DejaVu Sans", { exact: false }).first()).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.locator('[data-glyph-cell="A"]')).toHaveAttribute("data-glyph-changed", "yes");
});

test("saves the work to a file, and opens it in a browser that has never seen it", async ({
  page,
  browser,
}) => {
  await openForge(page);
  await page.locator('[data-forge-part="slab"]').getByRole("switch", { name: "Serifs" }).click();
  const serifed = await drawnN(page);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("[data-save-project]").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.typeforge$/);
  /*
   * Kept under a name that lies about it.
   *
   * One button takes both a font and a project, and which it is comes from the
   * file's first bytes rather than from what it is called -- so the harder case
   * is the one saved here: a project wearing a font's extension, which a check
   * on the name would open as a font and fail on.
   */
  const saved = join(tmpdir(), "not-really-a.ttf");
  await download.saveAs(saved);

  /*
   * A context of its own, which is the point.
   *
   * Nothing is kept in it and nothing is shared with the page above, so the
   * file is the only way the work can have travelled -- which is the claim a
   * Save button makes and the one that is worth checking.
   */
  const elsewhere = await browser.newContext();
  const other = await elsewhere.newPage();
  await other.goto("/");
  await other.getByRole("button", { name: "Draw" }).click();
  await settle(other);
  expect(await drawnN(other), "the fresh browser already had the work").not.toBe(serifed);

  const [chooser] = await Promise.all([
    other.waitForEvent("filechooser"),
    other.locator("[data-open-file]").click(),
  ]);
  await chooser.setFiles(saved);

  await expect.poll(() => drawnN(other)).toBe(serifed);
  await elsewhere.close();
});

test("carries the assembled drawings into the file too", async ({ page, browser }) => {
  await openAssemble(page);
  await fillBox(page, "A", { ...point(400), name: "A_.svg" });

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("[data-save-project]").click(),
  ]);
  const saved = join(tmpdir(), download.suggestedFilename());
  await download.saveAs(saved);

  const elsewhere = await browser.newContext();
  const other = await elsewhere.newPage();
  await other.goto("/");
  const [chooser] = await Promise.all([
    other.waitForEvent("filechooser"),
    other.locator("[data-open-file]").click(),
  ]);
  await chooser.setFiles(saved);

  // Opened straight into the half it was saved from, with the box still full.
  await expect(other.locator('[data-assemble-box="A"]')).toHaveAttribute(
    "data-assemble-filled",
    "yes",
  );
  await expect(other.locator('[data-assemble-filled="yes"]')).toHaveCount(1);
  await elsewhere.close();
});

/*
 * A file picker takes whatever it is pointed at.
 *
 * So a holiday photo, a package.json and a truncated download all arrive at
 * this button, and each has to be turned away with a sentence rather than
 * half-read over the top of somebody's afternoon. The sentence names both
 * things the button accepts, because by the time it is said the file is
 * neither, and "could not be read" would leave somebody guessing which of the
 * two they had meant to bring.
 */
test("turns away a file that is neither a font nor a project", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openForge(page);
  const before = await drawnN(page);

  for (const file of [
    { name: "holiday.json", mimeType: "application/json", buffer: Buffer.from('{"hello":"world"}') },
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not json at all") },
  ]) {
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.locator("[data-open-file]").click(),
    ]);
    await chooser.setFiles(file);
    await expect(
      page.getByText(`${file.name} is not a font or a Typeforge project.`),
    ).toBeVisible();
  }

  expect(await drawnN(page), "a refused file still changed the drawing").toBe(before);
  expect(errors).toEqual([]);
});

/*
 * The kept session is not a file somebody chose, so nobody is standing over it
 * when it goes wrong -- it is read on the way in, before anything is on screen.
 * A document that will not come back has to be a sentence and a working tool,
 * not a blank page, and it has to leave the next edit somewhere to go.
 */
test("comes up anyway when what was kept will not come back", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  // Loaded once so the database exists, then spoiled, then arrived at again --
  // which is the order it would happen in for real, a version at a time.
  await page.goto("/");
  await expect(page.locator("[data-save-project]")).toHaveAttribute("data-keeping", "kept");

  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("typeforge", 1);
        request.onerror = () => reject(new Error("no database"));
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("session", "readwrite");
          // Ours by every check the door makes, and unreadable behind it: the
          // font is not base64 and turning it back into bytes throws.
          transaction.objectStore("session").put(
            {
              typeforge: 1,
              saved: new Date().toISOString(),
              mode: "edit",
              edit: { fileName: "Broken.ttf", font: "not base64 !!!", glyphs: [] },
            },
            "current",
          );
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => {
            database.close();
            reject(new Error("could not write"));
          };
        };
      }),
  );

  await page.reload();
  await expect(page.getByText("Could not pick up where you left off.")).toBeVisible();

  // Working, and writing again, so the next thing done is not lost as well.
  await page.getByRole("button", { name: "Draw" }).click();
  await settle(page);
  await page.locator('[data-forge-part="slab"]').getByRole("switch", { name: "Serifs" }).click();
  await expect.poll(() => keptHalves(page)).toContain("draw");
  expect(errors).toEqual([]);
});

/**
 * The cast comes off the letters while the slider is moving and back on when it
 * stops.
 *
 * This is the whole of the bargain the draw page makes: putting a cut or a cast
 * on costs several milliseconds a letter and there are four hundred and
 * fifty-two letters, so while a hand is on a control they are left off, and the
 * moment it comes away they go back.
 *
 * Both halves are checked, against the letter as it is drawn with nothing on it
 * at all -- so "off" means the plain letter exactly and "on" means something
 * other than it, rather than either being whatever the page happened to show.
 */
test("takes the cast off while the slider moves and puts it back after", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openForge(page);

  const strip = page.locator('[data-forge-cell="n"] path');
  const stage = page.locator("[data-forge-stage] path").first();
  const plain = { stage: await stage.getAttribute("d"), strip: await strip.getAttribute("d") };

  // Fillets: ink piled into every corner, which every letter with a join has.
  await page.locator('[data-cut-switch="weld"]').scrollIntoViewIfNeeded();
  await page.locator('[data-cut-switch="weld"]').click();
  const slider = page.locator('[data-cut-control="weld:size"] [data-slot="slider"]').first();
  await expect(slider).toBeVisible();
  await slider.scrollIntoViewIfNeeded();

  const box = (await slider.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.05, y);
  await page.mouse.down();
  for (let step = 1; step <= 4; step++) {
    await page.mouse.move(box.x + box.width * (0.05 + 0.1 * step), y);
  }

  // Still under the hand: the plain letter, whatever the fillet is set to.
  await expect.poll(() => stage.getAttribute("d"), { timeout: 60_000 }).toBe(plain.stage);

  await page.mouse.up();
  await expect.poll(() => stage.getAttribute("d"), { timeout: 60_000 }).not.toBe(plain.stage);
  await expect.poll(() => strip.getAttribute("d"), { timeout: 60_000 }).not.toBe(plain.strip);
  expect(errors).toEqual([]);
});

/**
 * The strip draws the letters somebody can see, and the rest when they scroll
 * to them.
 *
 * Four hundred and fifty-two letters is more than a screen holds and far more
 * than is worth drawing, so the ones nobody has scrolled to are left as empty
 * boxes until they come near. That is only a saving if they fill in -- a letter
 * that stays blank is a letter missing from the font as far as anybody looking
 * at this page can tell.
 */
test("fills in the letters at the bottom of the strip when they are scrolled to", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openForge(page);

  const cells = page.locator("[data-forge-cell]");
  const total = await cells.count();
  expect(total).toBeGreaterThan(300);

  const last = cells.nth(total - 1);
  const name = await last.getAttribute("data-forge-cell");
  await last.scrollIntoViewIfNeeded();
  await expect
    .poll(() => page.locator(`[data-forge-cell="${name}"] path`).getAttribute("d"))
    .not.toBe("");
  expect(errors).toEqual([]);
});

test("the glyph grid fills the width it is given, at any width", async ({ page }) => {
  /*
   * The grid measured itself from an effect that ran once, before the grid
   * existed, and never again -- so the column count stayed at the eight it was
   * initialised with on every window size. Two faults came out of that one
   * line. Density got *worse* on a larger monitor, because eight columns of a
   * wider window is eight bigger cells rather than more letters. And on a
   * narrow one the cells were squeezed below the fixed size their canvases are
   * drawn at, so the letters overflowed and drew across their neighbours.
   *
   * Checked as a relationship rather than against fixed numbers: what has to
   * hold is that a wider window shows more letters and that a letter never
   * draws wider than the cell it sits in. Pinning the counts themselves would
   * fail the day the cell size is changed for a good reason.
   */
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  await openFont(page);

  const cells = () => page.locator("[data-glyph-cell]");
  const countWide = await cells().count();

  await page.setViewportSize({ width: 900, height: 900 });
  await page.waitForTimeout(600);
  const countNarrow = await cells().count();

  expect(countWide, "a wider window showed no more letters than a narrow one").toBeGreaterThan(
    countNarrow,
  );

  /*
   * And nothing draws outside its cell. Measured on the letters actually on
   * screen at the narrow width, which is where the overflow showed.
   */
  const spilling = await page.evaluate(() => {
    const out: string[] = [];
    for (const cell of document.querySelectorAll("[data-glyph-cell]")) {
      const canvas = cell.querySelector("canvas");
      if (!canvas) continue;
      const inner = canvas.getBoundingClientRect();
      const outer = cell.getBoundingClientRect();
      // A pixel of tolerance for sub-pixel layout rounding.
      if (inner.width > outer.width + 1) out.push(cell.getAttribute("data-glyph-cell") ?? "?");
    }
    return out;
  });
  expect(spilling, "letters drawn wider than the cell they sit in").toEqual([]);
});

test("help can be searched and jumped around, not only scrolled", async ({ page }) => {
  /*
   * Twenty sections of prose in one scrolling column is a document rather than
   * help. Somebody arrives with a question -- what does bounce do, why is my
   * export dropping ligatures -- and the only way to answer it was to read past
   * everything else. What was missing was not more writing but a way in.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Help", exact: true }).click();
  const help = page.getByRole("dialog", { name: "Help" });
  await expect(help).toBeVisible();

  // A contents page, built from the sections themselves rather than kept as a
  // second list beside them.
  const contents = help.locator("[data-help-contents]");
  const all = await help.locator("[data-help-section]").count();
  expect(all).toBeGreaterThan(10);
  expect(await contents.count()).toBe(all);

  // Searching narrows to the sections that mention it, matching the prose and
  // not only the headings.
  await help.locator("[data-help-search]").fill("kerning");
  await expect.poll(() => help.locator("[data-help-section]").count()).toBeLessThan(all);
  await expect.poll(() => help.locator("[data-help-section]").count()).toBeGreaterThan(0);

  // And a search that matches nothing says so, rather than showing an empty
  // column under a search box.
  await help.locator("[data-help-search]").fill("zzzznothing");
  await expect(help.locator("[data-help-empty]")).toBeVisible();

  // Cleared, everything comes back.
  await help.locator("[data-help-search]").fill("");
  await expect.poll(() => help.locator("[data-help-section]").count()).toBe(all);
});

test("shows the letters either side, and lets the numbers be typed", async ({ page }) => {
  /*
   * Two absences a designer meets in their first hour.
   *
   * A sidebearing cannot be judged on a letter by itself: the gap to the left
   * of an `n` means nothing until there is something to its left. And a point
   * could be dragged and nothing else, so moving a stem three units sideways
   * was not possible -- you could get close by eye at a high zoom and never
   * land on a number.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();

  const numbers = page.locator("[data-glyph-numbers]");
  await expect(numbers).toBeVisible();

  /*
   * Judged on the ink rather than on the fields, because what was missing was
   * the drawing. The canvas is compared with itself: more of it is painted
   * once there are letters either side, and both sides are asked for
   * separately so an asymmetric pair can be checked.
   */
  const inkOf = async () =>
    page.locator("canvas").first().evaluate((canvas) => {
      const context = (canvas as HTMLCanvasElement).getContext("2d");
      if (!context) return 0;
      const { data } = context.getImageData(0, 0, (canvas as HTMLCanvasElement).width, (canvas as HTMLCanvasElement).height);
      let lit = 0;
      for (let index = 3; index < data.length; index += 4 * 16) if (data[index] > 8) lit++;
      return lit;
    });

  await page.locator("[data-context-before]").fill("HO");
  await page.locator("[data-context-after]").fill("no");
  await page.waitForTimeout(400);
  const withContext = await inkOf();

  await page.locator("[data-context-before]").fill("");
  await page.locator("[data-context-after]").fill("");
  await page.waitForTimeout(400);
  const alone = await inkOf();
  expect(withContext, "the neighbours drew nothing").toBeGreaterThan(alone);

  /*
   * And the numbers. The sidebearing is the honest one to check without
   * hunting for a node on a canvas: changing the left one slides the outline
   * and widens the advance to match, so the right-hand space is untouched.
   */
  const advance = page.getByLabel("Advance width");
  const left = page.getByLabel("Left sidebearing");
  const right = page.getByLabel("Right sidebearing");
  const wasAdvance = Number(await advance.inputValue());
  const wasLeft = Number(await left.inputValue());
  const wasRight = Number(await right.inputValue());

  await left.fill(String(wasLeft + 84));
  await left.press("Enter");
  await expect.poll(async () => Number(await advance.inputValue())).toBe(wasAdvance + 84);
  expect(Number(await left.inputValue())).toBe(wasLeft + 84);
  expect(Number(await right.inputValue()), "the right-hand space moved").toBe(wasRight);

  // Committed as one undoable edit rather than one per keystroke.
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
});

test("lists the paths a letter is made of, and takes guides", async ({ page }) => {
  /*
   * Two things a glyph did not say about itself.
   *
   * Which contour a point belonged to, how many there were, which way round
   * each ran and what order they came in were all facts the letter kept to
   * itself -- and two of them are correctness rather than convenience.
   * Direction decides whether a contour fills or cuts a hole in the one around
   * it, so a counter drawn the same way round as its bowl fills solid, and the
   * only way to find that out was to export the font and look at it elsewhere.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();

  // Reachable without hunting: opening a letter puts the panel on that letter.
  const rows = page.locator("[data-path-row]");
  await expect.poll(() => rows.count()).toBeGreaterThan(1);

  // Clicking a row selects that whole contour on the canvas, so the list and
  // the drawing agree about what is in hand.
  const points = await rows.first().getByRole("button").first().innerText();
  await rows.first().getByRole("button").first().click();
  await expect(page.locator("[data-glyph-numbers]")).toContainText("points selected");
  expect(points).toContain("points");

  // Reversing is an undoable edit rather than a display toggle.
  await page.locator('[aria-label="Reverse path 1"]').click();
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();

  /*
   * Guides. Placed at the height the view is looking at and then dragged, which
   * is the part that makes them useful -- and they belong to the font, so the
   * count survives moving to another letter.
   */
  await page.locator("[data-add-guide]").click();
  await expect(page.locator("[data-clear-guides]")).toContainText("Clear 1");

  const canvas = page.locator("canvas").first();
  const box = (await canvas.boundingBox())!;
  const at = box.y + box.height * 0.5;
  await page.mouse.move(box.x + 700, at);
  await page.mouse.down();
  await page.mouse.move(box.x + 700, at - 140, { steps: 10 });
  await page.mouse.up();

  // Still one guide after the drag: it moved rather than a second appearing.
  await expect(page.locator("[data-clear-guides]")).toContainText("Clear 1");

  // A guide is the font's, not the letter's, so it is still there next door.
  await page.getByRole("button", { name: "Font", exact: true }).click();
  await page.getByRole("button", { name: "Glyph", exact: true }).click();
  await expect(page.locator("[data-clear-guides]")).toContainText("Clear 1");

  await page.locator("[data-clear-guides]").click();
  await expect(page.locator("[data-clear-guides]")).toHaveCount(0);
});

/**
 * The colour actually on the canvas, averaged over the pixels that were
 * painted.
 *
 * Not the token, and not the CSS: the pixels. The bug this exists to catch was
 * a canvas that read the right token at the wrong moment, so every declared
 * value in the document was correct and the letters were still the old colour.
 * Nothing short of reading the bitmap would have noticed.
 */
async function inkLuminance(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector("[data-proof-page] canvas") as HTMLCanvasElement;
    const context = canvas.getContext("2d")!;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0;
    let painted = 0;
    // Solid pixels only. The edge of a letter is antialiased against nothing,
    // so a part-transparent pixel carries the colour diluted and would drag
    // the average towards the middle from both ends.
    for (let at = 0; at < data.length; at += 4) {
      if (data[at + 3] < 250) continue;
      sum += 0.2126 * data[at] + 0.7152 * data[at + 1] + 0.0722 * data[at + 2];
      painted += 1;
    }
    return painted === 0 ? -1 : sum / painted;
  });
}

test("proofs the font in paragraphs, on either ground", async ({ page }) => {
  /*
   * A face is judged in paragraphs, and there was nowhere to see one.
   *
   * Every view here showed letters one at a time or in a grid of boxes, which
   * is how you fix a letter and not how you tell whether a font works: a stem
   * a shade too heavy reads as a grey patch in text and as nothing at all on a
   * canvas. This draws the outlines on screen -- not an installed font -- into
   * a column of real text, at a size and a leading you can push around.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Proof", exact: true }).click();

  const pageBox = page.locator("[data-proof-page]");
  await expect(pageBox).toBeVisible();

  // Something was actually drawn.
  await expect.poll(() => inkLuminance(page)).toBeGreaterThan(0);

  /*
   * The type stays inside the page it is drawn on.
   *
   * The first version measured the padded parent and drew as though it were
   * the content box, which put the canvas forty-eight pixels wider than the
   * white underneath it and clipped the right-hand end of every line.
   */
  const widths = await pageBox.evaluate((element) => ({
    page: element.clientWidth,
    canvas: (element.querySelector("canvas") as HTMLCanvasElement).clientWidth,
  }));
  expect(widths.canvas).toBeLessThanOrEqual(widths.page);

  // Bigger type is more lines of it, and the page grows to hold them.
  const shortPage = (await pageBox.boundingBox())!.height;
  const size = page.getByRole("slider", { name: "Size" });
  await size.fill("28");
  await expect.poll(async () => (await pageBox.boundingBox())!.height).toBeGreaterThan(shortPage);
  await size.fill("14");

  /*
   * The ground, and the only assertion here that reads pixels rather than the
   * document.
   *
   * The canvases are painted in script and take their colour from a custom
   * property on the root, so switching the ground is two things happening in
   * order: the attribute changes, and every canvas repaints having read it.
   * They went out of order -- effects run child before parent, so the canvas
   * repainted first and read a root that still said dark -- and the result was
   * near-white letters on the new white page, with every token in the document
   * reporting the correct value. Hence the luminance: the token was never
   * wrong, only early.
   */
  const onDark = await inkLuminance(page);
  await page.locator("[data-ground-toggle]").getByRole("button", { name: "On white" }).click();
  await expect.poll(() => inkLuminance(page)).toBeLessThan(onDark - 100);

  await page.locator("[data-ground-toggle]").getByRole("button", { name: "On black" }).click();
  await expect.poll(() => inkLuminance(page)).toBeGreaterThan(onDark - 20);
});

test("carries the ground into the letter being drawn", async ({ page }) => {
  // The ground is the application's, not the proof page's: a letter is judged
  // against white too, and the choice should not have to be made twice.
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Proof", exact: true }).click();
  await page.locator("[data-ground-toggle]").getByRole("button", { name: "On white" }).click();

  await page.getByRole("button", { name: "Glyph", exact: true }).click();
  const toggle = page.locator("[data-ground-toggle]").getByRole("button", { name: "On white" });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  /*
   * And carries it no further than that.
   *
   * The ground is declared on the stage rather than on the document, so the
   * letters a few pixels to the right in the inspector and the grid one tab
   * over keep the colours they were drawn for. The first version put it on
   * the root, which took `--canvas` with it everywhere it was used -- and it
   * is used as a darker panel in two views that carry ordinary white chrome
   * text, so the Draw stage and the Assemble empty state came up with their
   * headings white on white.
   */
  await expect(page.locator("[data-ground='light']")).toHaveCount(1);
  await expect(page.locator("html")).not.toHaveAttribute("data-ground", "light");
});

test("the side panel is about the view it is in", async ({ page }) => {
  /*
   * Corner radius, Weight and Middle space used to sit on screen while you
   * kerned a pair or read a fault report -- three hundred pixels of controls
   * that reach nothing you are looking at, taken off the thing you are.
   */
  await page.goto("/");
  await openFont(page);
  const parameters = page.getByRole("complementary", { name: "Parameters" });

  // The grid is about the typeface, so the parameters are the subject.
  await expect(parameters).toBeVisible();

  /*
   * Kerning already has a panel of its own about the pairs, so the parameters
   * were a third column and the canvas was the one paying for it. Measured
   * rather than asserted by eye: the canvas is wider than it was.
   */
  await page.getByRole("button", { name: "Kerning", exact: true }).click();
  await expect(parameters).toHaveCount(0);
  const kerningCanvas = (await page.locator("canvas").first().boundingBox())!;
  const viewport = page.viewportSize()!;
  // Everything but the pairs list, give or take the border.
  expect(kerningCanvas.width).toBeGreaterThan(viewport.width - 320);

  // Checks holds its findings in the view, so a panel out here could say
  // nothing about them; what it needed was a way to narrow the list.
  await page.getByRole("button", { name: "Checks", exact: true }).click();
  await expect(parameters).toHaveCount(0);

  // The spacing table is about one letter at a time, and the panel follows the
  // row you click rather than staying on the family.
  await page.getByRole("button", { name: "Spacing", exact: true }).click();
  await expect(parameters).toBeVisible();
  const row = page.locator("tbody tr, [data-spacing-row]").nth(4);
  const name = await row.locator("td").nth(1).innerText();
  await row.click();
  await expect(
    parameters.getByRole("button", { name: `Letter ${name}`, exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  // But not the paths: which way a contour runs is a fact about the drawing,
  // and a column of sidebearings is not the place to be told it.
  await expect(page.locator("[data-paths-panel]")).toHaveCount(0);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();
  await expect(page.locator("[data-paths-panel]")).toBeVisible();
});

test("the check counts put their findings away", async ({ page }) => {
  /*
   * A report is read by severity: you fix the errors, decide about the
   * warnings, and the notes are mostly things you already know. The three
   * numbers were on screen and did nothing, which wasted the one control the
   * list needed.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Checks", exact: true }).click();

  const findings = page.locator("[data-finding]");
  await expect.poll(() => findings.count(), { timeout: 60_000 }).toBeGreaterThan(1);
  const all = await findings.count();

  const notes = page.locator('[data-severity="info"]');
  await expect(notes).toHaveAttribute("aria-pressed", "true");
  await notes.click();
  await expect(notes).toHaveAttribute("aria-pressed", "false");

  const fewer = await findings.count();
  expect(fewer).toBeLessThan(all);
  // What is left is what was not put away.
  await expect(page.locator('[data-finding="info"]')).toHaveCount(0);

  await notes.click();
  await expect.poll(() => findings.count()).toBe(all);
});

test("the glyph grid is grouped and counted, as the other grid is", async ({ page }) => {
  /*
   * The two grids in this product used to give opposite answers to the same
   * question. Assemble laid its boxes out in named groups with a count each and
   * read beautifully; the font grid was one flat run of six thousand cells in
   * codepoint order, which is the order the file stores them in and nobody's
   * order for looking at them. It opened on `.notdef`, `.null` and
   * `nonmarkingreturn`.
   */
  await page.goto("/");
  await openFont(page);

  const headings = page.locator("[data-glyph-group]");
  // What you came for is what you land on.
  await expect(headings.first()).toHaveAttribute("data-glyph-group", "Capitals");
  await expect(headings.first()).toContainText("26");
  await expect(page.locator('[data-glyph-group="Lowercase"]')).toContainText("26");

  // Further down, which needs a scroll: only what is on screen is mounted, and
  // a heading below the fold does not exist yet.
  const scroller = page.locator("[data-glyph-cell]").first().locator("xpath=../../..");
  await scroller.evaluate((element) => element.scrollTo(0, 700));
  await expect(page.locator('[data-glyph-group="Figures"]')).toContainText("10");
  await scroller.evaluate((element) => element.scrollTo(0, 0));

  /*
   * The scroll arithmetic, which grouping is what made interesting: rows are no
   * longer all one height, so finding the first one on screen is a walk over
   * accumulated offsets rather than a division. A long way down is where an
   * error in that shows up.
   */
  await scroller.evaluate((element) => element.scrollTo(0, 12_000));
  await page.waitForTimeout(400);
  await expect(page.locator("[data-glyph-cell]").first()).toBeVisible();
  // Cells and their heading agree about where they are: no cell is drawn on
  // top of a heading, which is what a wrong offset looks like.
  const overlap = await page.evaluate(() => {
    const heads = [...document.querySelectorAll("[data-glyph-group]")];
    const cells = [...document.querySelectorAll("[data-glyph-cell]")];
    return heads.some((head) => {
      const a = head.getBoundingClientRect();
      return cells.some((cell) => {
        const b = cell.getBoundingClientRect();
        return a.top < b.bottom - 2 && b.top < a.bottom - 2;
      });
    });
  });
  expect(overlap).toBe(false);

  // Filtering keeps the grouping, and the count is then the answer to what you
  // typed. Groups the filter emptied are gone rather than shown at zero.
  await page.getByLabel("Search glyphs").fill("alpha");
  await expect.poll(() => headings.count()).toBeGreaterThan(0);
  await expect(page.locator('[data-glyph-group="Figures"]')).toHaveCount(0);
});

test("the glyph grid takes the columns the window gives it", async ({ page }) => {
  /*
   * It sat at the eight columns it was initialised with on every window, which
   * meant density got worse on a bigger monitor. The measurement was through an
   * effect that took an early exit on the first render and, having no
   * dependencies, never ran again.
   */
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await openFont(page);

  const columnsNow = async () =>
    page.evaluate(() => {
      const cells = [...document.querySelectorAll("[data-glyph-cell]")];
      const top = cells[0]?.getBoundingClientRect().top;
      return cells.filter((cell) => Math.abs(cell.getBoundingClientRect().top - top!) < 2).length;
    });

  const wide = await columnsNow();
  await page.setViewportSize({ width: 820, height: 900 });
  await expect.poll(columnsNow).toBeLessThan(wide);
});

test("the toolbar wraps into rows rather than into a gap", async ({ page }) => {
  /*
   * Below about twelve hundred pixels the toolbar is longer than the window and
   * wraps, which is the right answer -- a flex row that will not wrap puts
   * Export past the right-hand edge where nothing can reach it. What was wrong
   * was the second line: an auto margin held the right-hand group over there,
   * and an auto margin does its job on whatever line the item lands on, so once
   * the group wrapped it sat alone against the right with the whole width of
   * the window empty beside it.
   */
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto("/");
  await openFont(page);

  const bar = page.getByRole("banner");
  const wordmark = page.getByText("Typeforge", { exact: true });
  const exportButton = page.getByRole("button", { name: "Export", exact: true });

  const [first, last] = await Promise.all([
    wordmark.boundingBox(),
    exportButton.boundingBox(),
  ]);
  // It has genuinely wrapped at this width, or this test is proving nothing.
  expect(last!.y).toBeGreaterThan(first!.y + 10);

  // And the wrapped row starts where a row starts, rather than being pushed to
  // the far side of an empty line.
  const barBox = (await bar.boundingBox())!;
  const secondRowLeft = Math.min(
    ...(await page.evaluate(() => {
      const header = document.querySelector("header")!;
      const bottom = header.getBoundingClientRect().bottom;
      return [...header.querySelectorAll("button, span")]
        .map((element) => element.getBoundingClientRect())
        .filter((box) => box.width > 0 && box.bottom > bottom - 24)
        .map((box) => box.left);
    })),
  );
  expect(secondRowLeft - barBox.x).toBeLessThan(24);

  // Nothing over the side, at any width somebody might use.
  for (const width of [1440, 1280, 1100, 900]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(exportButton).toBeInViewport();
    const spill = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(spill, `the page scrolls sideways at ${width}`).toBe(false);
  }
});

test("the side panels give width back on a smaller window", async ({ page }) => {
  /*
   * Every panel was a fixed number of pixels beside a canvas that took what was
   * left, and there was not a breakpoint in the application's own code -- so
   * the canvas paid the whole cost of a smaller window and the parameters were
   * more than a third of a thirteen-inch screen.
   */
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await openFont(page);

  const parameters = page.getByRole("complementary", { name: "Parameters" });
  const wide = (await parameters.boundingBox())!.width;

  await page.setViewportSize({ width: 900, height: 900 });
  await expect.poll(async () => (await parameters.boundingBox())!.width).toBeLessThan(wide);

  // Narrower, but never so narrow that the controls in it stop working.
  expect((await parameters.boundingBox())!.width).toBeGreaterThan(200);
});

test("the scope tabs say they are scopes, and do not rename the letter", async ({ page }) => {
  /*
   * The middle tab was labelled with the glyph's name and nothing else, so the
   * three read `Family`, `A`, `Build`: two scopes and a letter, with nothing to
   * say the letter was a tab rather than a readout of what is selected. That is
   * how the paths list came to be shipped somewhere nobody would press.
   */
  await page.goto("/");
  await openFont(page);
  const scopes = page.getByRole("group", { name: "Inspector scope" });

  await page.getByRole("button", { name: "Glyph", exact: true }).click();
  await expect(scopes.getByRole("button", { name: /^Letter/ })).toBeVisible();
  await expect(scopes.getByRole("button", { name: "Family" })).toBeVisible();
  await expect(scopes.getByRole("button", { name: "Build" })).toBeVisible();

  /*
   * And the letter keeps its own name. The tab was capitalised as a whole,
   * which reached the glyph name too -- so `a` announced itself as `A` and
   * `eacute` as `Eacute`. Glyph names are case-sensitive, and this is the one
   * place in the application that tells you which letter you have.
   */
  await page.getByRole("button", { name: "Font", exact: true }).click();
  await page.getByLabel("Search glyphs").fill("a");
  await page.locator('[data-glyph-cell="a"]').dblclick();
  await expect(scopes.getByRole("button", { name: "Letter a", exact: true })).toBeVisible();
});

test("one word for writing a font out, in every mode", async ({ page }) => {
  // One line of code gave the same button two names: Export in the edit mode
  // and Download in the other three. Both write a font file.
  await page.goto("/");
  await openFont(page);

  for (const mode of ["Edit", "Draw", "Assemble", "Trace"]) {
    await page.getByRole("button", { name: mode, exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Export", exact: true }),
      `the ${mode} mode calls it something else`,
    ).toBeVisible();
  }

  // The dialog it opens says Download, because that is the click where a file
  // really is handed to the browser -- and all four of them now say it.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByRole("button", { name: "Download", exact: true })).toBeVisible();
});

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

  await page.locator("[data-path-actions]").getByRole("button", { name: "Correct direction" }).click();
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
  await expect(panel.getByRole("button", { name: "Smooth" })).toBeDisabled();
  // Exact, because "Open corner" carries the word too.
  await expect(panel.getByRole("button", { name: "Corner", exact: true })).toBeDisabled();
  // These two are about a specific corner and a specific pair.
  await expect(panel.getByRole("button", { name: "Open corner" })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Reconnect" })).toBeDisabled();

  // Picking a whole path picks all of its points: enough for the first two,
  // and too many for the corner pair.
  await page.locator('[data-path-row="0"]').getByRole("button").first().click();
  await expect(page.locator("[data-points-scope]")).toContainText("points");
  await expect(panel.getByRole("button", { name: "Smooth" })).toBeEnabled();
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

  const tidy = page.locator("[data-points-panel]").getByRole("button", { name: /Tidy up|Nothing to tidy/ });
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

  const tools = page.getByRole("group", { name: "Tool" });
  const canvas = page.locator("canvas").first();
  const area = (await canvas.boundingBox())!;
  const paths = page.locator("[data-paths-panel]");
  const before = await paths.innerText();

  await tools.getByRole("button", { name: "Rectangle" }).click();
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

  await tools.getByRole("button", { name: "Knife" }).click();
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

  const tools = page.getByRole("group", { name: "Tool" });
  await page.keyboard.press("k");
  await expect(tools.getByRole("button", { name: "Knife" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("o");
  await expect(tools.getByRole("button", { name: "Ellipse" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("v");
  await expect(tools.getByRole("button", { name: "Select" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
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
   * every time a slider moves -- so the point tools cannot live in it: a
   * dragged node would be undone by the next parameter change.
   *
   * The engine already knew how to build a real typeface, because that is what
   * its export dialog does. Until now that typeface only ever went into a
   * file, so the only way to move a point on a letter you had drawn was to
   * export it and open the file you had just written.
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

test("the checks say when an edited font still wears the name it arrived with", async ({ page }) => {
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

test("the pencil draws freehand, and the line becomes an outline", async ({ page }) => {
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

  await page.getByRole("group", { name: "Tool" }).getByRole("button", { name: "Pencil" }).click();
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
  await expect(panel.getByText("None yet.").first()).toBeVisible();

  /*
   * The standard ones, offered rather than typed -- and only the ones whose
   * letters this font has, so `ffl` is not offered to a face with no `l`.
   */
  const offer = panel.locator("[data-make-ligature]").first();
  await expect(offer).toBeVisible();
  await offer.click();

  await expect(page.getByText("now draws as", { exact: false })).toBeVisible();
  await expect(panel.locator("[data-ligature]")).toHaveCount(1);

  // And it comes back out, leaving the drawing where it was.
  const before = await page.locator("[data-glyph-numbers]").count();
  await panel.locator("[data-ligature]").first().getByRole("button", { name: "Undo" }).click();
  await expect(panel.locator("[data-ligature]")).toHaveCount(0);
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
  // DejaVu draws `fi`, so it is offered under that name and without "new".
  const existing = panel.locator("[data-make-ligature='fi']");
  await expect(existing).toBeVisible();
  await expect(existing).not.toContainText("new");

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

test("a font brought in from a file is not accused of dead letters", async ({ page }) => {
  /*
   * A check that is wrong about a correct font is worse than no check. An
   * imported font brings its own GSUB -- ligatures, positional forms, the lot
   * -- which this document does not model and the exporter hands back
   * untouched, so its glyphs are reached through tables nothing here can see.
   * Counting them reported two hundred and sixty-five dead letters in DejaVu
   * Sans: Arabic initial and final forms, every one of them fine.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Checks", exact: true }).click();
  await page.getByRole("button", { name: "Run checks", exact: true }).click();
  await expect(page.getByText(/glyphs checked/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("drawn but nothing can reach", { exact: false })).toHaveCount(0);
});

test("the proof sets the joined letters, and can be asked not to", async ({ page }) => {
  /*
   * A proof laid out character by character shows a font nobody will ever see:
   * every ligature in it sitting unused while the letters it replaces are set
   * side by side. And the switch matters as much as the substitution -- what a
   * ligature is *for* is the collision it takes out, and the only way to judge
   * the joined drawing is against the pair standing beside it.
   *
   * Proved by ink rather than by eye. A ligature whose drawing this font has
   * not got is made empty, so where it fires the letters vanish: fewer pixels
   * covered with it on than with it off, which no amount of anti-aliasing
   * explains away.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();
  await page
    .getByRole("group", { name: "Inspector scope" })
    .getByRole("button", { name: "build" })
    .click();

  await page.getByLabel("Letters to join").fill("t h");
  await page.getByRole("button", { name: "Join", exact: true }).click();
  await expect(page.getByText("t h now draws as t_h", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Proof", exact: true }).click();
  await page.locator("textarea").first().fill("the thin the other the thing");
  await page.waitForTimeout(700);

  const joined = await measureInk(page);
  await page.locator("[data-proof-ligatures]").click();
  await page.waitForTimeout(700);
  const separate = await measureInk(page);

  expect(separate).toBeGreaterThan(joined);
});

test("the ligature switch stays away until the font has one", async ({ page }) => {
  // A switch that changes nothing is furniture.
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Proof", exact: true }).click();
  await expect(page.locator("[data-proof-ligatures]")).toHaveCount(0);
});
