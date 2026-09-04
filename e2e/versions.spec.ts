/**
 * More than one weight of the same typeface.
 *
 * A variable font is drawn twice and blended, and until this the application
 * could only blend: the export synthesised a bold by moving one number, which
 * offsets every node along its own normal and thickens a hairline and a stem by
 * the same amount. These pin the half that was missing -- a second drawing you
 * make yourself -- and the two rules the document rests on: a weight owns its
 * letters, and shares everything the font file writes once.
 */
import { expect, test, type Page } from "@playwright/test";

/**
 * What the written-down session holds for one letter in one weight.
 *
 * Read out of IndexedDB rather than waited for by sleeping, so the test moves
 * on the moment the document is on disk and says what is in it if it is not.
 *
 * This reported the weights' names until it was found to be reporting the
 * wrong thing. A weight is named before the letter in it is edited, so the
 * first write to disk carries "Black" and the letter's original width: the
 * poll passed on that write, the reload restored it, and the letter came back
 * the width it started at. Run one test at a time the save timer usually
 * caught both changes in a single write and it passed anyway; run beside
 * anything else it did not. Waiting for the edit waits for what the reload
 * below actually needs.
 */
function keptWidth(page: Page, weight: string, letter: string): Promise<number | null> {
  return page.evaluate(
    ([wanted, named]) =>
      new Promise<number | null>((resolve) => {
        const request = indexedDB.open("typeforge", 1);
        request.onerror = () => resolve(null);
        request.onsuccess = () => {
          const database = request.result;
          const get = database
            .transaction("session", "readonly")
            .objectStore("session")
            .get("current");
          get.onerror = () => {
            database.close();
            resolve(null);
          };
          get.onsuccess = () => {
            database.close();
            const project = get.result as
              | {
                  edit?: {
                    masters?: Array<{
                      name: string;
                      glyphs?: Array<{ name: string; advanceWidth: number }>;
                    }>;
                  };
                }
              | undefined;
            const master = (project?.edit?.masters ?? []).find((one) => one.name === wanted);
            const glyph = (master?.glyphs ?? []).find((one) => one.name === named);
            resolve(glyph?.advanceWidth ?? null);
          };
        };
      }),
    [weight, letter] as const,
  );
}

async function sample(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto("/");
  await page.getByRole("button", { name: "Try the sample font" }).click();
  await expect(page.getByText("221 glyphs", { exact: true })).toBeVisible({ timeout: 45_000 });
}

/** The advance width of the letter that is open, as the panel reports it. */
async function widthOf(page: Page): Promise<string> {
  return (await page.getByRole("textbox", { name: "Advance width" }).inputValue()).trim();
}

test("a font with one weight says so, and offers a second", async ({ page }) => {
  await sample(page);

  const row = page.locator('[data-versions="full"]');
  await expect(row).toBeVisible();
  await expect(row.locator("[data-version]")).toHaveCount(1);
  /*
   * Placed rather than hidden. A feature nobody can see is a feature nobody
   * has, so the line is there before there is anything to switch between --
   * but the things that are meaningless with one weight are not.
   */
  await expect(row.locator("[data-remove-version]")).toHaveCount(0);
  await expect(row.locator('[data-add-version="wght"]')).toBeVisible();
});

