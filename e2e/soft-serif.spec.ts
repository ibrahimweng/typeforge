/**
 * Starting from the Soft Serif, a face drawn on the Serif (`src/forge/starts.ts`).
 *
 * Offered under the Serif's heading after the bases, from its own button and
 * from the palette, and started as a base is: the drawing becomes the Serif
 * with the soft finishes on, named for the face, and the Serif's button is the
 * one that says which base it is drawn on. The face is never a base itself,
 * so the Serif's button stays the only one that names the Serif.
 */

import { expect, test } from "@playwright/test";

import { openForge } from "./support";

test("starts the Soft Serif from its button, on the Serif", async ({ page }) => {
  await openForge(page);
  const start = page.locator('[data-forge-start="soft-serif"]');
  await expect(start).toBeVisible();
  await expect(start).toHaveText("Soft Serif");
  await expect(start).toHaveAttribute("aria-pressed", "false");
  // Under the Serif's heading, after its bases, and not a base itself.
  await expect(page.locator('[data-forge-base="Serif"]')).toHaveCount(1);
  await expect(page.locator('[data-forge-base="Soft Serif"]')).toHaveCount(0);

  await start.click();
  const status = page.locator("[data-status-bar] [data-status-document]");
  await expect(status).toHaveText("Soft Serif — drawn from Serif");
  await expect(page.locator('[data-forge-base="Serif"]')).toHaveAttribute("aria-pressed", "true");
  await expect(start).toHaveAttribute("aria-pressed", "false");
  // The letters it draws its own way are the ones chosen.
  for (const [letter, form] of [
    ["a", "curled"],
    ["y", "swung"],
    ["f", "tucked"],
  ]) {
    await page.locator(`[data-forge-cell="${letter}"]`).click();
    await expect(
      page.locator(`[data-forge-forms="${letter}"] [data-forge-form="${form}"]`),
    ).toHaveAttribute("aria-pressed", "true");
  }

  // And going to a base names the font for the base again.
  await page.getByRole("button", { name: "Sans", exact: true }).click();
  await expect(status).toHaveText("My Sans — drawn from Sans");
});

test("starts the Soft Serif from the palette, after asking", async ({ page }) => {
  await openForge(page);
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Quick actions" });
  await expect(dialog).toBeVisible();
  await page.getByRole("textbox", { name: "Search everything" }).fill("soft serif");
  await dialog
    .getByRole("option", { name: /Soft Serif/ })
    .first()
    .click();
  // It replaces the drawing, so it asks first, as starting from a base there does.
  const asking = page.getByRole("alertdialog");
  await expect(asking).toBeVisible();
  await asking.getByRole("button", { name: "Go on" }).click();
  await expect(page.locator("[data-status-bar] [data-status-document]")).toHaveText(
    "Soft Serif — drawn from Serif",
  );
});
