/**
 * Seeing what you are selecting while you are still selecting it.
 *
 * The box and the ring drew themselves and nothing else: a still outline, and
 * points that did not change until the button came up. So the whole of "which
 * of these two hundred points am I about to take" was answered after the fact,
 * by letting go and looking.
 *
 * Three things answer it now, and each is checked here by looking at the
 * canvas rather than at the store -- the complaint was about what is on screen,
 * and a store that holds the right answer while the screen says nothing is
 * exactly the state being fixed.
 */

import { expect, test, type Page } from "@playwright/test";

import { FONT_PATH, openFont } from "./support";

test.skip(!FONT_PATH, "needs a system font to open");

async function aLetterWithPoints(page: Page): Promise<void> {
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();
  await expect(page.locator("[data-glyph-canvas]")).toBeVisible();
}

/** The whole canvas as a string, for asking whether anything changed. */
function frame(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("[data-glyph-canvas]");
    return canvas ? canvas.toDataURL() : "";
  });
}

/**
 * How many warm pixels the canvas has: the points drawn as selected.
 *
 * Counted as "much more red than blue" rather than matched against the token
 * itself, and that is not laziness. The marquee lays a wash of accent over
 * everything inside it, so a lit point *under* the box is the selected orange
 * blended with blue -- near enough to be plainly orange to a person, far
 * enough that an exact match finds none of them. Asked exactly, this test
 * reported zero while the screen showed a box full of orange dots.
 *
 * The rest of the canvas cannot be mistaken for it. The accent is blue, the
 * outline is blue, and the grounds are grey; only a selected point is warm.
 */
function selectedPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("[data-glyph-canvas]");
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return -1;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let warm = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 200 && data[i] - data[i + 2] > 60) warm++;
    }
    return warm;
  });
}

/** Press in one corner of the canvas and drag most of the way across it. */
async function startSweeping(page: Page): Promise<void> {
  const box = (await page.locator("[data-glyph-canvas]").boundingBox())!;
  await page.mouse.move(box.x + 12, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.8, { steps: 12 });
}

test("points light up while the box is still being dragged", async ({ page }) => {
  /*
   * The complaint itself. Nothing was lit until the button came up, so the
   * answer to "what am I about to take" arrived only after taking it.
   */
  await aLetterWithPoints(page);

  /*
   * A lit point is a filled square four or five pixels across, so it costs
   * something like twenty warm pixels. Anything under one point's worth is the
   * antialiasing on something else -- there are two, consistently -- and
   * demanding a clean zero would be a test failing on a rounded edge.
   */
  const A_POINT = 16;
  const before = await selectedPixels(page);
  expect(before, "nothing is lit yet").toBeLessThan(A_POINT);

  await startSweeping(page);
  const during = await selectedPixels(page);
  await page.mouse.up();

  expect(during, "the points under the box are lit before the button comes up").toBeGreaterThan(
    A_POINT * 4,
  );

  /*
   * And they are still lit after, which is as much as pixels can say here.
   *
   * Not the same count: mid-drag the points are under the box's wash and some
   * are still wearing their flash ring, so the warm total is larger while the
   * shape is out. The claim worth making -- that the points shown are the
   * points taken -- is not one a pixel count can carry, and it is held where
   * it belongs instead: both the preview and the release ask the same function
   * for the answer, and `glyph-catch.test.ts` is where that rule is pinned.
   */
  expect(await selectedPixels(page), "and still lit once it is let go").toBeGreaterThan(
    A_POINT * 4,
  );
});

test("the ants keep marching while the hand is still", async ({ page }) => {
  /*
   * The half that is easy to get wrong, and the reason the canvas cannot
   * repaint on the pointer alone: a hand held over a letter deciding is
   * exactly when somebody is looking hardest, and a dashed line that freezes
   * the moment they stop moving says the tool has stopped listening.
   *
   * Sampled after the flashes have died down, so what is still changing
   * between the two frames can only be the dashes.
   */
  await aLetterWithPoints(page);
  await startSweeping(page);
  await page.waitForTimeout(500);

  const first = await frame(page);
  await page.waitForTimeout(150);
  const second = await frame(page);
  await page.mouse.up();

  expect(first).not.toBe("");
  expect(second, "the dashes have to crawl with no pointer movement at all").not.toBe(first);
});

/**
 * How many frames the page asks for over a stretch of time.
 *
 * Counted rather than looked at, because a loop left running after the button
 * comes up draws the same picture every frame -- so two screenshots agree and
 * say nothing at all. Asked of the picture, this test passed with the stop
 * taken out, which is the definition of a test that is not testing anything.
 */
async function framesAsked(page: Page, ms: number): Promise<number> {
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number; __raf?: typeof requestAnimationFrame };
    w.__frames = 0;
    w.__raf = w.__raf ?? window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      w.__frames++;
      return w.__raf!(callback);
    };
  });
  await page.waitForTimeout(ms);
  return page.evaluate(() => (window as unknown as { __frames: number }).__frames);
}

test("the clock runs only while the button is down", async ({ page }) => {
  /*
   * The other side of the marching. A canvas that keeps repainting after the
   * drag is a fan that never settles, and nothing on screen would say so --
   * the picture is right, it is simply being drawn sixty times a second for
   * ever.
   *
   * An idle editor asks for no frames at all, which is what makes this
   * readable: the number during a drag is the loop, and the number after it
   * should be the idle one again.
   */
  await aLetterWithPoints(page);
  expect(await framesAsked(page, 400), "an idle letter animates nothing").toBeLessThan(3);

  await startSweeping(page);
  const during = await framesAsked(page, 400);
  await page.mouse.up();
  const after = await framesAsked(page, 400);

  expect(during, "the ants need a frame each while the shape is out").toBeGreaterThan(10);
  expect(after, "and none once it is let go").toBeLessThan(3);
});
