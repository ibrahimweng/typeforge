import { existsSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

const FONT_CANDIDATES = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
];
const FONT_PATH = FONT_CANDIDATES.find((path) => existsSync(path));

/**
 * Drawing one letter of a drawn font by hand, without leaving.
 *
 * Draw holds no outlines -- a letter there is a skeleton, a pen and a set of
 * parts, redrawn from nothing every time a slider moves -- so the point tools
 * could not be pointed at it and a letter that needed a hand had to leave as an
 * SVG sheet, be worked on in another program, and be dropped back in. The trip
 * is now available without the file: the letter goes onto the canvas on its
 * own, every tool in the application reaches it, and it comes back into the
 * slot it left at the width it left with.
 */

/** Grab whatever point the pointer finds and pull it, reporting whether it did. */
async function dragAPoint(page: Page, by: number): Promise<boolean> {
  const canvas = page.locator("canvas").first();
  const box = (await canvas.boundingBox())!;
  for (let y = box.height * 0.15; y < box.height * 0.75; y += 6) {
    for (let x = box.width * 0.3; x < box.width * 0.7; x += 6) {
      await page.mouse.move(box.x + x, box.y + y);
      if (
        ((await canvas.getAttribute("class")) ?? "").includes("cursor-grab")
      ) {
        await page.mouse.down();
        await page.mouse.move(box.x + x, box.y + y - by, { steps: 6 });
        await page.mouse.up();
        return true;
      }
    }
  }
  return false;
}

