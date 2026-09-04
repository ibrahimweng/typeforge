/**
 * Assemble: drawings dropped in, traced, and turned into letters.
 *
 * Split out of editor.spec.ts, which had reached a hundred and forty tests
 * across five thousand lines. What these files share is in support.ts.
 */

import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import {
  FONT_PATH,
  bar,
  dragOnto,
  dropFolder,
  fillBox,
  openAssemble,
  openFont,
  openForge,
  point,
} from "./support";

test.skip(!FONT_PATH, "needs a system font to open");

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

  await expect
    .poll(() => page.locator('[data-assemble-box="A"] path').getAttribute("d"))
    .not.toBe(first);
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
    await expect(page.locator(`[data-assemble-box="${character}"]`)).toHaveAttribute(
      "data-assemble-filled",
      "yes",
    );
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
  await dropFolder(page, [...PILE, { ...bar(400, 200), name: "logo-final-v3.svg" }]);

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
  const bytes = readFileSync((await download.path())!);
  expect([...bytes.subarray(0, 4)]).toEqual([0, 1, 0, 0]);

  // The strongest check available in a browser: ask it to parse the file.
  const parsed = await page.evaluate(
    async (data) => {
      const face = new FontFace("Assembled", new Uint8Array(data).buffer as ArrayBuffer);
      await face.load();
      return face.status;
    },
    [...bytes],
  );
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
