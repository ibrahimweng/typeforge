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
 * The extra weights in the session that has been written down.
 *
 * Read out of IndexedDB rather than waited for by sleeping, so the test moves
 * on the moment the document is on disk and says what is in it if it is not.
 */
function keptWeights(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const request = indexedDB.open("typeforge", 1);
        request.onerror = () => resolve([]);
        request.onsuccess = () => {
          const database = request.result;
          const get = database
            .transaction("session", "readonly")
            .objectStore("session")
            .get("current");
          get.onerror = () => {
            database.close();
            resolve([]);
          };
          get.onsuccess = () => {
            database.close();
            const project = get.result as
              | { edit?: { masters?: Array<{ name: string }> } }
              | undefined;
            resolve((project?.edit?.masters ?? []).map((one) => one.name));
          };
        };
      }),
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

  const row = page.locator('[data-weights="full"]');
  await expect(row).toBeVisible();
  await expect(row.locator("[data-weight]")).toHaveCount(1);
  /*
   * Placed rather than hidden. A feature nobody can see is a feature nobody
   * has, so the line is there before there is anything to switch between --
   * but the things that are meaningless with one weight are not.
   */
  await expect(row.locator("[data-remove-weight]")).toHaveCount(0);
  await expect(row.locator("[data-add-weight]")).toBeVisible();
});

test("adds a second weight at the far end of the axis and goes to it", async ({ page }) => {
  await sample(page);
  await page.locator("[data-add-weight]").click();

  const row = page.locator('[data-weights="full"]');
  await expect(row.locator("[data-weight]")).toHaveCount(2);
  await expect(row.locator("[data-weight]").nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(row.locator("[data-weight-at]")).toHaveValue("700");
  await expect(row.locator("[data-weight-name]")).toHaveValue("Bold");
});

test("a letter drawn in one weight leaves the other alone", async ({ page }) => {
  await sample(page);
  await page.locator("[data-add-weight]").click();

  await page.locator("[data-glyph-cell='o']").dblclick();
  await expect(page.locator("[data-points-panel]")).toBeVisible();
  // The chips follow you to the letter, because that is where the decision is.
  await expect(page.locator('[data-weights="compact"] [data-weight]')).toHaveCount(2);

  const was = await widthOf(page);
  const width = page.getByRole("textbox", { name: "Advance width" });
  await width.fill("880");
  await width.press("Enter");
  await expect(width).toHaveValue("880");

  // Back to the first weight: same letter, its own drawing.
  await page.locator('[data-weights="compact"] [data-weight]').first().click();
  await expect(width).toHaveValue(was);

  await page.locator('[data-weights="compact"] [data-weight]').nth(1).click();
  await expect(width).toHaveValue("880");
});

test("the name is one font's name, whichever weight is in hand", async ({ page }) => {
  await sample(page);
  await page.locator("[data-add-weight]").click();
  await page.locator("[data-weight-name]").fill("Black");
  await expect(page.locator("[data-weight]").nth(1)).toHaveText("Black");

  /*
   * A weight owns its letters and shares everything else, because the file all
   * of this becomes carries one `name` table, one set of vertical metrics and
   * one `GPOS`. A document that let those drift would describe a font that
   * cannot be built.
   */
  await page.locator('[data-weights="full"] [data-weight]').first().click();
  await expect(page.locator("[data-weight]").nth(1)).toHaveText("Black");
});

test("throwing a weight away asks first", async ({ page }) => {
  await sample(page);
  await page.locator("[data-add-weight]").click();

  const remove = page.locator("[data-remove-weight]");
  await expect(remove).toHaveText("Remove this weight");
  await remove.click();
  // Armed, not done: this is a whole alphabet and there is no undo behind it.
  await expect(remove).toHaveText("Throw away Bold?");
  await expect(page.locator('[data-weights="full"] [data-weight]')).toHaveCount(2);

  await remove.click();
  await expect(page.locator('[data-weights="full"] [data-weight]')).toHaveCount(1);
  await expect(page.locator("[data-remove-weight]")).toHaveCount(0);
});

test("both weights are still there after coming back", async ({ page }) => {
  await sample(page);
  await page.locator("[data-add-weight]").click();
  await page.locator("[data-weight-name]").fill("Black");
  await page.locator("[data-weight-at]").fill("900");

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
  await expect.poll(() => keptWeights(page), { timeout: 30_000 }).toEqual(["Black"]);

  await page.reload();
  await expect(page.getByText("Picked up where you left off")).toBeVisible({ timeout: 45_000 });

  const row = page.locator('[data-weights="full"]');
  await expect(row.locator("[data-weight]")).toHaveCount(2);
  await expect(row.locator("[data-weight]").nth(1)).toHaveText("Black");
  /*
   * And in the weight that was in hand. Coming back to the Regular after an
   * afternoon in the Black is the same broken promise as coming back to the
   * wrong mode, and it was written that way first -- this asked for the weight
   * it had been drawing and got the other one.
   */
  await expect(row.locator("[data-weight]").nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(row.locator("[data-weight-at]")).toHaveValue("900");

  await page.locator("[data-glyph-cell='o']").dblclick();
  const back = page.getByRole("textbox", { name: "Advance width" });
  await expect(back).toHaveValue("880");
  await page.locator('[data-weights="compact"] [data-weight]').first().click();
  await expect(back).toHaveValue(was);
});

test("a letter whose weights do not line up says so where it is drawn", async ({ page }) => {
  await sample(page);
  await page.locator("[data-add-weight]").click();
  await expect(page.locator('[data-weights="full"] [data-weight]')).toHaveCount(2);

  await page.locator("[data-glyph-cell='o']").dblclick();
  await expect(page.locator("[data-points-panel]")).toBeVisible();
  // Nothing to say yet: the Bold started as a copy, so it matches exactly.
  await expect(page.locator('[data-glyph-fault]').filter({ hasText: "will not vary" })).toHaveCount(
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
  await expect(page.locator("[data-weights-stuck]")).toHaveText("1 letter will not vary");
  await expect(page.locator('[data-glyph-cell="o"]')).toHaveAttribute("data-glyph-varies", "no");
  await expect(page.locator('[data-glyph-cell="e"]')).not.toHaveAttribute("data-glyph-varies", "no");
});

test("and the checks say how much of the font will actually move", async ({ page }) => {
  await sample(page);
  await page.locator("[data-add-weight]").click();
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
  await page.locator("[data-add-weight]").click();

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
  await expect(page.locator("[data-weights-stuck]")).toHaveCount(0);

  const slider = page.locator("[data-weight-preview]");
  await slider.fill("400");
  await expect(page.locator("[data-weight-previewing]")).toHaveText("400");
  const light = await inkOf(page, "o");

  await slider.fill("700");
  await expect(page.locator("[data-weight-previewing]")).toHaveText("700");
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
  await page.locator("[data-weight-stop-preview]").click();
  await expect(page.locator("[data-weight-stop-preview]")).toHaveCount(0);
  expect(await inkOf(page, "o")).toBe(heavy);
});

test("going to a weight stops looking between them", async ({ page }) => {
  await sample(page);
  await page.locator("[data-add-weight]").click();
  await page.locator("[data-weight-preview]").fill("523");
  await expect(page.locator("[data-weight-previewing]")).toHaveText("523");

  /*
   * The two answer the same question. A preview left standing over a different
   * master is a screen showing neither what is drawn nor what was asked for.
   */
  await page.locator('[data-weights="full"] [data-weight]').first().click();
  await expect(page.locator("[data-weight-stop-preview]")).toHaveCount(0);
  await expect(page.locator("[data-weight-previewing]")).toHaveCount(0);
});
