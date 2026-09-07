/**
 * Several fonts open at once, from the outside.
 *
 * The store tests beside `documents.ts` prove the swap carries the right
 * things. What they cannot prove is that the fonts arrive at all: a font comes
 * in by four doors, and when this was first wired two of them were still
 * replacing whatever was in front of you. The one anybody actually uses -- the
 * file picker -- was one of the two.
 *
 * So these go in through the picker.
 */

import { expect, test, type Page } from "@playwright/test";

import { FONT_PATH, keptFonts, keptHalves, openFont, startBlank } from "./support";

test.skip(!FONT_PATH, "needs a system font to open");

const tabs = "[data-document-tabs]";

/**
 * Drag one tab onto another, far enough past its middle to land beyond it.
 *
 * Onto the far side of the target rather than onto its middle, because the
 * landing is decided by which middles the pointer has passed -- so a drop
 * exactly on a middle is the one position the answer is allowed to differ in.
 */
async function dragTab(page: Page, moving: string, onto: string): Promise<void> {
  const from = (await page.locator(`[data-document-tab="${moving}"]`).boundingBox())!;
  const to = (await page.locator(`[data-document-tab="${onto}"]`).boundingBox())!;
  const y = from.y + from.height / 2;
  const past = to.x < from.x ? to.x - 4 : to.x + to.width + 4;
  await page.mouse.move(from.x + from.width / 2, y);
  await page.mouse.down();
  // In steps, because a drag is only a drag once the pointer has moved.
  await page.mouse.move(past, y, { steps: 12 });
  await page.mouse.up();
}

test("no strip of tabs until there is a second font", async ({ page }) => {
  /*
   * A lone tab answers a question nobody asked, above the first screen
   * somebody sees, and it would carry a cross that does nothing -- the last
   * font never closes.
   */
  await page.goto("/");
  await openFont(page);
  await expect(page.locator(tabs)).toHaveCount(0);

  await startBlank(page);
  await expect(page.locator(tabs)).toBeVisible();
  await expect(page.locator("[data-document-tab]")).toHaveCount(2);
});

