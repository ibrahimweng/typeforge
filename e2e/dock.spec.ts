/**
 * The column of panels, and the four things a person can now decide about it.
 *
 * Every one of these is a preference rather than a piece of work, which is why
 * they are tested through a reload. A dock you can rearrange and that forgets
 * by morning is worse than one that was never rearrangeable: you set it up
 * once, find it gone, and stop bothering. So each test here changes something
 * and then asks the same question after the page has been thrown away and
 * built again.
 */

import { expect, test } from "@playwright/test";

import { openFont } from "./support";

type Page = import("@playwright/test").Page;

async function openAFont(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto("/");
  await openFont(page);
  await expect(page.locator("[data-dock]")).toBeVisible();
}

/**
 * Coming back to the application later, which is what these tests are about.
 *
 * A fresh page and the font opened again, rather than a reload. The layout
 * lives in this browser and survives either; the font does not necessarily,
 * because whether a reload finds a session to restore depends on when the last
 * write landed. Reloading made these tests fail some of the time for a reason
 * that had nothing to do with the dock, which is the worst kind of test there
 * is. Opening the font again asks the question that is actually being asked.
 */
async function comeBack(page: Page): Promise<void> {
  await page.goto("/");
  await openFont(page);
  await expect(page.locator("[data-dock]")).toBeVisible();
}

/** The panels on screen, in the order they are drawn. */
const arrangement = (page: Page): Promise<string[]> =>
  page
    .locator("[data-dock] [data-panel]")
    .evaluateAll((all) => all.map((one) => one.getAttribute("data-panel") ?? ""));

const dockWidth = async (page: Page): Promise<number> =>
  (await page.locator("[data-dock]").boundingBox())!.width;

/*
 * Nothing clears the remembered layout between tests, and nothing should.
 *
 * Playwright gives each test its own browser context with empty storage, so
 * every one of these starts from the layout the application ships with. The
 * first version of this file cleared the record in an init script, which runs
 * on every navigation -- including the reload each test uses to ask whether
 * the record survived. It wiped the thing under test and then reported that it
 * had not survived.
 */

test("the dock can be made wider, and is still that wide tomorrow", async ({ page }) => {
  await openAFont(page);
  const before = await dockWidth(page);

  const handle = page.locator("[data-dock-resize]");
  const grip = (await handle.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 200);
  await page.mouse.down();
  // Leftwards is wider, because the dock is on the right.
  await page.mouse.move(grip.x - 90, grip.y + 200, { steps: 10 });
  await page.mouse.up();

  const widened = await dockWidth(page);
  expect(widened, "dragging the edge left should widen the dock").toBeGreaterThan(before + 60);

  await comeBack(page);
  expect(Math.abs((await dockWidth(page)) - widened)).toBeLessThan(2);
});

test("the edge answers the keyboard, since a keyboard cannot drag", async ({ page }) => {
  await openAFont(page);
  const before = await dockWidth(page);

  await page.locator("[data-dock-resize]").focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  expect(await dockWidth(page)).toBeGreaterThan(before);

  // And it stops rather than eating the canvas, however long the key is held.
  for (let press = 0; press < 40; press++) await page.keyboard.press("Shift+ArrowLeft");
  const widest = await dockWidth(page);
  expect(widest).toBeLessThanOrEqual(561);
  expect(widest).toBeGreaterThan(before);
});

test("a panel can be furled, and stays furled", async ({ page }) => {
  await openAFont(page);
  const params = page.locator("[data-panel='params']");
  await expect(params).toBeVisible();
  // The sliders are what furling puts away, so they are what is asked about.
  await expect(params.getByRole("slider").first()).toBeVisible();

  await page.locator("[data-panel-furl='params']").click();
  await expect(params.getByRole("slider")).toHaveCount(0);
  await expect(page.locator("[data-panel-furl='params']")).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  await comeBack(page);
  await expect(page.locator("[data-panel='params']").getByRole("slider")).toHaveCount(0);

  // And back, which has to be as easy as furling it was.
  await page.locator("[data-panel-furl='params']").click();
  await expect(page.locator("[data-panel='params']").getByRole("slider").first()).toBeVisible();
});

