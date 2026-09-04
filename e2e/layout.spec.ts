/**
 * The frame around the work: views, panels, grids, and the window.
 *
 * Split out of editor.spec.ts, which had reached a hundred and forty tests
 * across five thousand lines. What these files share is in support.ts.
 */

import { expect, test } from "@playwright/test";

import { FONT_PATH, inkLuminance, openFont } from "./support";

test.skip(!FONT_PATH, "needs a system font to open");

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

  const [first, last] = await Promise.all([wordmark.boundingBox(), exportButton.boundingBox()]);
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
