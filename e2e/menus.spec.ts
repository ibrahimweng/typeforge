/**
 * The menu bar.
 *
 * What makes a row of menus a menu bar rather than five buttons is that it
 * behaves as one thing once it is open: moving across the titles opens the
 * next without a second click, and the arrows walk it. Those are the parts
 * worth a test, because they are the parts a person does without deciding to
 * and would notice immediately as missing.
 */

import { expect, test } from "@playwright/test";

import { openFont } from "./support";

const TITLES = ["File", "Edit", "View", "Window", "Help"];

test("offers the five menus wherever you are", async ({ page }) => {
  await page.goto("/");
  // Before a font is open, which is the state a menu bar most has to survive:
  // it is the thing that says what the application can do.
  for (const title of TITLES) {
    await expect(page.locator(`[data-menu-title="${title}"]`)).toBeVisible();
  }
});

test("a title opens its menu and closes it again", async ({ page }) => {
  await page.goto("/");
  const file = page.locator('[data-menu-title="File"]');

  await file.click();
  await expect(page.locator('[data-menu-list="File"]')).toBeVisible();
  await expect(file).toHaveAttribute("aria-expanded", "true");

  await file.click();
  await expect(page.locator('[data-menu-list="File"]')).toHaveCount(0);
});

test("once one is open, moving across the titles opens the next", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-menu-title="File"]').click();
  await expect(page.locator('[data-menu-list="File"]')).toBeVisible();

  // No click. This is the whole difference between a menu bar and five buttons.
  await page.locator('[data-menu-title="View"]').hover();
  await expect(page.locator('[data-menu-list="View"]')).toBeVisible();
  await expect(page.locator('[data-menu-list="File"]')).toHaveCount(0);
});

test("hovering a title does nothing while the bar is shut", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-menu-title="View"]').hover();
  await expect(page.locator('[data-menu-list="View"]')).toHaveCount(0);
});

/*
 * The one WebKit does not give you. Safari does not focus a button when it is
 * clicked, so a menu opened with the mouse left the keyboard on the body and
 * every key test below passed everywhere else while the feature was broken on
 * one engine.
 */
test("opening with the mouse leaves the keyboard somewhere useful", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-menu-title="File"]').click();
  await expect(page.locator('[data-menu-title="File"]')).toBeFocused();
});

test("the arrows walk the bar, from inside an open menu", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-menu-title="File"]').click();
  await expect(page.locator('[data-menu-list="File"]')).toBeVisible();

  await page.keyboard.press("ArrowRight");
  await expect(page.locator('[data-menu-list="Edit"]')).toBeVisible();

  await page.keyboard.press("ArrowLeft");
  await expect(page.locator('[data-menu-list="File"]')).toBeVisible();

  // And it wraps, so there is no end to fall off.
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator('[data-menu-list="Help"]')).toBeVisible();
});

test("Escape puts it away and gives the title back the focus", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-menu-title="Edit"]').click();
  await expect(page.locator('[data-menu-list="Edit"]')).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.locator('[data-menu-list="Edit"]')).toHaveCount(0);
  await expect(page.locator('[data-menu-title="Edit"]')).toBeFocused();
});

test("a command runs, and the menu goes away when it has", async ({ page }) => {
  await page.goto("/");
  await openFont(page);

  await page.locator('[data-menu-title="View"]').click();
  await page.locator('[data-menu-command="menu:view:kerning"]').click();

  await expect(page.locator('[data-menu-list="View"]')).toHaveCount(0);
  // The kerning screen, by something only it has.
  await expect(page.getByRole("textbox", { name: "Filter kerning pairs" })).toBeVisible();
});

test("the View menu ticks the screen you are on, and only that one", async ({ page }) => {
  await page.goto("/");
  await openFont(page);

  await page.locator('[data-menu-title="View"]').click();
  await page.locator('[data-menu-command="menu:view:metrics"]').click();

  await page.locator('[data-menu-title="View"]').click();
  const ticked = page.locator('[data-menu-list="View"] [aria-checked="true"]');
  await expect(ticked).toHaveCount(1);
  await expect(page.locator('[data-menu-command="menu:view:metrics"]')).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("what needs a font is greyed rather than missing before there is one", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-menu-title="File"]').click();

  const save = page.locator('[data-menu-command="action:save"]');
  await expect(save, "Save is offered").toBeVisible();
  await expect(save, "and says it cannot be used yet").toBeDisabled();
});
