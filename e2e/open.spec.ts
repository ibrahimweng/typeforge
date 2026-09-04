/**
 * Opening a font, filling the grid, and writing one back out.
 *
 * Split out of editor.spec.ts, which had reached a hundred and forty tests
 * across five thousand lines. What these files share is in support.ts.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { FONT_PATH, measureInk, openFont } from "./support";

test.skip(!FONT_PATH, "needs a system font to open");

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
  await expect(page.getByText("Make a typeface")).toBeVisible();
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
  await page
    .getByRole("button", { name: /^aacute|^á/ })
    .first()
    .dblclick();
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

  await page.getByRole("button", { name: "Export", exact: true }).click();
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
  const loaded = await page.evaluate(
    async (data) => {
      const face = new FontFace("TypeforgeExport", new Uint8Array(data).buffer);
      try {
        await face.load();
        return true;
      } catch {
        return false;
      }
    },
    [...bytes],
  );
  expect(loaded).toBe(true);
});
