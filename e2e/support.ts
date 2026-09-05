import { existsSync, readFileSync } from "node:fs";

import { expect, type Page } from "@playwright/test";

export const FONT_CANDIDATES = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
];

export const FONT_PATH = FONT_CANDIDATES.find((path) => existsSync(path));

/**
 * The slider that drives a named family parameter.
 *
 * Found by the name it announces to a screen reader rather than by counting
 * along the panel. The count went out of step whenever a parameter was added,
 * silently pointing the test at the neighbouring control; and the label was
 * being read out of a span that has since gone, because the slider draws its
 * own. The accessible name is the one thing here that is meant to be stable.
 */
export async function paramSlider(page: Page, label: string) {
  const panel = page.getByRole("complementary", { name: "Parameters" });
  const slider = panel.getByRole("slider", { name: label });
  await expect(slider, `no family parameter called ${label}`).toBeVisible();
  return slider;
}

/** Open the test font through the file input the toolbar drives. */
/**
 * Take up a tool, through the group it lives in.
 *
 * The palette was a flat row of six and is now four groups of thirteen, so a
 * tool is reached either by its group button -- which carries whichever of the
 * group's tools was last used -- or through the flyout. This does what a person
 * does: press the group, and if what you want is not already showing, press
 * again for the list.
 */
export async function takeUpTool(page: Page, group: string, tool: string): Promise<void> {
  const button = page.locator(`[data-tool-group="${group}"]`);
  await button.click();
  if ((await page.locator(`[data-flyout-tool="${tool}"]`).count()) === 0) await button.click();
  await page.locator(`[data-flyout-tool="${tool}"]`).click();
  await expect(page.locator("[data-tool-flyout]")).toHaveCount(0);
}

export async function openFont(page: Page): Promise<void> {
  await page.setInputFiles("[data-open-input]", FONT_PATH!);
  // The toolbar reports the family once parsing finishes.
  await expect(page.getByText("DejaVu Sans", { exact: false }).first()).toBeVisible({
    timeout: 45_000,
  });
}

/**
 * A font with nothing in it, reached the way somebody would reach it.
 *
 * Through the palette rather than by calling the store, because starting again
 * throws away whatever is open and so asks first -- and because a test that
 * reaches past the confirmation is not testing the path anybody takes.
 */
export async function startBlank(page: Page): Promise<void> {
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("textbox", { name: "Search everything" }).fill("start a new font");
  await page.getByRole("dialog", { name: "Quick actions" }).getByRole("option").first().click();
  const confirm = page.getByRole("alertdialog").getByRole("button", { name: "Go on" });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
}

/** Count the opaque pixels on the largest canvas, as a proxy for the drawn shape. */
export async function measureInk(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvases = [...document.querySelectorAll("canvas")];
    const canvas = canvases.sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return 0;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 40) count++;
    return count;
  });
}

/** Drag a handle across the stage by a number of screen pixels. */
export async function dragHandle(page: Page, id: string, dx: number, dy: number): Promise<void> {
  const handle = page.locator(`[data-forge-handle="${id}"]`);
  // Hovering first waits for the thing to be there and to stop moving, so the
  // box measured is the box that is still under the pointer a moment later.
  await handle.hover();
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step++) {
    await page.mouse.move(x + (dx * step) / 10, y + (dy * step) / 10, { steps: 1 });
  }
  await page.mouse.up();
}

/**
 * Double-click a spot on the letter, given where that spot is in font units.
 *
 * Through the browser's own matrix rather than by working out where the letter
 * landed: the drawing is fitted into whatever room the window gave it, and a
 * second copy of that sum in the tests would be a second thing to keep right.
 */
export async function pressSpot(page: Page, x: number, y: number): Promise<void> {
  const at = await page.evaluate(
    ([fx, fy]) => {
      const svg = document.querySelector("[data-forge-stage]") as SVGSVGElement | null;
      const screen = svg?.getScreenCTM();
      if (!svg || !screen) return null;
      // The letter is drawn inside a flip, because font y runs up.
      const spot = new DOMPoint(fx, -fy).matrixTransform(screen);
      return { x: spot.x, y: spot.y };
    },
    [x, y],
  );
  if (!at) throw new Error("no stage to press");
  await page.mouse.dblclick(at.x, at.y);
}

export async function openForge(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await expect(page.locator("[data-forge-stage]")).toBeVisible();
  await settle(page);
}

/**
 * Wait for the first-run tip to be gone, not merely clicked.
 *
 * The tip is a row rather than an overlay, so dismissing it takes a line of
 * height out of the page and everything under it moves up -- and it does that a
 * hundred and fifty milliseconds after the click, once the fade has finished,
 * which is deliberate so a row of content does not jump under the pointer
 * mid-click.
 *
 * Clicking and carrying straight on meant a drag could measure where a handle
 * was, have the layout legitimately move under it, and then press forty pixels
 * below the thing it meant to press. Nothing changed, the test asked why, and
 * the answer had nothing to do with dragging. It never showed up on a fast
 * machine and failed twice in a row on a slow one.
 */
