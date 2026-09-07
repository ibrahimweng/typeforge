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

import { expect, test } from "@playwright/test";

import { FONT_PATH, keptHalves, openFont, startBlank } from "./support";

test.skip(!FONT_PATH, "needs a system font to open");

const tabs = "[data-document-tabs]";

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

  await expect.poll(() => keptHalves(page), { timeout: 30_000 }).toContain("edits");
  await page.reload();

  /*
   * Only the opened font comes back, and that is what this test is for rather
   * than a shortfall of it.
   *
   * A font started blank in here carries no original bytes to lay its edits
   * back over, so it has never been written down -- not since before there
   * were tabs. What several fonts open at once changed is how easy that is to
   * walk into: starting one used to replace your work and now sits beside it,
   * so the tab that cannot be saved is a tab people will actually have. Said
   * here so that fixing it is a decision somebody makes rather than something
   * that quietly never happens.
   */
  await expect(page.locator("[data-font-name]")).toContainText("DejaVu Sans", {
    timeout: 45_000,
  });
  await expect(page.locator("[data-document-tab]")).toHaveCount(0);
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

test("Alt and Shift with an arrow is not a second name for Alt and an arrow", async ({ page }) => {
  // Nothing else on Alt wants Shift, and letting it through would bind a
  // chord nobody chose.
  await page.goto("/");
  await openFont(page);
  await startBlank(page);
  await expect(page.locator("[data-font-name]")).toContainText("Untitled");
  await page.keyboard.press("Alt+Shift+ArrowLeft");
  await expect(page.locator("[data-font-name]")).toContainText("Untitled");
});

test("the tab says which key it answers to", async ({ page }) => {
  // Where a shortcut is actually learnt: the moment somebody reaches for the
  // slow way to the thing it is for.
  await page.goto("/");
  await openFont(page);
  await startBlank(page);
  await expect(page.locator('[data-document-tab="DejaVu Sans"]')).toHaveAttribute(
    "title",
    "DejaVu Sans — ⌥1",
  );
});
