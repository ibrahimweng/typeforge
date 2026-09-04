/**
 * Draw: pulling the letter about by its handles, and the specimen.
 *
 * Split out of editor.spec.ts, which had reached a hundred and forty tests
 * across five thousand lines. What these files share is in support.ts.
 */

import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { FONT_PATH, dragHandle, openForge, pressSpot, settle } from "./support";

test.skip(!FONT_PATH, "needs a system font to open");

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
    (
      await page
        .locator("[data-forge-handle]")
        .evaluateAll((nodes) =>
          nodes.map((node) => (node as HTMLElement).dataset.forgeHandle ?? ""),
        )
    ).sort();

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
  const outline = () => page.locator('[data-forge-cell="n"] path').getAttribute("d");
  /*
   * The letter as it is drawn without the grid, read before the switch is
   * thrown.
   *
   * Waiting on [data-forge-cells] waits for the grid's editor to appear, and
   * that happens before the alphabet has been redrawn out of cells. Read at
   * that moment, `laid` was sometimes still the skeleton -- and clearing the
   * grid puts the letter back to its skeleton, so the poll below was waiting
   * for a change that had already been and gone. Waiting for the outline to
   * stop being the skeleton is waiting for the thing the name `laid` claims.
   */
  await expect(page.locator('[data-forge-cell="n"] path')).toBeVisible();
  const skeleton = await outline();
  await panel.getByRole("switch", { name: "Build on a grid" }).click();
  await expect(page.locator("[data-forge-cells]")).toBeVisible();
  await expect.poll(outline).not.toBe(skeleton);
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
  // Start from an empty letter, so what appears can only be what was stamped.
  const outline = () => page.locator('[data-forge-cell="n"] path').getAttribute("d");
  /*
   * The letter as it is drawn without the grid, read before the switch is
   * thrown.
   *
   * Waiting on [data-forge-cells] waits for the grid's editor to appear, and
   * that happens before the alphabet has been redrawn out of cells. Read at
   * that moment, `laid` was sometimes still the skeleton -- and clearing the
   * grid puts the letter back to its skeleton, so the poll below was waiting
   * for a change that had already been and gone. Waiting for the outline to
   * stop being the skeleton is waiting for the thing the name `laid` claims.
   */
  await expect(page.locator('[data-forge-cell="n"] path')).toBeVisible();
  const skeleton = await outline();
  await panel.getByRole("switch", { name: "Build on a grid" }).click();
  await expect(page.locator("[data-forge-cells]")).toBeVisible();
  await expect.poll(outline).not.toBe(skeleton);
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