export async function settle(page: Page): Promise<void> {
  const mark = page.locator("[data-coach-mark]");
  /*
   * A bounded wait rather than a bare count.
   *
   * A mark puts itself in the running from an effect, and React runs effects
   * after the paint -- so the count taken the moment the stage turns visible
   * can read nought for a mark that is one commit away from showing. It then
   * arrives in the middle of the drag that follows, which is the exact thing
   * this function is here to prevent.
   *
   * Not every caller has a mark to dismiss, so nothing appearing is still a
   * real answer; it is just one worth waiting a moment for rather than reading
   * off the first frame.
   */
  try {
    await mark.waitFor({ state: "visible", timeout: 2_000 });
  } catch {
    return;
  }
  await mark.getByRole("button", { name: "Got it" }).click();
  await expect(mark).toHaveCount(0);
}

/*
 * The font library.
 *
 * The two services it reaches are somebody else's, and a test that depends on
 * them passing is a test that fails on a bad afternoon in a datacentre
 * somewhere. So the catalogue is answered here and the font files are served
 * out of the repository's own sample. What is being checked is this
 * application: that the list appears, that choosing a family measures it, that
 * the four things you can do with it do them, and that a service being down
 * leaves a usable picker rather than an empty one.
 */
export const CATALOGUE = [
  {
    id: "inter",
    family: "Inter",
    category: "sans-serif",
    weights: [400, 700],
    styles: ["normal"],
    variable: true,
  },
  {
    id: "playfair-display",
    family: "Playfair Display",
    category: "serif",
    weights: [400],
    styles: ["normal"],
    variable: false,
  },
  {
    id: "roboto-mono",
    family: "Roboto Mono",
    category: "monospace",
    weights: [400],
    styles: ["normal"],
    variable: false,
  },
];

/** Answer the catalogue, and serve the sample font for any file asked for. */
export async function stubLibrary(
  page: Page,
  options: { catalogue?: boolean } = {},
): Promise<void> {
  const bytes = readFileSync(FONT_PATH!);
  await page.route("**://api.fontsource.org/**", async (route) => {
    if (options.catalogue === false) {
      await route.fulfill({ status: 503, contentType: "text/plain", body: "no" });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(CATALOGUE),
    });
  });
  await page.route("**://fonts.googleapis.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/css",
      body: "@font-face{src:url(https://fonts.gstatic.com/s/x/v1/sample.ttf) format('truetype');}",
    });
  });
  await page.route("**://fonts.gstatic.com/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "font/ttf", body: bytes });
  });
  await page.route("**://cdn.jsdelivr.net/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "font/ttf", body: bytes });
  });
}

export async function openLibrary(page: Page): Promise<void> {
  await page.locator("[data-open-library]").click();
  await expect(page.getByRole("dialog", { name: "Font library" })).toBeVisible();
}

/*
 * Assembling a font out of drawings.
 *
 * The drawings are made here rather than kept as fixtures, because what they
 * are matters: a box of a known height and a wedge of the same height, drawn
 * on one canvas with a baseline a hundred units up from the bottom. That makes
 * every assertion below something with a right answer -- the box must land on
 * the cap height, and the wedge must be given less white than the box.
 */