test("adds a second weight at the far end of the axis and goes to it", async ({ page }) => {
  await sample(page);
  await page.locator('[data-add-version="wght"]').click();

  const row = page.locator('[data-versions="full"]');
  await expect(row.locator("[data-version]")).toHaveCount(2);
  await expect(row.locator("[data-version]").nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(row.locator("[data-version-at]")).toHaveValue("700");
  await expect(row.locator("[data-version-name]")).toHaveValue("Bold");
});

test("a letter drawn in one weight leaves the other alone", async ({ page }) => {
  await sample(page);
  await page.locator('[data-add-version="wght"]').click();

  await page.locator("[data-glyph-cell='o']").dblclick();
  await expect(page.locator("[data-points-panel]")).toBeVisible();
  // The chips follow you to the letter, because that is where the decision is.
  await expect(page.locator('[data-versions="compact"] [data-version]')).toHaveCount(2);

  const was = await widthOf(page);
  const width = page.getByRole("textbox", { name: "Advance width" });
  await width.fill("880");
  await width.press("Enter");
  await expect(width).toHaveValue("880");

  // Back to the first weight: same letter, its own drawing.
  await page.locator('[data-versions="compact"] [data-version]').first().click();
  await expect(width).toHaveValue(was);

  await page.locator('[data-versions="compact"] [data-version]').nth(1).click();
  await expect(width).toHaveValue("880");
});

test("the name is one font's name, whichever weight is in hand", async ({ page }) => {
  await sample(page);
  await page.locator('[data-add-version="wght"]').click();
  await page.locator("[data-version-name]").fill("Black");
  await expect(page.locator("[data-version]").nth(1)).toHaveText("Black");

  /*
   * A weight owns its letters and shares everything else, because the file all
   * of this becomes carries one `name` table, one set of vertical metrics and
   * one `GPOS`. A document that let those drift would describe a font that
   * cannot be built.
   */
  await page.locator('[data-versions="full"] [data-version]').first().click();
  await expect(page.locator("[data-version]").nth(1)).toHaveText("Black");
});

test("throwing a weight away asks first", async ({ page }) => {
  await sample(page);
  await page.locator('[data-add-version="wght"]').click();

  const remove = page.locator("[data-remove-version]");
  await expect(remove).toHaveText("Remove this version");
  await remove.click();
  // Armed, not done: this is a whole alphabet and there is no undo behind it.
  await expect(remove).toHaveText("Throw away Bold?");
  await expect(page.locator('[data-versions="full"] [data-version]')).toHaveCount(2);

  await remove.click();
  await expect(page.locator('[data-versions="full"] [data-version]')).toHaveCount(1);
  await expect(page.locator("[data-remove-version]")).toHaveCount(0);
});

test("both weights are still there after coming back", async ({ page }) => {
  await sample(page);
  await page.locator('[data-add-version="wght"]').click();
  await page.locator("[data-version-name]").fill("Black");
  await page.locator("[data-version-at]").fill("900");

  await page.locator("[data-glyph-cell='o']").dblclick();
  const width = page.getByRole("textbox", { name: "Advance width" });
  await expect(width).toBeVisible();
  const was = await width.inputValue();
  await width.fill("880");
  await width.press("Enter");
  await expect(width).toHaveValue("880");

  /*
   * A session is written down on a timer as well as on the button, and the
   * whole point of a second weight is that it is an afternoon's drawing. What
   * is on disk is the letters actually drawn in it -- one, here -- laid back
   * over a copy of the first weight, which is what this polls for before
   * reloading rather than guessing at the timer.
   */
  await expect.poll(() => keptWidth(page, "Black", "o"), { timeout: 30_000 }).toBe(880);

  await page.reload();
  await expect(page.getByText("Picked up where you left off")).toBeVisible({ timeout: 45_000 });

  const row = page.locator('[data-versions="full"]');
  await expect(row.locator("[data-version]")).toHaveCount(2);
  await expect(row.locator("[data-version]").nth(1)).toHaveText("Black");
  /*
   * And in the weight that was in hand. Coming back to the Regular after an
   * afternoon in the Black is the same broken promise as coming back to the
   * wrong mode, and it was written that way first -- this asked for the weight
   * it had been drawing and got the other one.
   */
  await expect(row.locator("[data-version]").nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(row.locator("[data-version-at]")).toHaveValue("900");

  await page.locator("[data-glyph-cell='o']").dblclick();
  const back = page.getByRole("textbox", { name: "Advance width" });
  await expect(back).toHaveValue("880");
  await page.locator('[data-versions="compact"] [data-version]').first().click();
  await expect(back).toHaveValue(was);
});

test("a letter whose weights do not line up says so where it is drawn", async ({ page }) => {
  await sample(page);
  await page.locator('[data-add-version="wght"]').click();
  await expect(page.locator('[data-versions="full"] [data-version]')).toHaveCount(2);

  await page.locator("[data-glyph-cell='o']").dblclick();
  await expect(page.locator("[data-points-panel]")).toBeVisible();
  // Nothing to say yet: the Bold started as a copy, so it matches exactly.
  await expect(page.locator("[data-glyph-fault]").filter({ hasText: "will not vary" })).toHaveCount(
    0,
  );

  /*
   * Change what the letter is made of in this weight and not the other. A
   * weight is stored as the difference from the first one, and there is none to
   * store between drawings that are not the same paths with the same points in
   * the same order -- which is the failure this whole step exists to make
   * visible before the export finds it.
   *
   * Taking the counter out of the `o` rather than adding extremes to it: the
   * sample is well drawn, so it has its extremes already, and the first version
   * of this test proved nothing until its own guard caught that.
   */
  await expect(page.locator("[data-path-row]")).toHaveCount(2);
  await page.getByRole("button", { name: "Delete path 2" }).click();
  await expect(page.locator("[data-path-row]")).toHaveCount(1);

  const fault = page.locator("[data-glyph-fault]").filter({ hasText: "will not vary" });
  await expect(fault).toHaveCount(1);
  await expect(fault).toContainText("Regular");
  await expect(fault).toContainText("Bold");

  // And on the whole-font screen, as a count, and on the letter in the grid.
  await page.getByRole("button", { name: "Font", exact: true }).click();
  await expect(page.locator("[data-versions-stuck]")).toHaveText("1 letter will not vary");
  await expect(page.locator('[data-glyph-cell="o"]')).toHaveAttribute("data-glyph-varies", "no");
  await expect(page.locator('[data-glyph-cell="e"]')).not.toHaveAttribute(
    "data-glyph-varies",
    "no",
  );
});

test("and the checks say how much of the font will actually move", async ({ page }) => {
  await sample(page);
  await page.locator('[data-add-version="wght"]').click();
  await page.locator("[data-glyph-cell='o']").dblclick();
  await expect(page.locator("[data-points-panel]")).toBeVisible();
  await page.getByRole("button", { name: "Delete path 2" }).click();
  await expect(page.locator("[data-path-row]")).toHaveCount(1);

  await page.getByRole("button", { name: "Checks", exact: true }).click();
  const finding = page.locator("[data-finding]").filter({ hasText: "will not vary" });
  await expect(finding).toHaveCount(1, { timeout: 60_000 });
  await expect(finding).toContainText("1 letter will not vary between the weights");
});

/**
 * How much ink a cell in the grid is drawing, in pixels.
 *
 * Measured rather than eyeballed, and measured as ink rather than as a bounding
 * box, because that is the question actually being asked of an axis: whether
 * the strokes got heavier between one end and the other.
 */
async function inkOf(page: Page, letter: string): Promise<number> {
  return page.evaluate((name) => {
    const cell = document.querySelector(`[data-glyph-cell="${name}"] canvas`);
    if (!(cell instanceof HTMLCanvasElement)) return -1;
    const context = cell.getContext("2d");
    if (!context) return -1;
    const { data } = context.getImageData(0, 0, cell.width, cell.height);
    let lit = 0;
    for (let at = 3; at < data.length; at += 4) if (data[at] > 0) lit += 1;
    return lit;
  }, letter);
}

test("the middle of the axis can be looked at, and is between the ends", async ({ page }) => {
  await sample(page);
  await page.locator('[data-add-version="wght"]').click();

  // A Bold that is actually bolder, made with an operation that moves points
  // without adding or removing any -- which is the one thing a weight cannot
  // survive.
  await page.locator("[data-glyph-cell='o']").dblclick();
  await expect(page.locator("[data-points-panel]")).toBeVisible();
  const bigger = page.getByRole("button", { name: "Bigger", exact: true });
  for (let press = 0; press < 12; press += 1) await bigger.click();

  await page.getByRole("button", { name: "Font", exact: true }).click();
  await expect(page.locator('[data-glyph-cell="o"]')).toBeVisible();
  // Compatible, so there is something to look at between them.
  await expect(page.locator("[data-versions-stuck]")).toHaveCount(0);

  const slider = page.locator('[data-version-preview="wght"]');
  await slider.fill("400");
  await expect(page.locator("[data-version-previewing]")).toHaveText("400");
  const light = await inkOf(page, "o");

  await slider.fill("700");
  await expect(page.locator("[data-version-previewing]")).toHaveText("700");
  const heavy = await inkOf(page, "o");
  expect(heavy).toBeGreaterThan(light);

  /*
   * And the middle is the middle. A reader will show somebody 550 as readily as
   * either end, so 550 has to be a font -- which is the whole reason for
   * drawing two.
   */
  await slider.fill("550");
  const between = await inkOf(page, "o");
  expect(between).toBeGreaterThan(light);
  expect(between).toBeLessThan(heavy);

  // Looking, not editing: the drawing underneath is untouched and pressing
  // this puts the grid back to it.
  await page.locator("[data-version-stop-preview]").click();
  await expect(page.locator("[data-version-stop-preview]")).toHaveCount(0);
  expect(await inkOf(page, "o")).toBe(heavy);
});

test("going to a weight stops looking between them", async ({ page }) => {
  await sample(page);
  await page.locator('[data-add-version="wght"]').click();
  await page.locator('[data-version-preview="wght"]').fill("523");
  await expect(page.locator("[data-version-previewing]")).toHaveText("523");

  /*
   * The two answer the same question. A preview left standing over a different
   * master is a screen showing neither what is drawn nor what was asked for.
   */
  await page.locator('[data-versions="full"] [data-version]').first().click();
  await expect(page.locator("[data-version-stop-preview]")).toHaveCount(0);
  await expect(page.locator("[data-version-previewing]")).toHaveCount(0);
});

test("the export says which weights the varying font will be built from", async ({ page }) => {
  await sample(page);

  /*
   * Without a second weight the ends of the axis are worked out rather than
   * drawn -- `applyWeight` offsets every node along its own normal, which
   * thickens a hairline and a stem by the same amount. That is worth saying out
   * loud on the button rather than shipping quietly.
   */
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const before = page.getByRole("button", { name: /^Variable \(\.ttf\)/ });
  await expect(before).toContainText("calculated bold rather than a drawn one");
  await expect(before).toContainText("Add a version");
  await page.keyboard.press("Escape");

  await page.locator('[data-add-version="wght"]').click();
  await page.locator("[data-version-name]").fill("Black");

  await page.getByRole("button", { name: "Export", exact: true }).click();
  const after = page.getByRole("button", { name: /^Variable \(\.ttf\)/ });
  await expect(after).toContainText("Built from the 2 versions you drew");
  await expect(after).toContainText("Black");
});

test("the proof follows the slider too, because that is where a weight is judged", async ({
  page,
}) => {
  await sample(page);
  await page.locator('[data-add-version="wght"]').click();

  // A Bold that is genuinely bolder, made without adding or removing a point.
  await page.locator("[data-glyph-cell='o']").dblclick();
  await expect(page.locator("[data-points-panel]")).toBeVisible();
  const bigger = page.getByRole("button", { name: "Bigger", exact: true });
  for (let press = 0; press < 12; press += 1) await bigger.click();

  await page.getByRole("button", { name: "Proof", exact: true }).click();
  await expect(page.locator('[data-versions="full"]')).toBeVisible();

  /*
   * A letter tells you about a letter and a paragraph tells you about a face,
   * so the slider that moves the grid has to move this. Measured off the
   * proof's own canvas, in ink.
   */
  const inkOfProof = async (): Promise<number> =>
    page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      if (!(canvas instanceof HTMLCanvasElement)) return -1;
      const context = canvas.getContext("2d");
      if (!context) return -1;
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let lit = 0;
      for (let at = 3; at < data.length; at += 4) if (data[at] > 0) lit += 1;
      return lit;
    });

  const slider = page.locator('[data-version-preview="wght"]');
  await slider.fill("400");
  await expect(page.locator("[data-version-previewing]")).toHaveText("400");
  const light = await inkOfProof();

  await slider.fill("700");
  await expect(page.locator("[data-version-previewing]")).toHaveText("700");
  expect(await inkOfProof()).toBeGreaterThan(light);
});

