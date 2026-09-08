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

  /*
   * Furled first, so the header being dragged onto is somewhere a hand could
   * reach it.
   *
   * Open, the first panel is around eleven hundred pixels of controls and its
   * neighbour's header sits at y=1323 in a window 950 high -- off the bottom
   * of the screen. This test used to aim at it anyway and pass, because
   * Chromium lets a driven pointer go outside the viewport. Firefox clamps it
   * to the edge, so the drag landed short, worked out that it belonged where
   * it started, and put it back: `data-panel-carried` said one panel was in
   * hand the whole time, which is what ruled out the drag never starting.
   *
   * Chromium was the one being generous. A person cannot drop a panel on a
   * header they cannot see, so the test should not have been able to either.
   * Furling puts the headers together at the top, which is the state somebody
   * reordering panels would put the dock in anyway.
   */
  for (const id of was) await page.locator(`[data-panel-furl='${id}']`).click();
  await expect(page.locator(`[data-panel-furl='${second}']`)).toHaveAttribute(
    "aria-expanded",
    "false",
  );

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

  /*
   * Read while the panel is still in hand.
   *
   * `data-panel-carried` is set for as long as one is being carried, so this
   * tells apart the two ways this can look identical from the outside: a drag
   * that never started, and a drag that started and worked out that it should
   * land exactly where it began.
   */
  const carried = await page
    .locator("[data-panel-carried='true']")
    .count()
    .catch(() => -1);
  await page.mouse.up();

  const now = await arrangement(page);
  /*
   * The evidence rides on the failure rather than on every run.
   *
   * This one took five runs to pin down, and every one of them turned on
   * numbers a plain "expected shaping, received params" does not carry: where
   * the two headers actually were, and whether a panel was in hand at all.
   * Kept here, they cost nothing while it passes and are the first thing
   * anybody needs the moment it does not.
   */
  const seen = `from y=${from.y} onto y=${onto.y}, carried=${carried}, was ${was.join()}, now ${now.join()}`;
  expect(now[0], seen).toBe(second);
  expect(now[1], `${first} should be second, not further down`).toBe(first);
  expect(now.slice(2)).toEqual(was.slice(2));
});

test("a panel says which panel it is however far into it you have scrolled", async ({ page }) => {
  /*
   * The dock is taller than the window and always was going to be: six panels
   * of controls come to well over three thousand pixels in a column seven
   * hundred and sixty high. Scrolling is the answer to that and it works --
   * but a panel taller than the column used to take its own name off the
   * screen with it, and at the bottom of the column not one header was left.
   * You scroll into a stack of sliders with nothing saying whose they are.
   *
   * The header is also the handle for reordering and the button for furling,
   * so losing it loses both. Stuck to the top of the column, it is there
   * wherever you are.
   */
  await openAFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();
  await expect(page.locator("[data-panel]").first()).toBeVisible();

  const headersInView = () =>
    page.evaluate(() => {
      const column = document.querySelector<HTMLElement>("[data-panel]")!.parentElement!;
      const box = column.getBoundingClientRect();
      return [...document.querySelectorAll("[data-panel-header]")]
        .filter((one) => {
          const at = one.getBoundingClientRect();
          return at.top >= box.top - 1 && at.bottom <= box.bottom + 1;
        })
        .map((one) => one.getAttribute("data-panel-header"));
    });

  const reach = await page.evaluate(() => {
    const column = document.querySelector<HTMLElement>("[data-panel]")!.parentElement!;
    return column.scrollHeight - column.clientHeight;
  });
  expect(reach, "this test needs a column taller than its window").toBeGreaterThan(200);

  // Every way down it, including the very bottom, where there used to be none.
  for (const part of [0, 0.25, 0.5, 0.75, 1]) {
    await page.evaluate((fraction) => {
      const column = document.querySelector<HTMLElement>("[data-panel]")!.parentElement!;
      column.scrollTop = (column.scrollHeight - column.clientHeight) * fraction;
    }, part);
    await page.waitForTimeout(120);
    expect(
      (await headersInView()).length,
      `nothing said which panel you were in, ${Math.round(part * 100)}% down`,
    ).toBeGreaterThan(0);
  }
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
