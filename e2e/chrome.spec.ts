/**
 * What a sweep of the whole interface found, pinned so it stays found.
 *
 * Each of these is a thing that was on screen and wrong: a check that stopped
 * a quarter of the way through a font without saying so, a Save button lit
 * with nothing to save beside an Export button correctly greyed, and a warning
 * about the file somebody had just opened delivered into a status line ten rem
 * wide that truncates.
 */
import { test, expect, type Page } from "@playwright/test";
import { existsSync } from "node:fs";

const FONT_CANDIDATES = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
];
const FONT_PATH = FONT_CANDIDATES.find((path) => existsSync(path));
test.skip(!FONT_PATH, "needs a system font to open");

async function openFont(page: Page): Promise<void> {
  await page.setInputFiles("[data-open-input]", FONT_PATH!);
  await expect(
    page.getByText("DejaVu Sans", { exact: false }).first(),
  ).toBeVisible({
    timeout: 60_000,
  });
}

test("Save is dark until there is something to save", async ({ page }) => {
  await page.goto("/");
  // The front door: Export knows there is nothing to write and Save did not.
  await expect(page.getByRole("button", { name: "Export" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();

  await openFont(page);
  await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();

  // Assemble starts empty, so both are dark there until a drawing arrives.
  await page.getByRole("button", { name: "Assemble", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  // Draw always has a family, so there is always something to carry on with.
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
});

test("the checks look at the whole font", async ({ page }) => {
  /*
   * This used to stop at five thousand glyphs, which on a font of six and a
   * quarter thousand left a quarter of it unexamined behind a headline of "0
   * errors" -- the only thing on screen was "5,000 glyphs checked", which reads
   * as a fact about the font rather than a limit on the check. Saying so was
   * the first fix; checking the rest is this one.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Checks", exact: true }).click();
  await page.getByRole("button", { name: /Run checks|Check again/ }).click();
  await expect(page.getByText("glyphs checked", { exact: false })).toBeVisible({
    timeout: 120_000,
  });
  // Every glyph the grid counts, and nothing left over to report as skipped.
  await expect(page.getByText("6,253 glyphs checked", { exact: false })).toBeVisible();
  await expect(page.getByText("not checked", { exact: false })).toHaveCount(0);
});

test("what the importer said about the file is somewhere it can be read", async ({
  page,
}) => {
  /*
   * These had one reader: the first of them was appended to the status line in
   * the top bar, which is capped at ten rem and truncates. Opening this font
   * put "Opened — 6,253 glyphs. 2,6…" on screen -- four characters of a
   * sentence about the font, and the rest of it in a tooltip nobody has a
   * reason to hover.
   */
  await page.goto("/");
  await openFont(page);
  await expect(page.locator("[data-save-project]")).toBeEnabled();
  const status = page.locator("header").getByText("Opened —", { exact: false });
  await expect(status).toBeVisible();
  // The status line points at where they went instead of carrying one badly.
  await expect(status).toContainText("Checks");

  await page.getByRole("button", { name: "Checks", exact: true }).click();
  const band = page.locator("[data-open-warnings]");
  await expect(band).toBeVisible();
  await expect(band).toContainText("the file this came from");
});

test("the export dialog says what name the file will go out under", async ({ page }) => {
  /*
   * Of the four export dialogs this was the only one that never mentioned it.
   * Draw, Assemble and Trace all name the font on the way out; here the name
   * came from whatever file was opened, and with "Everything from the original"
   * chosen above it so did the designer, the copyright and the licence. A
   * person could open somebody else's font, redraw every letter and ship a file
   * still claiming to be theirs, without a word about it at the moment of
   * shipping.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Export" }).click();
  const family = page.locator("[data-export-family]");
  await expect(family).toHaveValue("DejaVu Sans");

  // And it is the decision, not a label: changing it here changes the font.
  await family.fill("Something Of My Own");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-font-name]")).toContainText("Something Of My Own");
});

test("a licence is a paragraph, and can be read as one", async ({ page }) => {
  /*
   * A copyright notice and a licence are sentences. DejaVu's are both longer
   * than a one-line box, and the field stopped being legible at "Copyright (c)
   * 2003 by Bitstream, Inc. All Rights Reserve". A field somebody cannot read
   * is a field they cannot check, and these two are the ones type licences
   * care about.
   */
  await page.goto("/");
  await openFont(page);
  await page.locator("[data-font-name]").click();
  const licence = page.getByRole("textbox", { name: "Licence" });
  await expect(licence).toBeVisible();
  expect(await licence.evaluate((one) => one.tagName)).toBe("TEXTAREA");
  const copyright = page.getByRole("textbox", { name: "Copyright" });
  expect(await copyright.evaluate((one) => one.tagName)).toBe("TEXTAREA");
});

test("one document's news does not show over another's", async ({ page }) => {
  /*
   * "Opened — 6,253 glyphs" is about the edited font. It sat in the bar over
   * Draw with "Untitled Sans" named a few inches to its left: two documents in
   * one strip, and the louder of them not the one on screen.
   */
  await page.goto("/");
  await openFont(page);
  const status = page.locator("header").getByText("Opened —", { exact: false });
  await expect(status).toBeVisible();
  for (const mode of ["Draw", "Assemble", "Trace"]) {
    await page.getByRole("button", { name: mode, exact: true }).click();
    await expect(status, `the editor's news showed in ${mode}`).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(status).toBeVisible();
});

test("a sentence with no room to be said is not said in two letters", async ({ page }) => {
  /*
   * In a nine-hundred-pixel window the context row is a label, three letter
   * boxes and six controls, and what was left for the sentence beside them was
   * "Dr…". Truncation is fine while a few words survive; at two characters it
   * says nothing and reads as a rendering fault.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();
  const said = page.getByText("Drawn flat and not editable", { exact: false });

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(said).toBeVisible();

  await page.setViewportSize({ width: 900, height: 800 });
  await expect(said).toBeHidden();
});

test("an export dialog can be used on a short window", async ({ page }) => {
  /*
   * These are centred flex children with no height of their own, and a centred
   * flex child taller than the window is clipped at *both* ends -- with nothing
   * scrollable anywhere, so what is past the fold cannot be reached at all and
   * a click aimed at it never lands. The editor's is 963 pixels tall, and was
   * 805 before a name field was added to it, so its Download button was off a
   * 600-pixel window either way; at 720 the field was what took it under. None
   * of the four had a height of any kind.
   */
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Export" }).click();

  // The bottom of the dialog: reachable, and the button there still exports.
  const download = page.getByRole("dialog").getByRole("button", { name: "Download" });
  await download.scrollIntoViewIfNeeded();
  await expect(download).toBeInViewport();
  const file = await Promise.race([
    page.waitForEvent("download", { timeout: 60_000 }),
    download.click().then(() => page.waitForEvent("download", { timeout: 60_000 })),
  ]);
  expect(file.suggestedFilename()).toMatch(/\.ttf$/);

  // And the top of it: the panel scrolls rather than clipping what it cannot fit.
  const family = page.locator("[data-export-family]");
  await family.scrollIntoViewIfNeeded();
  await expect(family).toBeInViewport();
});
