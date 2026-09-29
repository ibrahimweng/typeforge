/**
 * The Draw and Edit pages show whole letters, and say true things about them.
 *
 * Each of these was found by walking the application: a picker and a proof
 * that cropped the letters they showed, a title that said the base twice,
 * controls that moved and changed nothing, and a grid whose widened letters
 * ran out of their cells.
 */

import { expect, type Locator, type Page, test } from "@playwright/test";

import { openForge, paramSlider } from "./support";

/** Pick a base on the Draw page. */
async function drawFrom(page: Page, base: string): Promise<void> {
  await openForge(page);
  await page.getByRole("button", { name: base, exact: true }).click();
  await expect(page.locator(`[data-forge-base="${base}"]`).first()).toBeVisible();
}

/**
 * How far the ink in each svg reaches past its viewBox, in font units. The
 * letters are drawn in a group flipped with scale(1,-1), so the box the group
 * reports is turned back over before it is compared.
 */
function overflowOf(svgs: Locator): Promise<Array<{ name: string; over: number }>> {
  return svgs.evaluateAll((all) =>
    all.flatMap((svg) => {
      const group = (svg as SVGSVGElement).querySelector("g");
      if (!group?.querySelector("path[d]:not([d=''])")) return [];
      // The stage draws its guides and handles in the same group; only the
      // letter itself is measured there.
      const letter = svg.hasAttribute("data-forge-stage")
        ? group.querySelector('path[fill="var(--foreground)"]')
        : group;
      const box = (letter as SVGGraphicsElement).getBBox();
      const view = (svg as SVGSVGElement).viewBox.baseVal;
      const top = -(box.y + box.height);
      const bottom = -box.y;
      const over = Math.max(
        view.y - top,
        bottom - (view.y + view.height),
        view.x - box.x,
        box.x + box.width - (view.x + view.width),
        0,
      );
      const name =
        svg.closest("[data-forge-cell]")?.getAttribute("data-forge-cell") ??
        svg.closest("[data-forge-form]")?.getAttribute("data-forge-form") ??
        svg.getAttribute("data-forge-specimen-line") ??
        "?";
      return [{ name, over }];
    }),
  );
}

const cropped = (found: Array<{ name: string; over: number }>) =>
  found.filter((one) => one.over > 1).map((one) => one.name);

test("the alternates of g and y are shown whole", async ({ page }) => {
  for (const base of ["Sans", "Serif"]) {
    await drawFrom(page, base);
    for (const letter of ["g", "y"]) {
      await page.locator(`[data-forge-cell="${letter}"]`).click();
      const forms = page.locator(`[data-forge-forms="${letter}"]`);
      await expect(forms).toBeVisible();
      const found = await overflowOf(forms.locator("svg"));
      expect(found.length, `${base} ${letter} forms`).toBeGreaterThan(1);
      expect(cropped(found), `${base} ${letter} forms cropped`).toEqual([]);
    }
  }
});

test("the specimen line keeps accents and descenders", async ({ page }) => {
  await drawFrom(page, "Serif");
  await page.locator("input[data-forge-specimen]").fill("ÅÉgyjpQ Çą");
  const line = page.locator("svg[data-forge-specimen-line]");
  await expect(line.first()).toBeVisible();
  expect(cropped(await overflowOf(line))).toEqual([]);
});

test("the letters in the strip keep their accents, overshoots and shadows", async ({ page }) => {
  await drawFrom(page, "Sans");
  const cells = ["O", "g", "Aring", "Eacute", "Odieresis", "ccedilla"];
  const strip = page.locator(cells.map((name) => `[data-forge-cell="${name}"] svg`).join(", "));
  for (const name of cells)
    await page.locator(`[data-forge-cell="${name}"]`).scrollIntoViewIfNeeded();
  await expect
    .poll(async () => (await overflowOf(strip)).length, { message: "cells drawn" })
    .toBe(cells.length);
  expect(cropped(await overflowOf(strip))).toEqual([]);

  // A shadow thrown down past the descender, on the strip and on the stage.
  await page.locator('[data-cut-switch="extrude"]').click();
  await page.locator('[data-forge-cell="y"]').click();
  await expect.poll(async () => cropped(await overflowOf(strip)), { timeout: 20_000 }).toEqual([]);
  await expect
    .poll(async () => cropped(await overflowOf(page.locator("svg[data-forge-stage]"))))
    .toEqual([]);
});