test("a width beside the weight, and a corner nobody drew", async ({ page }) => {
  await sample(page);

  /*
   * Two versions, each moving one axis off the Regular. That is what a version
   * is here and what the exporter is built for -- and it is the arrangement
   * whose payoff is the corner: a Bold and a Condensed between them describe a
   * Bold Condensed without anybody drawing one.
   */
  await page.locator('[data-add-version="wght"]').click();
  await expect(page.locator("[data-version-name]")).toHaveValue("Bold");
  await page.locator('[data-add-version="wdth"]').click();
  await expect(page.locator("[data-version-name]")).toHaveValue("Condensed");

  const row = page.locator('[data-versions="full"]');
  await expect(row.locator("[data-version]")).toHaveCount(3);
  // One slider per axis, because a font with a Bold and a Condensed is looked
  // at somewhere in a square rather than somewhere along a line.
  await expect(row.locator("[data-version-preview]")).toHaveCount(2);
  // And a width axis is offered once. A third weight is an ordinary thing to
  // want, so weight stays offered.
  await expect(row.locator('[data-add-version="wdth"]')).toHaveCount(0);
  await expect(row.locator('[data-add-version="wght"]')).toHaveCount(1);

  /*
   * A Condensed that is genuinely narrower, made with an operation that moves
   * points without adding or removing any.
   */
  await page.locator("[data-glyph-cell='o']").dblclick();
  await expect(page.locator("[data-points-panel]")).toBeVisible();
  const smaller = page.getByRole("button", { name: "Smaller", exact: true });
  for (let press = 0; press < 12; press += 1) await smaller.click();

  // And a Bold that is genuinely bolder.
  await page.locator('[data-versions="compact"] [data-version]').nth(1).click();
  const bigger = page.getByRole("button", { name: "Bigger", exact: true });
  for (let press = 0; press < 12; press += 1) await bigger.click();

  await page.getByRole("button", { name: "Font", exact: true }).click();
  await expect(page.locator("[data-versions-stuck]")).toHaveCount(0);

  const weight = page.locator('[data-version-preview="wght"]');
  const width = page.locator('[data-version-preview="wdth"]');

  await weight.fill("400");
  await width.fill("100");
  const regular = await inkOf(page, "o");

  await weight.fill("700");
  const bold = await inkOf(page, "o");
  expect(bold).toBeGreaterThan(regular);

  /*
   * 75 rather than a number of my own choosing: the axis runs between the
   * versions that were drawn, so its far end is wherever the Condensed stands.
   * A document cannot claim a width it has no drawing for.
   */
  await expect(width).toHaveAttribute("min", "75");
  await expect(width).toHaveAttribute("max", "100");
  await weight.fill("400");
  await width.fill("75");
  const condensed = await inkOf(page, "o");
  expect(condensed).toBeLessThan(regular);

  /*
   * The corner. Narrower than the Bold because the Condensed applies at every
   * weight, and heavier than the Condensed because the Bold applies at every
   * width -- which is the whole reason a design space can be a star.
   */
  await weight.fill("700");
  const corner = await inkOf(page, "o");
  expect(corner).toBeLessThan(bold);
  expect(corner).toBeGreaterThan(condensed);
});

test("a first font is offered one route, and the rest once it has been taken", async ({ page }) => {
  await sample(page);
  const row = page.locator('[data-versions="full"]');
  const offered = () =>
    row
      .locator("[data-add-version]")
      .evaluateAll((buttons) => buttons.map((one) => one.getAttribute("data-add-version")));

  /*
   * One button on a font nobody has made a second version of: a second weight,
   * which is what almost everybody wants first and the only one of these that
   * explains itself. Four of them on the first screen of a first font is
   * placing an advanced control in the way rather than in reach.
   */
  expect(await offered()).toEqual(["wght"]);

  await page.locator('[data-add-version="wght"]').click();
  /*
   * And the rest once the idea has been met. The four registered tags and no
   * more: a custom axis is four letters of somebody's own and a perfectly good
   * thing to want, and a thing readers do nothing with unless the font says
   * what it means.
   */
  expect(await offered()).toEqual(["wght", "wdth", "slnt", "opsz"]);
});