test("a drawn letter can be worked on with the tools and kept", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Draw", exact: true }).click();

  // What the letter looks like before anybody touches it, so the assertion at
  // the end is that it looks different rather than that a button was pressed.
  const drawnLetter = () =>
    page.locator("[data-forge-stage=n] path").first().getAttribute("d");
  const before = await drawnLetter();
  expect(before).toBeTruthy();

  await page.locator("[data-forge-draw-here=n]").click();

  // It arrives on the canvas, on its own, with every tool pointed at it.
  await expect(page.locator("[data-on-loan=n]")).toBeVisible();
  await expect(page.getByRole("group", { name: "Tool" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Glyph", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-paths-panel]")).toContainText("paths");

  /*
   * The tabs are held shut, and this is the assertion that matters most.
   *
   * The document that was open is put aside behind a loan. Walking to another
   * tab would leave the borrowed letter on the desk and the real font in a
   * drawer with nothing on screen to say why.
   */
  await expect(
    page.getByRole("button", { name: "Assemble", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Trace", exact: true }),
  ).toBeDisabled();

  const canvas = page.locator("canvas").first();
  const box = (await canvas.boundingBox())!;
  expect(await dragAPoint(page, box.height * 0.12)).toBe(true);

  await page.locator("[data-loan-keep]").click();

  // Back in Draw, and the letter says what it has become.
  await expect(
    page.getByRole("button", { name: "Draw", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-forge-imported=n]")).toBeVisible();
  await expect(page.locator("[data-forge-imported=n]")).toContainText(
    "your drawing",
  );

  // The whole point: the letter in the drawn font is now the one that was
  // drawn by hand, and it is not the one the skeleton makes.
  expect(await drawnLetter()).not.toBe(before);

  // And one button puts it back under the family's control, which is the same
  // letter it always was.
  await page.locator("[data-forge-redraw=n]").click();
  await expect(page.locator("[data-forge-imported=n]")).toHaveCount(0);
  expect(await drawnLetter()).toBe(before);
});

test("a loan thrown away leaves the letter as it was", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  const drawnLetter = () =>
    page.locator("[data-forge-stage=n] path").first().getAttribute("d");
  const before = await drawnLetter();

  await page.locator("[data-forge-draw-here=n]").click();
  await expect(page.locator("[data-on-loan=n]")).toBeVisible();
  expect(await dragAPoint(page, 40)).toBe(true);

  await page.locator("[data-loan-drop]").click();
  await expect(
    page.getByRole("button", { name: "Draw", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  // Still a description, still answering the sliders, and unmoved.
  await expect(page.locator("[data-forge-imported=n]")).toHaveCount(0);
  expect(await drawnLetter()).toBe(before);
});

test("the font that was open comes back untouched", async ({ page }) => {
  /*
   * The loan is a parenthesis. Somebody who had a font open in Edit and went to
   * look at Draw has not abandoned it, so what was open is put aside whole --
   * the typeface, the letter that was selected, both history stacks -- and
   * comes back when the loan ends, whichever way it ends.
   */
  await page.goto("/");
  test.skip(!FONT_PATH, "needs a system font to open");
  await page.setInputFiles("[data-open-input]", FONT_PATH!);
  await expect(
    page.getByText("DejaVu Sans", { exact: false }).first(),
  ).toBeVisible({
    timeout: 45_000,
  });

  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await page.locator("[data-forge-draw-here=n]").click();
  await expect(page.locator("[data-on-loan=n]")).toBeVisible();
  // The desk is one letter and is not the open font.
  await expect(page.getByText("DejaVu Sans", { exact: false })).toHaveCount(0);

  await page.locator("[data-loan-drop]").click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(
    page.getByText("DejaVu Sans", { exact: false }).first(),
  ).toBeVisible();
});

test("the palette cannot walk out of a loan either", async ({ page }) => {
  /*
   * The tabs are one door and they are held shut. The command palette is a
   * second door to the same rooms, and it went straight past that -- so did the
   * course drawer's "take me there". Either would have left the borrowed letter
   * on the desk and the real document in a drawer, with nothing on screen to
   * say why, while the strip above the canvas went on claiming the only ways
   * out were keeping the drawing and throwing it away.
   */
  await page.goto("/");
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await page.locator("[data-forge-draw-here=n]").click();
  await expect(page.locator("[data-on-loan=n]")).toBeVisible();

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("textbox", { name: "Search everything" }).fill("Assemble");
  await page.getByRole("dialog", { name: "Quick actions" }).getByRole("option").first().click();

  // Still on the letter, and told why rather than left guessing.
  await expect(page.locator("[data-on-loan=n]")).toBeVisible();
  await expect(page.getByText("Finish with n first", { exact: false })).toBeVisible();
});

test("a traced letter can be worked on with the tools too", async ({ page }) => {
  /*
   * Trace needs this at least as much as Draw does. What comes back from a
   * trace is a guess about how a shape was made rather than a record of it, so
   * there is always a letter no set of strokes reaches -- and until now the
   * only way to move a point on one of them was to take all seventy letters out
   * of the engine that drew them.
   */
  test.skip(!FONT_PATH, "needs a system font to read");
  await page.goto("/");
  await page.getByRole("button", { name: "Trace", exact: true }).click();
  await page
    .getByRole("complementary", { name: "Quill" })
    .locator("input[type=file]")
    .setInputFiles(FONT_PATH!);
  await page.waitForSelector('[data-quill-control="weight"]', { timeout: 180_000 });
  await page.locator("[data-quill-trip] button").first().waitFor();

  const traced = () => page.locator("[data-quill-stage=a] path").last().getAttribute("d");
  const before = await traced();

  await page.locator("[data-quill-draw-here=a]").click();
  await expect(page.locator("[data-on-loan=a]")).toBeVisible();
  await expect(page.getByRole("group", { name: "Tool" })).toBeVisible();
  // It says which half it came out of, because it goes back to that one.
  await expect(page.locator("[data-on-loan=a]")).toContainText("on loan from Trace");

  expect(await dragAPoint(page, 60)).toBe(true);
  await page.locator("[data-loan-keep]").click();

  // Back in Trace, and the letter is the drawing rather than the strokes.
  await expect(page.getByRole("button", { name: "Trace", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("[data-quill-byhand=a]")).toBeVisible();
  expect(await traced()).not.toBe(before);

  // The strokes never went anywhere, so giving the letter back costs one press.
  await page.locator("[data-quill-redraw=a]").click();
  await expect(page.locator("[data-quill-byhand=a]")).toHaveCount(0);
  expect(await traced()).toBe(before);
});