test("the title names the base once", async ({ page }) => {
  await drawFrom(page, "Sans");
  await page.getByRole("button", { name: "Serif", exact: true }).click();
  const bar = page.getByText("My Serif", { exact: false }).first();
  await expect(bar).toBeVisible();
  await expect(page.getByText(/My Serif\s+Serif/)).toHaveCount(0);
  // And the status bar says what is open here, not "Nothing open", and names
  // no tool from a rail this page does not have.
  const status = page.locator("[data-status-bar]");
  await expect(status.locator("[data-status-document]")).toHaveText("My Serif — drawn from Serif");
  await expect(status.locator("[data-status-tool]")).toHaveCount(0);
});

test("a part's controls go quiet when the part has no use for them", async ({ page }) => {
  await drawFrom(page, "Sans");
  const slab = page.locator('[data-forge-part="slab"]');
  // With the serifs off, Reach does nothing, and says why.
  await expect(slab.locator("[data-forge-idle]").first()).toContainText("Turn the switch");
  await expect(slab.locator("[inert]").first()).toBeAttached();
  await slab.getByRole("switch", { name: "Serifs" }).click();
  await expect(slab.locator("[data-forge-idle]")).toHaveCount(0);

  const terminal = page.locator('[data-forge-part="terminal"]');
  await terminal.getByRole("button", { name: "Round", exact: true }).click();
  await expect(terminal.locator("[data-forge-idle]")).toContainText("Angled");
  await terminal.getByRole("button", { name: "Angled", exact: true }).click();
  await expect(terminal.locator("[data-forge-idle]")).toHaveCount(0);
});

test("a widened letter stays inside its cell in the font grid", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles("[data-open-input]", "src/assets/typeforge-sample.ttf");
  await expect(page.locator('[data-glyph-cell="m"]')).toBeVisible({ timeout: 45_000 });
  const width = await paramSlider(page, "Width");
  await width.evaluate((element) => {
    const input = element as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "1.5");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(width).toHaveAttribute("aria-valuenow", "1.5");

  // Nothing painted in the outermost columns of the canvas, so nothing was cut
  // off at the edge. A check on the whole path rather than a test of the cap
  // that shrinks a letter wider than its cell (`maxWidth` in glyph-render.ts):
  // at the widest settings this font's W still fills only four fifths of the
  // cell, so the cap never acts here. glyph-render.test.ts tests it directly.
  for (const name of ["m", "w", "W", "M"]) {
    const cell = page.locator(`[data-glyph-cell="${name}"] canvas`);
    await cell.scrollIntoViewIfNeeded();
    await expect
      .poll(
        () =>
          cell.evaluate((canvas) => {
            const c = canvas as HTMLCanvasElement;
            const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
            let inked = 0;
            let edge = 0;
            for (let y = 0; y < c.height; y++) {
              for (let x = 0; x < c.width; x++) {
                if (data[(y * c.width + x) * 4 + 3] < 16) continue;
                inked++;
                if (x < 2 || x >= c.width - 2) edge++;
              }
            }
            return inked > 0 ? edge : -1;
          }),
        { message: `${name} touches the edge of its cell` },
      )
      .toBe(0);
  }
});

test("a warning about an earlier font is not shown as current", async ({ page }) => {
  await drawFrom(page, "Serif");
  const breaks = page.locator('[data-cut-switch="split"]');
  await breaks.scrollIntoViewIfNeeded();
  await breaks.click();
  const closing = page.locator("[data-forge-warnings]", { hasText: "Counters closing up" });
  await expect(closing).toBeVisible({ timeout: 30_000 });
  await expect(closing).not.toHaveAttribute("data-forge-warnings-stale", "yes");

  // Switched off again: the warning was about the breaks, so the moment they
  // are gone it is either gone too or marked as being rechecked.
  await breaks.click();
  const current = await page.evaluate(
    () =>
      [...document.querySelectorAll("[data-forge-warnings]")].filter(
        (bar) =>
          bar.textContent?.includes("Counters closing up") &&
          bar.getAttribute("data-forge-warnings-stale") !== "yes",
      ).length,
  );
  expect(current, "a warning about the breaks shown as current after they went").toBe(0);
  await expect(closing).toHaveCount(0, { timeout: 30_000 });
});