test("a second font opens beside the first rather than over it", async ({ page }) => {
  await page.goto("/");
  await openFont(page);
  await startBlank(page);

  // The blank is in front, and it is the one being worked on.
  await expect(page.locator('[data-document-tab="Untitled"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator('[data-document-tab="DejaVu Sans"]')).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  // And the first is still there, whole, a click away.
  await page.locator('[data-document-tab="DejaVu Sans"]').click();
  await expect(page.locator("[data-font-name]")).toContainText("DejaVu Sans");
});

test("the screen you were on is part of where you were in that font", async ({ page }) => {
  /*
   * Which view belongs to the font rather than to the desk, so coming back to
   * a font you were kerning puts you back in the kerning table. The tool in
   * hand is the other way round and is tested in the store, where a tool can
   * be taken up without a letter under it.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Kerning", exact: true }).click();

  await startBlank(page);
  // The new font starts where a new font starts, not where the last one was.
  await expect(page.getByRole("button", { name: "Font", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.locator('[data-document-tab="DejaVu Sans"]').click();
  await expect(page.getByRole("button", { name: "Kerning", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("closing a tab brings its neighbour forward", async ({ page }) => {
  await page.goto("/");
  await openFont(page);
  await startBlank(page);
  await expect(page.locator("[data-document-tab]")).toHaveCount(2);

  await page.locator('[data-close-document="Untitled"]').click();
  await expect(page.locator("[data-document-tab]")).toHaveCount(0);
  await expect(page.locator("[data-font-name]")).toContainText("DejaVu Sans");
});

test("both fonts are still there after a reload", async ({ page }) => {
  /*
   * The half of this feature that loses work when it is missing. The session
   * is written into the browser on a timer, and a document that kept only the
   * font in front would give back one of two on the next visit -- work that
   * was on screen a second earlier, gone with nothing said and no file to go
   * back to.
   */
  await page.goto("/");
  await openFont(page);
  await startBlank(page);
  await expect(page.locator("[data-document-tab]")).toHaveCount(2);

  /*
   * Waited for by name, not by half.
   *
   * The edited half exists from the moment the first font is open, so waiting
   * on it is waiting for something that happened before the second font did --
   * and the reload then races the save that carries it. Asking which fonts are
   * written down asks the actual question.
   */
  await expect
    .poll(() => keptFonts(page).then((fonts) => fonts.map((one) => one.name)), {
      timeout: 30_000,
    })
    .toEqual(["DejaVu Sans", "Untitled"]);
  await page.reload();

  /*
   * Both of them, and the blank one is the half that used to go.
   *
   * A font started blank here has no original bytes to lay its edits back
   * over, and for a long while that meant the whole half was skipped: it was
   * never written down at all. Several fonts open at once only made that
   * easier to walk into -- starting one used to replace your work and now sits
   * beside it -- so the tab that could not be saved became a tab people
   * actually had. It is written whole now, since a font with no file behind it
   * only ever holds what somebody made in here.
   */
  await expect(page.locator("[data-document-tab]")).toHaveCount(2, { timeout: 60_000 });
  await expect(page.locator("[data-font-name]")).toContainText("Untitled");
  await page.locator('[data-document-tab="DejaVu Sans"]').click();
  await expect(page.locator("[data-font-name]")).toContainText("DejaVu Sans");
});

test("a letter drawn in a font made here is still drawn after a reload", async ({ page }) => {
  /*
   * The work that used to be lost, rather than the tab that used to be lost.
   * Somebody starts a font, draws in it, and comes back the next day: before
   * this there was nothing there, no file to go back to, and nothing said.
   */
  await page.goto("/");
  await openFont(page);
  await startBlank(page);
  await page.getByRole("button", { name: "Font", exact: true }).click();
  // A font with only its `.notdef` says it has no letters yet, and this is the
  // way out of that: it adds one and opens the editor on it.
  await expect(page.getByText("No letters yet.", { exact: false })).toBeVisible();
  await page.locator("[data-add-glyph]").click();
  await expect(page.getByRole("button", { name: "Glyph", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Waited for by what is in the font rather than by the half existing, for
  // the reason the test above gives: the half was there before the letter was.
  await expect
    .poll(() => keptFonts(page).then((fonts) => fonts.at(-1)?.glyphs ?? 0), { timeout: 30_000 })
    .toBe(2);
  await page.reload();

  await expect(page.locator("[data-font-name]")).toContainText("Untitled", { timeout: 60_000 });
  await page.getByRole("button", { name: "Font", exact: true }).click();
  // Not the empty state any more, which is what it gave back before: the font
  // came back with the letter in it rather than not coming back at all.
  await expect(page.getByText("No letters yet.", { exact: false })).toHaveCount(0);
  await expect(page.locator("[data-glyph-cell]"), "the letter came back").toHaveCount(2);
});

test("two opened fonts both come back after a reload", async ({ page }) => {
  await page.goto("/");
  await openFont(page);
  await page.setInputFiles("[data-open-input]", FONT_PATH!);
  await expect(page.locator("[data-document-tab]")).toHaveCount(2, { timeout: 45_000 });

  await expect.poll(() => keptHalves(page), { timeout: 30_000 }).toContain("edits");
  await page.reload();

  await expect(page.locator("[data-document-tab]")).toHaveCount(2, { timeout: 60_000 });
  await expect(page.locator("[data-font-name]")).toContainText("DejaVu Sans");
});

test("a font closed by accident can be got back", async ({ page }) => {
  /*
   * The cross is small, permanent, and beside the name of a font somebody has
   * spent an afternoon on -- and the session is written into the browser
   * straight afterwards, so without a way back a misclick and a reload were
   * the whole of it. Everything else this application does to a document can
   * be taken back.
   *
   * Through the palette rather than a button on the strip: it is the way back
   * from a mistake rather than a control anybody reaches for, and it names the
   * font, which is what makes it worth pressing.
   */
  await page.goto("/");
  await openFont(page);
  await startBlank(page);
  await page.locator('[data-close-document="DejaVu Sans"]').click();
  await expect(page.locator("[data-document-tab]")).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("textbox", { name: "Search everything" }).fill("reopen");
  await page.getByRole("dialog", { name: "Quick actions" }).getByRole("option").first().click();

  await expect(page.locator("[data-font-name]")).toContainText("DejaVu Sans");
  await expect(page.locator("[data-document-tab]")).toHaveCount(2);
});

/*
 * The keys.
 *
 * One rule: Alt owns which font. Alt with the arrows for the one either side,
 * Alt with a number for the one in that place. Every key that means "the next
 * document" anywhere else belongs to the browser here -- Cmd-1 to Cmd-9,
 * Ctrl-Tab, Cmd-backtick -- and a page cannot refuse any of them.
 */
test("Alt and the arrows walk the tabs, and go round", async ({ page }) => {
  await page.goto("/");
  await openFont(page);
  await startBlank(page);
  const front = page.locator("[data-font-name]");
  await expect(front).toContainText("Untitled");

  await page.keyboard.press("Alt+ArrowLeft");
  await expect(front).toContainText("DejaVu Sans");
  await page.keyboard.press("Alt+ArrowRight");
  await expect(front).toContainText("Untitled");

  // Round rather than stopping at the end, as every tab strip does.
  await page.keyboard.press("Alt+ArrowRight");
  await expect(front).toContainText("DejaVu Sans");
});

test("Alt and a number go straight to that tab", async ({ page }) => {
  /*
   * Pressed as the physical key, which is how the handler reads it. Option
   * with a digit does not produce that digit on a Mac -- Option-1 is an
   * upside-down exclamation mark -- so a handler that parsed the character
   * would work on a PC and do nothing on half the machines this runs on. This
   * cannot show that half: the runners are Linux, where Alt-1 is still `1`.
   * What it holds is that the physical key is what answers.
   */
  await page.goto("/");
  await openFont(page);
  await startBlank(page);

  await page.keyboard.press("Alt+Digit1");
  await expect(page.locator("[data-font-name]")).toContainText("DejaVu Sans");
  await page.keyboard.press("Alt+Digit2");
  await expect(page.locator("[data-font-name]")).toContainText("Untitled");
  // A number past the end is not a tab, so nothing moves.
  await page.keyboard.press("Alt+Digit7");
  await expect(page.locator("[data-font-name]")).toContainText("Untitled");
});

test("Alt and the arrows never nudge the selection, even with nowhere to go", async ({ page }) => {
  /*
   * The canvas nudges the selection with the arrows, and it was not looking at
   * Alt. So Alt with an arrow moved the picked points a unit -- an edit nobody
   * asked for, in the letter on screen, recorded in that font's history.
   *
   * Asked with one font open, which is the case that bites and the case a
   * person is most likely to be in. With two, the switch happens first and the
   * nudge lands on a letter that is no longer there, so it quietly does
   * nothing and a test written that way passes with the guard taken out --
   * which is how this one started. With one there is nowhere to go, the key
   * has no other job, and the only question left is whether it damages the
   * letter.
   */
  await page.goto("/");
  await openFont(page);
  await expect(page.locator("[data-document-tabs]"), "one font, no strip").toHaveCount(0);

  await page.getByRole("button", { name: "Glyph", exact: true }).click();
  await page.locator("[data-glyph-canvas]").click();
  await page.keyboard.press("ControlOrMeta+a");
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(undo, "nothing has been done to this font yet").toBeDisabled();

  await page.keyboard.press("Alt+ArrowLeft");
  await page.keyboard.press("Alt+ArrowRight");
  await expect(undo, "Alt with an arrow is not an edit").toBeDisabled();

  // And the bare arrow still is, which is what makes the line above a guard
  // rather than a nudge that stopped working.
  await page.keyboard.press("ArrowLeft");
  await expect(undo).toBeEnabled();
});

test("the font you just closed comes back on ⌥⇧T", async ({ page }) => {
  /*
   * Asked with one font left, which is the whole point of where the key sits
   * in the handler. One font open is not a reason to refuse this -- it is the
   * commonest moment for it, because closing the other one is why there is one
   * left and why somebody is reaching for the key at all.
   *
   * Not Cmd-Shift-T, which is what every hand reaches for: that is the
   * browser's own, it reopens the browser's tab, and a page cannot refuse it
   * or even hear it.
   */
  await page.goto("/");
  await openFont(page);
  await startBlank(page);
  await page.locator('[data-close-document="DejaVu Sans"]').click();
  await expect(page.locator("[data-document-tabs]"), "one font left").toHaveCount(0);
  await expect(page.locator("[data-font-name]")).toContainText("Untitled");

  await page.keyboard.press("Alt+Shift+KeyT");
  await expect(page.locator("[data-font-name]")).toContainText("DejaVu Sans");
  await expect(page.locator("[data-document-tab]")).toHaveCount(2);
});

test("⌥⇧T with nothing closed does nothing at all", async ({ page }) => {
  await page.goto("/");
  await openFont(page);
  await startBlank(page);
  await expect(page.locator("[data-font-name]")).toContainText("Untitled");

  await page.keyboard.press("Alt+Shift+KeyT");
  await expect(page.locator("[data-document-tab]")).toHaveCount(2);
  await expect(page.locator("[data-font-name]")).toContainText("Untitled");
});

test("what comes back brings its history with it", async ({ page }) => {
  /*
   * The reason the closed font is kept whole rather than reopened from the
   * file. An edit made before the cross was pressed is still an edit, and a
   * font that came back unable to take it back would be a different font
   * wearing the same name.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();
  await page.locator("[data-glyph-canvas]").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ArrowLeft");
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeEnabled();

  await startBlank(page);
  await page.locator('[data-close-document="DejaVu Sans"]').click();
  await expect(undo, "the blank font has nothing to take back").toBeDisabled();

  await page.keyboard.press("Alt+Shift+KeyT");
  await expect(page.locator("[data-font-name]")).toContainText("DejaVu Sans");
  await expect(undo, "and the edit made before the cross is still there").toBeEnabled();
});

test("Alt and Shift with an arrow moves the tab rather than moving to it", async ({ page }) => {
  /*
   * The pairing every application with a strip of tabs uses, and the one a
   * hand already knows from a browser. This chord used to be turned away on
   * purpose -- left unhandled it had been a second name for Alt and an arrow,
   * a chord bound by omission -- and the guard that said so has become the
   * job.
   */
  await page.goto("/");
  await openFont(page);
  await startBlank(page);
  const named = () => page.locator("[data-document-tab]").allTextContents();
  expect(await named()).toEqual(["DejaVu Sans", "Untitled"]);

  await page.keyboard.press("Alt+Shift+ArrowLeft");
  expect(await named()).toEqual(["Untitled", "DejaVu Sans"]);
  // And you are still in the font you were in, which moved with its tab.
  await expect(page.locator("[data-font-name]")).toContainText("Untitled");
  await expect(page.locator('[data-document-tab="Untitled"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.keyboard.press("Alt+Shift+ArrowRight");
  expect(await named()).toEqual(["DejaVu Sans", "Untitled"]);
});

test("a tab moved past the end stops there rather than wrapping", async ({ page }) => {
  /*
   * Unlike moving *between* them, which wraps because a strip has no edge to
   * walk off. Dragging a tab past the last one puts it last; a tab that leapt
   * to the other end instead would be a hand that overshot losing its place.
   */
  await page.goto("/");
  await openFont(page);
  await startBlank(page);
  const named = () => page.locator("[data-document-tab]").allTextContents();
  expect(await named()).toEqual(["DejaVu Sans", "Untitled"]);

  await page.keyboard.press("Alt+Shift+ArrowRight");
  expect(await named(), "already last, so it stays last").toEqual(["DejaVu Sans", "Untitled"]);
  await expect(page.locator("[data-font-name]")).toContainText("Untitled");
});

test("a tab dragged past its neighbour swaps with it", async ({ page }) => {
  /*
   * The drag itself, in the direction that always looked right and the one
   * that did not. The landing is counted among the *other* tabs, which is what
   * makes both directions agree -- the same sum the dock uses down its column,
   * and the one that was wrong the first time it was written.
   */
  await page.goto("/");
  await openFont(page);
  await startBlank(page);
  const named = () => page.locator("[data-document-tab]").allTextContents();
  expect(await named()).toEqual(["DejaVu Sans", "Untitled"]);

  await dragTab(page, "DejaVu Sans", "Untitled");
  expect(await named()).toEqual(["Untitled", "DejaVu Sans"]);
  // Dragged back the other way, which is the direction that hides an
  // off-by-one when the arithmetic is written the obvious way.
  await dragTab(page, "DejaVu Sans", "Untitled");
  expect(await named()).toEqual(["DejaVu Sans", "Untitled"]);
});

test("a press that goes nowhere is still a click", async ({ page }) => {
  /*
   * The name is both the drag handle and the button that goes to the font, so
   * a press that does not move has to reach the click handler untouched.
   * Started on the first pixel, a drag would flicker a tab to half opacity
   * every time somebody switched font.
   */
  await page.goto("/");
  await openFont(page);
  await startBlank(page);
  await expect(page.locator("[data-font-name]")).toContainText("Untitled");

  await page.locator('[data-document-tab="DejaVu Sans"]').click();
  await expect(page.locator("[data-font-name]")).toContainText("DejaVu Sans");
  await expect(page.locator("[data-document-carried]")).toHaveCount(0);
});

test("the middle button closes a tab", async ({ page }) => {
  // What it does in every browser this strip is open in, so a hand that has
  // the habit brings it with them.
  await page.goto("/");
  await openFont(page);
  await startBlank(page);
  await expect(page.locator("[data-document-tab]")).toHaveCount(2);

  const tab = (await page.locator('[data-document-tab="DejaVu Sans"]').boundingBox())!;
  await page.mouse.click(tab.x + tab.width / 2, tab.y + tab.height / 2, { button: "middle" });

  await expect(page.locator("[data-document-tabs]"), "one left, so no strip").toHaveCount(0);
  await expect(page.locator("[data-font-name]")).toContainText("Untitled");
});

test("a middle click on the cross closes that tab too, not its neighbour", async ({ page }) => {
  /*
   * The handler is on the tab rather than on the name, so the cross is inside
   * it. Middle-clicking the cross has to close the tab it belongs to -- which
   * is the same thing its left button does, and would be somebody else's tab
   * if the index came from the wrong place.
   */
  await page.goto("/");
  await openFont(page);
  await startBlank(page);
  await page.setInputFiles("[data-open-input]", FONT_PATH!);
  await expect(page.locator("[data-document-tab]")).toHaveCount(3, { timeout: 45_000 });

  const cross = (await page.locator('[data-close-document="Untitled"]').boundingBox())!;
  await page.mouse.click(cross.x + cross.width / 2, cross.y + cross.height / 2, {
    button: "middle",
  });
  expect(await page.locator("[data-document-tab]").allTextContents()).toEqual([
    "DejaVu Sans",
    "DejaVu Sans",
  ]);
});

test("the middle button does not leave the page in autoscroll", async ({ page }) => {
  /*
   * The half that is easy to miss. A middle press opens the scroll-anywhere
   * widget, and the browser decides that on the press -- `auxclick` comes
   * afterwards and is far too late to stop it. Asked as "was the press
   * refused", because the widget itself is browser chrome and not in the page
   * to look for.
   */
  await page.goto("/");
  await openFont(page);
  await startBlank(page);
  const tab = (await page.locator('[data-document-tab="DejaVu Sans"]').boundingBox())!;
  const refused = await page.evaluate(
    ([x, y]) => {
      const at = document.elementFromPoint(x, y)!;
      const press = new MouseEvent("mousedown", {
        button: 1,
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
      });
      at.dispatchEvent(press);
      return press.defaultPrevented;
    },
    [tab.x + tab.width / 2, tab.y + tab.height / 2],
  );
  expect(refused, "a middle press has to be refused, or the page autoscrolls").toBe(true);
});

test("the left button still switches rather than closing", async ({ page }) => {
  // The two buttons on the same pixel do different things, and a tab that
  // closed on an ordinary click would be unusable.
  await page.goto("/");
  await openFont(page);
  await startBlank(page);
  await page.locator('[data-document-tab="DejaVu Sans"]').click();
  await expect(page.locator("[data-document-tab]")).toHaveCount(2);
  await expect(page.locator("[data-font-name]")).toContainText("DejaVu Sans");
});

test("the tab says which key it answers to", async ({ page }) => {
  // Where a shortcut is actually learnt: the moment somebody reaches for the
  // slow way to the thing it is for.
  await page.goto("/");
  await openFont(page);
  await startBlank(page);
  await expect(page.locator('[data-document-tab="DejaVu Sans"]')).toHaveAttribute(
    "title",
    "DejaVu Sans — ⌥1. Drag to reorder, or ⌥⇧← ⌥⇧→.",
  );
});
