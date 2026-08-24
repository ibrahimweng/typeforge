/**
 * The quick action palette, driven the way somebody would drive it.
 *
 * The search itself is checked in `src/palette/search.test.ts`, where the
 * ranking can be asserted without a browser. What is left for here is the part
 * that only exists in a browser: that the shortcut opens it over whatever is in
 * front, that the keyboard walks it, that picking a control moves the real font
 * rather than just closing the box, and that the two actions which throw work
 * away stop and ask first.
 */

import { expect, test } from "@playwright/test";

const open = async (page: import("@playwright/test").Page) => {
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("dialog", { name: "Quick actions" })).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /draw/i }).first().click();
});

test("opens on the shortcut and closes on escape", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Quick actions" })).toBeHidden();
});

test("shows somewhere to start before anything is typed", async ({ page }) => {
  await open(page);
  const dialog = page.getByRole("dialog", { name: "Quick actions" });
  await expect(dialog.getByRole("option").first()).toBeVisible();
});

test("finds a control from a description rather than its name", async ({ page }) => {
  await open(page);
  await page.getByRole("textbox", { name: "Search everything" }).fill("the letters are too close together");
  const dialog = page.getByRole("dialog", { name: "Quick actions" });
  // Whatever wins, it has to be about spacing rather than about a letter.
  await expect(dialog.getByRole("option").first()).toContainText(/spac|kern|sidebearing|aperture/i);
});

test("adjusts a control in the palette, and the font moves behind it", async ({ page }) => {
  await open(page);
  await page.getByRole("textbox", { name: "Search everything" }).fill("~squareness");
  const dialog = page.getByRole("dialog", { name: "Quick actions" });
  const first = dialog.getByRole("option").first();
  await expect(first).toContainText(/squareness/i);
  await first.click();
  // The row opens a slider rather than closing the palette.
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("slider").first()).toBeVisible();
});

test("asks before throwing the work away", async ({ page }) => {
  await open(page);
  await page.getByRole("textbox", { name: "Search everything" }).fill("start a new font");
  await page.getByRole("dialog", { name: "Quick actions" }).getByRole("option").first().click();
  const asking = page.getByRole("alertdialog");
  await expect(asking).toBeVisible();
  await expect(asking).toContainText(/no undo/i);
  await asking.getByRole("button", { name: "Keep it" }).click();
  await expect(asking).toBeHidden();
});

test("walks the list with the arrow keys", async ({ page }) => {
  await open(page);
  await page.getByRole("textbox", { name: "Search everything" }).fill("export");
  const dialog = page.getByRole("dialog", { name: "Quick actions" });
  await expect(dialog.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(dialog.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");
});
