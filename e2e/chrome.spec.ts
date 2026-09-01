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
