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

import { FONT_PATH, openFont, takeUpTool } from "./support";

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
 * How many pixels of the canvas are the orange a selected point is drawn in.
 *
 * Not matched against the token exactly, and that is not laziness. The marquee
 * lays a wash of accent over everything inside it, so a lit point *under* the
 * box is the selected orange blended with blue -- plainly orange to a person,
 * far enough off the token that an exact match finds none of them. Asked
 * exactly, this test reported zero while the screen showed a box full of dots.
 *
 * So it is asked as a hue instead, on two axes, and the second one is the
 * point. Red-against-blue alone is not "the selected orange": the baseline
 * guide is red too, and it draws its name across the canvas in that red on
 * every frame. Whether those letters land dark enough to be counted comes down
 * to how hard a browser rasterises 10px text -- two pixels of it on Chromium,
 * a hundred and fifty on WebKit, which is a browser difference standing in a
 * place that has nothing to do with browsers. Green-against-blue tells the two
 * apart with the whole spectrum to spare: the selected orange sits at 103 under
 * the wash and 129 without it, and the baseline red at 1.
 *
 * Nothing else on the canvas is orange. The accent and the outline are blue,
 * the grounds are grey, and the one other warm token -- the ring around a
 * fault, at 57 -- is below the line and is not drawn unless the faults toggle
 * is turned on, which it is not here.
 */
function selectedPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("[data-glyph-canvas]");
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return -1;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let orange = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [red, green, blue, alpha] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
      if (alpha > 200 && red - blue > 60 && green - blue > 70) orange++;
    }
    return orange;
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
   * something like twenty pixels of orange. Asked for the hue rather than for
   * warmth, an untouched letter comes back at a clean zero -- but the budget of
   * one point stays, because a test that insists on zero is a test that fails
   * the day something picks up a rounded orange edge.
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
   * are still wearing their flash ring, so the orange total is larger while the
   * shape is out. The claim worth making -- that the points shown are the
   * points taken -- is not one a pixel count can carry, and it is held where
   * it belongs instead: both the preview and the release ask the same function
   * for the answer, and `glyph-catch.test.ts` is where that rule is pinned.
   */
  expect(await selectedPixels(page), "and still lit once it is let go").toBeGreaterThan(
    A_POINT * 4,
  );
});

/**
 * The most strongly blue horizontal row on the canvas, as a pixel count.
 *
 * Written because of what was missing: every test here checked the points a
 * shape had caught and none checked that the shape itself was on screen. The
 * box could have stopped drawing entirely and all of them would still pass --
 * the points would light, the frames would tick -- while the complaint that
 * started this ("I click and drag and nothing appears") came straight back.
 *
 * A row rather than a total, because the marquee's edge is the one horizontal
 * run of accent on this canvas. The metric lines are grey, the baseline is
 * red, the guides are vertical, and a letter's own nodes are scattered dots
 * that never fill a row. So the busiest blue row is the box's edge or it is
 * nothing much at all, and the two are far apart.
 */
function bluestRow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("[data-glyph-canvas]");
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return -1;
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
    let most = 0;
    for (let y = 0; y < height; y++) {
      let run = 0;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3] > 200 && data[i + 2] - data[i] > 100) run++;
      }
      most = Math.max(most, run);
    }
    return most;
  });
}

test("the box draws itself, and not only the points it is taking", async ({ page }) => {
  /*
   * The complaint, in the form it actually arrived in: press, drag, and the
   * canvas stays exactly as it was until the button comes up.
   *
   * Checked on the shape rather than on the selection, because those are two
   * claims and only one of them was ever being made here.
   */
  await aLetterWithPoints(page);
  const before = await bluestRow(page);

  await startSweeping(page);
  const during = await bluestRow(page);
  await page.mouse.up();

  /*
   * The box is swept across most of the canvas, so its edge is hundreds of
   * pixels wide and dashed four on, three off -- better than half of that. An
   * idle letter has no horizontal run of accent at all worth the name.
   */
  expect(during, "the box has to be on screen while it is being dragged").toBeGreaterThan(
    before + 100,
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

  /*
   * A whole second at each of the three, rather than the four tenths this
   * asked for first.
   *
   * Not to make the numbers kinder -- a longer look makes both halves of the
   * claim harder to satisfy by accident. The drag has more time to prove it is
   * animating, and the release has more time to betray a loop that did not
   * really stop.
   *
   * Four tenths was too short to say anything on a slow browser. A loaded
   * WebKit runner managed nine frames in that window where a chromium one
   * managed thirty, and nine against a bar of ten is a red build about the
   * runner rather than about the code -- the loop was marching the whole time.
   */
  const WATCH = 1000;
  const idle = await framesAsked(page, WATCH);
  expect(idle, "an idle letter animates nothing").toBeLessThan(5);

  await startSweeping(page);
  const during = await framesAsked(page, WATCH);
  await page.mouse.up();
  const after = await framesAsked(page, WATCH);

  /*
   * Twelve in a second is twelve frames a second, which is half the rate the
   * slowest runner seen here managed and a fifth of a healthy one. Below that
   * nothing is marching; there is no rate between "animating" and "stopped"
   * for this to land in by accident.
   */
  expect(during, "the ants need a frame each while the shape is out").toBeGreaterThan(12);
  expect(after, "and none once it is let go").toBeLessThan(5);
});

test("picking a whole shape says which shape, before it is picked", async ({ page }) => {
  /*
   * The tool that showed nothing at all.
   *
   * It takes its shape on the press and sets no drag, so there was no gesture
   * to draw and none was drawn: press, nothing, let go, a transform box. That
   * is the same complaint the box and the ring were fixed for, and this tool
   * was not touched because none of this file's tests could reach it -- they
   * all drag, and this one does not.
   *
   * Sat one press of `V` away from the box the whole time, since a group key
   * walks the group rather than staying on it.
   */
  await aLetterWithPoints(page);
  await takeUpTool(page, "select", "selectPath");
  const canvas = page.locator("[data-glyph-canvas]");
  const box = (await canvas.boundingBox())!;

  // Off the letter: nothing is ringed, because nothing would be taken.
  await page.mouse.move(box.x + box.width * 0.06, box.y + box.height * 0.9);
  await page.waitForTimeout(150);
  const away = await bluestRow(page);

  // Over a stem: the shape it would take is ringed.
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.26);
  await page.waitForTimeout(150);
  const over = await bluestRow(page);

  expect(over, "the shape under the pointer has to be ringed").toBeGreaterThan(away + 20);
});