test("a panel put away can be got back, and the menu is the way", async ({ page }) => {
  await openAFont(page);
  await expect(page.locator("[data-panel='start']")).toBeVisible();

  await page.locator("[data-panels-menu]").click();
  await page.locator("[data-panel-toggle='start']").click();
  await expect(page.locator("[data-panel='start']")).toHaveCount(0);
  // The menu stays open, because putting several away is one decision.
  await expect(page.locator("[data-panel-toggle='start']")).toHaveAttribute(
    "aria-checked",
    "false",
  );

  await page.keyboard.press("Escape");
  await comeBack(page);
  await expect(page.locator("[data-panel='start']")).toHaveCount(0);

  await page.locator("[data-panels-menu]").click();
  await page.locator("[data-panel-toggle='start']").click();
  await expect(page.locator("[data-panel='start']")).toBeVisible();
});

test("panels can be reordered from the keyboard alone", async ({ page }) => {
  /*
   * The half of reordering that is not a drag. A drag is what a designer will
   * reach for and it is unreachable without a pointer, so the same move is on
   * the arrows with a modifier -- and both go through one function, so the two
   * cannot come to disagree.
   */
  await openAFont(page);
  const was = await arrangement(page);
  expect(was.length, "the dock should have panels to reorder").toBeGreaterThan(1);

  const second = was[1];
  await page.locator(`[data-panel-furl='${second}']`).focus();
  await page.keyboard.press("Alt+ArrowUp");

  const now = await arrangement(page);
  expect(now[0], `${second} should have moved to the top`).toBe(second);
  expect(now[1]).toBe(was[0]);

  await comeBack(page);
  expect(await arrangement(page)).toEqual(now);
});

test("a panel dragged past its neighbour lands after it, not beyond it", async ({ page }) => {
  /*
   * The off-by-one, asked of the real thing. Counting the panels above the
   * pointer rather than the panel it would sit before is what makes a downward
   * drag land where the hand asked; the arithmetic has its own test, and this
   * says the drag is wired to it.
   */
  await openAFont(page);
  const was = await arrangement(page);
  const first = was[0];
  const second = was[1];

  const from = (await page.locator(`[data-panel-header='${first}']`).boundingBox())!;
  const onto = (await page.locator(`[data-panel-header='${second}']`).boundingBox())!;

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  /*
   * A small move first, to get the drag started before it is aimed.
   *
   * The pointer sensor waits for a few pixels before it calls this a drag
   * rather than a click, and it arms itself on the first move after the press.
   * Going straight to the target in one sweep of interpolated moves can have
   * the whole journey counted as the arming move, and the panel never travels
   * -- which is what Firefox did here: the order came back untouched, as if
   * nothing had been dragged at all.
   */
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 8);
  // Just past the second panel's middle, which asks for one place down.
  await page.mouse.move(onto.x + onto.width / 2, onto.y + onto.height / 2 + 4, { steps: 8 });
  await page.mouse.up();

  const now = await arrangement(page);
  console.log("DOCK DIAGNOSTIC:", JSON.stringify({ was, now, first, second, from, onto }));
  expect(now[0]).toBe(second);
  expect(now[1], `${first} should be second, not further down`).toBe(first);
  expect(now.slice(2)).toEqual(was.slice(2));
});

test("everything can be put back the way it shipped", async ({ page }) => {
  await openAFont(page);
  const shipped = await arrangement(page);
  const width = await dockWidth(page);

  await page.locator("[data-panel-furl='params']").click();
  await page.locator("[data-panels-menu]").click();
  await page.locator("[data-panel-toggle='start']").click();
  await page.keyboard.press("Escape");
  await page.locator(`[data-panel-furl='${shipped[1]}']`).focus();
  await page.keyboard.press("Alt+ArrowUp");
  expect(await arrangement(page)).not.toEqual(shipped);

  await page.locator("[data-panels-menu]").click();
  await page.locator("[data-reset-layout]").click();

  await expect(page.locator("[data-panel='start']")).toBeVisible();
  expect(await arrangement(page)).toEqual(shipped);
  expect(Math.abs((await dockWidth(page)) - width)).toBeLessThan(2);
  await expect(page.locator("[data-panel='params']").getByRole("slider").first()).toBeVisible();
});
