/**
 * The keys, for a hand that already knows where it is going.
 *
 * The palette reaches everything and is the right answer for five hundred
 * controls nobody remembers a key for. It is the wrong answer for saving: a
 * person who saves forty times an afternoon should not open a search to do it.
 *
 * These pin the few that are bound directly, that a bare number stands aside
 * for anything being typed into, and that the palette prints the key beside the
 * slow way to the same thing -- which is where a shortcut is actually learnt.
 */
import { expect, test, type Page } from "@playwright/test";

/*
 * Control rather than Command throughout. Both are accepted, for the reason
 * argued in `useShortcut`: `metaKey` is the Windows key on a PC, and the tests
 * run on one.
 */
async function sample(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the sample font" }).click();
  await expect(page.getByText("221 glyphs", { exact: true })).toBeVisible({ timeout: 45_000 });
}

const pressed = (page: Page, tab: string) =>
  expect(page.getByRole("button", { name: tab, exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

test("the six views answer to their own numbers", async ({ page }) => {
  await sample(page);

  for (const [key, tab] of [
    ["3", "Kerning"],
    ["5", "Proof"],
    ["2", "Glyph"],
    ["6", "Checks"],
    ["4", "Spacing"],
    ["1", "Font"],
  ] as const) {
    await page.keyboard.press(key);
    await pressed(page, tab);
  }
});

test("a number typed into a field is a number", async ({ page }) => {
  await sample(page);
  await page.keyboard.press("3");
  await pressed(page, "Kerning");

  /*
   * The whole risk of binding a bare key: somebody filtering the pair list
   * types "2" and the view changes underneath them. This is the guard the
   * palette's space bar needed first, which is why it now lives on its own.
   */
  const filter = page.getByRole("textbox", { name: "Filter kerning pairs" });
  await filter.fill("");
  await filter.press("2");
  await expect(filter).toHaveValue("2");
  await pressed(page, "Kerning");
});

test("the file keys stand through typing, because a chord is never a character", async ({
  page,
}) => {
  await sample(page);
  await page.keyboard.press("3");
  const filter = page.getByRole("textbox", { name: "Filter kerning pairs" });
  await filter.click();

  await page.keyboard.press("Control+e");
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("the line under the toolbar answers to the key it prints", async ({ page }) => {
  await sample(page);

  // The sample has nothing kerned, so the line is offering kerning.
  const line = page.locator("[data-next-step]");
  await expect(line).toHaveAttribute("data-next-step", "edit-kern");
  await expect(line.getByRole("button", { name: "Open kerning" })).toHaveAttribute(
    "title",
    "Open kerning (⌘⏎)",
  );

  await page.keyboard.press("Control+Enter");
  await pressed(page, "Kerning");
});

test("the palette prints the key beside the slow way to the same thing", async ({ page }) => {
  await sample(page);
  await page.keyboard.press("Control+k");

  const search = page.getByRole("textbox", { name: "Search everything" });
  await search.fill("save the project");
  const row = page.getByRole("option").first();
  await expect(row).toContainText("Save the project");
  await expect(row.locator("[data-item-keys]")).toHaveText("⌘S");
});