export function drawing(
  inner: string,
  height = 800,
): { name: string; mimeType: string; buffer: Buffer } {
  return {
    name: "x.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 ${height}">${inner}</svg>`,
    ),
  };
}

/** A rectangle standing on the baseline, `tall` units high. */
export function bar(tall: number, wide = 300) {
  return drawing(`<rect x="50" y="${700 - tall}" width="${wide}" height="${tall}"/>`);
}

/** A triangle standing on the baseline, like an A with no crossbar. */
export function point(tall: number, wide = 600) {
  const top = 700 - tall;
  return drawing(`<polygon points="${50 + wide / 2},${top} ${50 + wide},700 50,700"/>`);
}

/** The same triangle upside down, like a V. */
export function funnel(tall: number, wide = 600) {
  const top = 700 - tall;
  return drawing(`<polygon points="50,${top} ${50 + wide},${top} ${50 + wide / 2},700"/>`);
}

export const PILE = [
  { ...bar(400), name: "H_.svg" },
  { ...bar(400, 120), name: "I_.svg" },
  { ...point(400), name: "A_.svg" },
  { ...funnel(400), name: "V_.svg" },
  { ...bar(280), name: "x.svg" },
];

export async function openAssemble(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Assemble", exact: true }).click();
  await expect(page.locator("[data-assemble-instructions]")).toBeVisible();
}

/** Put a drawing in a named box, as double-clicking it would. */
export async function fillBox(
  page: Page,
  character: string,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  await page.setInputFiles(`[data-assemble-box-input="${character}"]`, file);
  await expect(page.locator(`[data-assemble-box="${character}"]`)).toHaveAttribute(
    "data-assemble-filled",
    "yes",
  );
}

/** The bulk route, which still guesses characters from the file names. */
export async function dropFolder(
  page: Page,
  files: Array<{ name: string; mimeType: string; buffer: Buffer }>,
): Promise<void> {
  await page.setInputFiles("[data-assemble-panel-input]", files);
}

/** Drag a file onto something, which no file input can stand in for. */
export async function dragOnto(
  page: Page,
  selector: string,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  const transfer = await page.evaluateHandle(
    ({ name, mimeType, text }) => {
      const carried = new DataTransfer();
      carried.items.add(new File([text], name, { type: mimeType }));
      return carried;
    },
    { name: file.name, mimeType: file.mimeType, text: file.buffer.toString("utf8") },
  );
  const target = page.locator(selector);
  await target.dispatchEvent("dragover", { dataTransfer: transfer });
  await target.dispatchEvent("drop", { dataTransfer: transfer });
}

/**
 * Keeping the work.
 *
 * The two halves of this are not the same promise. A file is portable and
 * deliberate -- it answers "I want this on my other machine". Autosave is
 * neither, and answers the thing nobody plans for: the tab closed, the laptop
 * slept, the browser updated itself overnight. Only the second one can be
 * checked by reloading, and only the first can be checked by walking into a
 * browser that has never seen this person before, so both are here.
 */

/** The n in the alphabet, as its own outline. */
export function drawnN(page: Page): Promise<string | null> {
  return page.locator('[data-forge-cell="n"] path').first().getAttribute("d");
}

/**
 * The session as the browser has it written down.
 *
 * Read out of IndexedDB rather than waited for with a timer, because the write
 * is on a pause after the last edit and a timer would either be flaky or be
 * slow. This asks the actual question -- is it kept yet.
 */
export function keptHalves(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const request = indexedDB.open("typeforge", 1);
        request.onerror = () => resolve([]);
        request.onsuccess = () => {
          const database = request.result;
          const get = database
            .transaction("session", "readonly")
            .objectStore("session")
            .get("current");
          get.onerror = () => {
            database.close();
            resolve([]);
          };
          get.onsuccess = () => {
            database.close();
            const project = get.result as Record<string, unknown> | undefined;
            if (!project) {
              resolve([]);
              return;
            }
            resolve(["draw", "assemble", "edit"].filter((half) => project[half]));
          };
        };
      }),
  );
}

/**
 * Which letters the kept session says were touched.
 *
 * `keptHalves` answers whether a half is written down at all, which for the
 * edited half is true from the moment a font is open -- so a test that changes
 * a letter and waits on that is waiting for something that has already
 * happened, and reloads into a race with the save it actually wanted. This
 * asks the narrower question: is *this edit* written down yet.
 */
export function keptGlyphs(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const request = indexedDB.open("typeforge", 1);
        request.onerror = () => resolve([]);
        request.onsuccess = () => {
          const database = request.result;
          const get = database
            .transaction("session", "readonly")
            .objectStore("session")
            .get("current");
          get.onerror = () => {
            database.close();
            resolve([]);
          };
          get.onsuccess = () => {
            database.close();
            const project = get.result as { edit?: { glyphs?: Array<{ name?: string }> } };
            resolve((project?.edit?.glyphs ?? []).map((glyph) => glyph.name ?? ""));
          };
        };
      }),
  );
}

/**
 * The colour actually on the canvas, averaged over the pixels that were
 * painted.
 *
 * Not the token, and not the CSS: the pixels. The bug this exists to catch was
 * a canvas that read the right token at the wrong moment, so every declared
 * value in the document was correct and the letters were still the old colour.
 * Nothing short of reading the bitmap would have noticed.
 */
export async function inkLuminance(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector("[data-proof-page] canvas") as HTMLCanvasElement;
    const context = canvas.getContext("2d")!;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0;
    let painted = 0;
    // Solid pixels only. The edge of a letter is antialiased against nothing,
    // so a part-transparent pixel carries the colour diluted and would drag
    // the average towards the middle from both ends.
    for (let at = 0; at < data.length; at += 4) {
      if (data[at + 3] < 250) continue;
      sum += 0.2126 * data[at] + 0.7152 * data[at + 1] + 0.0722 * data[at + 2];
      painted += 1;
    }
    return painted === 0 ? -1 : sum / painted;
  });
}
