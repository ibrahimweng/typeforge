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

test("the modes are in the order the work runs", async ({ page }) => {
  await page.goto("/");
  const modes = page.getByRole("group", { name: "Mode" }).getByRole("button");
  /*
   * Edit was first for as long as this bar existed, and it is the one of the
   * four that cannot be used until you have been somewhere else. Three of them
   * make a font; the fourth is where you then work on it.
   */
  await expect(modes).toHaveText(["Draw", "Trace", "Assemble", "Edit"]);
});

test("the first route gives a beginner a whole alphabet", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-start-route="draw"]').click();

  await expect(page.getByRole("button", { name: "Draw", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // Every lowercase letter is drawn before anything has been touched.
  for (const letter of ["a", "g", "n", "s", "z"]) {
    await expect(page.getByRole("button", { name: letter, exact: true })).toBeVisible();
  }
});
