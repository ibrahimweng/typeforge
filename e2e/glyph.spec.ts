/**
 * The glyph editor: the canvas, the panels, and the tools on it.
 *
 * Split out of editor.spec.ts, which had reached a hundred and forty tests
 * across five thousand lines. What these files share is in support.ts.
 */

import { expect, test } from "@playwright/test";

import {
  FONT_PATH,
  drawnN,
  fillBox,
  keptHalves,
  openAssemble,
  openFont,
  openForge,
  point,
  settle,
} from "./support";

test.skip(!FONT_PATH, "needs a system font to open");

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
  /*
   * Wait for the serifs to be drawn before reading the letter.
   *
   * The switch returns before the alphabet is redrawn, so reading the `n`
   * straight after the click can return the letter as it was. Nothing later
   * catches that: the file then holds a plain `n`, the fresh browser draws a
   * plain `n` of its own, the two agree, and the test fails on the line that
   * says the fresh browser should not already have the work -- pointing at the
   * browser rather than at the read. Wait for the redraw, as the test above
   * does.
   */
  const plain = await drawnN(page);
  await page.locator('[data-forge-part="slab"]').getByRole("switch", { name: "Serifs" }).click();
  await expect.poll(() => drawnN(page)).not.toBe(plain);
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
  const saved = test.info().outputPath("not-really-a.ttf");
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
  await other.getByRole("button", { name: "Draw", exact: true }).click();
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
  const saved = test.info().outputPath(download.suggestedFilename());
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
    {
      name: "holiday.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"hello":"world"}'),
    },
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
  await page.getByRole("button", { name: "Draw", exact: true }).click();
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
    page
      .locator("canvas")
      .first()
      .evaluate((canvas) => {
        const context = (canvas as HTMLCanvasElement).getContext("2d");
        if (!context) return 0;
        const { data } = context.getImageData(
          0,
          0,
          (canvas as HTMLCanvasElement).width,
          (canvas as HTMLCanvasElement).height,
        );
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
