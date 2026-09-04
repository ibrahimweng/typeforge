/**
 * The grid editor, and the one gesture it is built on.
 *
 * "Press a spot on a cell's edge to send a stroke out through it" is the whole
 * of the interaction, and it could not be made. A port sits *on* the edge it
 * names, so half of it lies in the cell next door -- and the cells were drawn
 * one at a time, square and ports together, so the next cell's square painted
 * over that half. Reaching for a port took the pointer into the neighbour: the
 * cell under the cursor changed, the eight dots vanished, and what was left
 * under the pointer was the neighbour's port at the same spot on the screen,
 * which is a different toggle. Missing landed on the square, which stamps a
 * fill.
 *
 * So this walks the pointer from a cell's middle to one of its ports the way a
 * hand does, and asks for the two things that were not true: that the dot is
 * still there when the pointer arrives, and that pressing it turns on that
 * port and nothing else.
 */

import { expect, test } from "@playwright/test";

/** Which ports are lit, with the pointer parked off the grid. */
async function lit(page: import("@playwright/test").Page): Promise<string[]> {
  await page.mouse.move(700, 100);
  await page.waitForTimeout(400);
  return page.evaluate(() =>
    [...document.querySelectorAll("[data-forge-port]")].map(
      (one) => (one as HTMLElement).dataset.forgePort as string,
    ),
  );
}

test("a cell's port can be reached for and pressed", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await page.locator("[data-forge-kit-switch]").click();
  await expect(page.locator("[data-forge-cell-box]").first()).toBeVisible();

  const before = await lit(page);

  const cell = page.locator('[data-forge-cell-box="1,1"]');
  const box = await cell.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);

  // The eight show only for the cell under the pointer.
  const port = page.locator('[data-forge-port="1,1:e"]');
  await expect(port).toBeAttached();
  const at = await port.boundingBox();
  expect(at).not.toBeNull();

  // Reached for the way a hand reaches, not teleported onto.
  await page.mouse.move(at!.x + at!.width / 2, at!.y + at!.height / 2, { steps: 15 });
  // Still there, which is the half of it that used to fail.
  await expect(port).toBeAttached();
  await page.mouse.down();
  await page.mouse.up();

  const after = await lit(page);
  const turnedOn = after.filter((one) => !before.includes(one));
  const turnedOff = before.filter((one) => !after.includes(one));
  // Exactly the one aimed at, and not the neighbour's port at the same spot.
  expect(turnedOn).toEqual(["1,1:e"]);
  expect(turnedOff).toEqual([]);
});
