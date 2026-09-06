/**
 * The first screen, and what is not on it.
 *
 * What somebody saw before was a headline naming an absence -- "No font open"
 * -- followed by two paragraphs about file formats, with the one route that
 * ends in a whole alphabet placed third. Around it sat six view tabs for a font
 * that was not open, an undo pair with nothing to undo, and a panel three
 * hundred pixels wide saying that parameters would appear later.
 *
 * These pin the screen a beginner actually lands on: what it offers, in what
 * order, and that nothing dead is on it.
 */
import { test, expect } from "@playwright/test";

import { goToMode } from "./support";

test("the first screen offers three ways to start, and says which to take", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Make a typeface" })).toBeVisible();

  const routes = page.locator("[data-start-route]");
  await expect(routes).toHaveCount(3);

  // Drawing is first and it is the one marked, because it is the one that ends
  // with an alphabet on screen before anything is typed.
  await expect(routes.first()).toHaveAttribute("data-start-route", "draw");
  await expect(routes.first()).toContainText("Start here");
  await expect(routes.nth(1)).toHaveAttribute("data-start-route", "trace");
  await expect(routes.nth(2)).toHaveAttribute("data-start-route", "assemble");

  // The formats are still said, further down, under the route that needs them.
  await expect(page.getByText("Or start from a font")).toBeVisible();
  await expect(page.getByText(/TrueType, OpenType, WOFF/)).toBeVisible();
});

test("nothing on the first screen is dead", async ({ page }) => {
  await page.goto("/");

  // Six tabs for the views of a font that is not open.
  await expect(page.getByRole("group", { name: "View" })).toBeHidden();
  // An undo pair with nothing behind it.
  await expect(page.getByRole("button", { name: "Undo" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Redo" })).toBeHidden();
  // And a panel whose only content was a sentence about being empty.
  await expect(page.getByText("Parameters appear once a font is open")).toBeHidden();
});

test("the ways to start a font are together, in the order the work runs", async ({ page }) => {
  /*
   * These were a strip of four beside the six view tabs: two segmented
   * controls in the same treatment, one of which changed the document and the
   * other the screen. Three of the four make a font and belong with the other
   * ways a font begins; the fourth was Edit, which nobody picks -- it is where
   * you are once there is one.
   */
  await page.goto("/");
  await page.locator("[data-new-menu]").click();
  const ways = page.locator("[data-new-list]").getByRole("menuitem");
  await expect(ways).toHaveCount(3);
  await expect(ways.nth(0)).toContainText("Draw one from a style");
  await expect(ways.nth(1)).toContainText("Trace a font you have");
  await expect(ways.nth(2)).toContainText("Assemble letters you drew");

  // And no way back to a font, because nothing is open to go back to.
  await expect(page.locator("[data-back-to-font]")).toHaveCount(0);
});

test("the menu offers the way back once a half holds something", async ({ page }) => {
  /*
   * The half of this that a one-shot dialog would have lost. Draw is a place
   * somebody returns to -- change the weight, hand it over, decide the weight
   * was wrong, go back -- so the entry says so rather than offering to start
   * again over the top of what is there.
   */
  await page.goto("/");
  await goToMode(page, "Draw");
  await expect(page.locator("[data-mode]")).toHaveAttribute("data-mode", "forge");

  await page.locator("[data-new-menu]").click();
  await expect(page.locator("[data-start='forge']")).toContainText("Back to your drawing");
  // And it is held shut, because it is where you are standing.
  await expect(page.locator("[data-start='forge']")).toBeDisabled();
  await expect(page.locator("[data-start='quill']")).toContainText("Trace a font you have");
});

test("the first route gives a beginner a whole alphabet", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-start-route="draw"]').click();

  await expect(page.locator("[data-mode]")).toHaveAttribute("data-mode", "forge");
  // Every lowercase letter is drawn before anything has been touched.
  for (const letter of ["a", "g", "n", "s", "z"]) {
    await expect(page.getByRole("button", { name: letter, exact: true })).toBeVisible();
  }
});
