/**
 * The Trace panel, driven the way a person drives it.
 *
 * Everything under `src/quill/` is checked by the unit tests already, so what
 * is left for this file is the half that only exists in a browser: that reading
 * a font in through the file input actually produces letters, that the sliders
 * are draggable, and that dragging one changes the ink on screen.
 *
 * The last of those is worth the trouble of a real drag rather than a
 * programmatic value change. A control can be wired to the store, and the store
 * to the drawing, and the slider still be undraggable -- the wrong element
 * taking the pointer, a track with no height, a handle behind something else.
 * None of that is visible from the unit tests, and all of it is what "wire it
 * into a panel so I can drag the sliders" actually asked for.
 */

import { existsSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

const FONT_CANDIDATES = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
];
const FONT_PATH = FONT_CANDIDATES.find((path) => existsSync(path));

test.skip(!FONT_PATH, "needs a system font to trace");

/*
 * Longer than the default, because tracing really is slow.
 *
 * Seventy letters are filled, distance-transformed, thinned and fitted, and
 * that is most of a minute on a busy machine. The right answer is not a shorter
 * test but an honest budget: shortening it would only mean the suite failed on
 * the slowest machine it runs on, and it is the panel being checked here rather
 * than the fitter's speed.
 */
test.describe.configure({ timeout: 240_000 });

/**
 * The draggable track inside one control.
 *
 * Found by the two things that are true of a track and of nothing else beside
 * it: it is wide, it is short, and it carries no text. The text is the part
 * that matters -- without it the hint paragraph under each slider matched every
 * size test, and a drag aimed at the nib angle landed on its own description
 * and moved nothing. The control was reported dead when it had simply never
 * been touched, which is the exact failure this file exists to catch and would
 * have caused it to lie about instead.
 */
async function trackOf(page: Page, key: string) {
  const box = await page.locator(`[data-quill-control="${key}"]`).first().evaluate((el) => {
    const found = [...el.querySelectorAll("*")].filter((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return (
        rect.width > 80 &&
        rect.height > 6 &&
        rect.height < 40 &&
        style.pointerEvents !== "none" &&
        (node.textContent ?? "").trim() === ""
      );
    });
    const track = found[found.length - 1] ?? el;
    const rect = track.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  expect(box.width, `no track found for ${key}`).toBeGreaterThan(80);
  return box;
}

async function dragTo(page: Page, key: string, fraction: number) {
  await page.locator(`[data-quill-control="${key}"]`).first().scrollIntoViewIfNeeded();
  const track = await trackOf(page, key);
  await page.mouse.move(track.x + track.width * 0.5, track.y + track.height / 2);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width * fraction, track.y + track.height / 2, { steps: 12 });
  await page.mouse.up();
}

/** The path of the letter on screen, which is what any of this is for. */
const inkOf = (page: Page) =>
  page.locator('svg[aria-label^="The letter"] path').last().getAttribute("d");

async function traceAFont(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Trace" }).click();
  await expect(page.getByText("Nothing traced yet")).toBeVisible();
  await page
    .getByRole("complementary", { name: "Quill" })
    .locator("input[type=file]")
    .setInputFiles(FONT_PATH!);
  await page.waitForSelector('[data-quill-control="weight"]', { timeout: 180_000 });
}

test("reads a font in and offers its letters", async ({ page }) => {
  await traceAFont(page);
  await expect(page.locator("[data-quill-control]")).toHaveCount(7);
  // The letter on screen, and a line of them underneath to judge it by.
  await expect(page.locator('svg[aria-label^="The letter"]')).toBeVisible();
  const specimen = page.locator('svg[aria-label="A line of the traced letters"] path');
  expect(await specimen.count()).toBeGreaterThan(3);
});

test("every slider can be dragged and changes the letter", async ({ page }) => {
  await traceAFont(page);

  /*
   * The nib angle is dragged only after the contrast is up, and that ordering
   * is the control's meaning rather than a convenience. A round pen has no way
   * to be held at an angle, so with no contrast this correctly does nothing --
   * checked below rather than skipped, because "correctly does nothing" and
   * "not wired up" look identical from here and only one of them is fine.
   */
  const before = await inkOf(page);
  await dragTo(page, "nibAngle", 0.85);
  expect(await inkOf(page), "a round pen should not care how it is held").toBe(before);

  const moves: Array<[string, number]> = [
    ["weight", 0.8],
    ["pressure", 0.85],
    ["taper", 0.7],
    ["slant", 0.8],
    ["contrast", 0.8],
    ["nibAngle", 0.2],
  ];
  let previous = await inkOf(page);
  for (const [key, fraction] of moves) {
    await dragTo(page, key, fraction);
    const now = await inkOf(page);
    expect(now, `${key} moved nothing`).not.toBe(previous);
    previous = now;
  }

  /*
   * Tracking is checked on the line rather than on the letter, because it moves
   * the room around a letter and leaves the letter alone. Judged on the ink it
   * would read as dead, and widening it to "changes something" would stop this
   * noticing if it ever started stretching the strokes instead.
   */
  const line = page.locator('svg[aria-label="A line of the traced letters"]');
  const width = await line.getAttribute("viewBox");
  const letter = await inkOf(page);
  await dragTo(page, "tracking", 0.85);
  expect(await line.getAttribute("viewBox"), "tracking moved no room").not.toBe(width);
  expect(await inkOf(page), "tracking should not touch the strokes").toBe(letter);
});

test("a drag lands on the undo stack once", async ({ page }) => {
  await traceAFont(page);
  const undo = page.getByRole("button", { name: "Undo" });
  await expect(undo).toBeDisabled();

  const before = await inkOf(page);
  await dragTo(page, "weight", 0.85);
  expect(await inkOf(page)).not.toBe(before);
  await expect(undo).toBeEnabled();

  /*
   * One press, all the way back. A drag sends a change a frame, and without the
   * gesture being folded into one entry this would need sixty presses to undo
   * one movement of one slider.
   */
  await undo.click();
  await expect.poll(() => inkOf(page)).toBe(before);
});

test("the hand can be put back without losing the strokes", async ({ page }) => {
  await traceAFont(page);
  const before = await inkOf(page);
  const strokes = await page.getByText(/\d+ strokes/).innerText();

  await dragTo(page, "weight", 0.9);
  await dragTo(page, "slant", 0.9);
  expect(await inkOf(page)).not.toBe(before);

  await page.getByRole("button", { name: "as read" }).click();
  await expect.poll(() => inkOf(page)).toBe(before);
  // The strokes underneath were never the thing being changed.
  await expect(page.getByText(/\d+ strokes/)).toHaveText(strokes);
});
