import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { FONT_PATH, measureInk, openFont, startBlank, takeUpTool } from "./support";

test.skip(!FONT_PATH, "needs a system font to open");

test("a font brought in from a file is not accused of dead letters", async ({ page }) => {
  /*
   * A check that is wrong about a correct font is worse than no check. An
   * imported font brings its own GSUB -- ligatures, positional forms, the lot
   * -- which this document does not model and the exporter hands back
   * untouched, so its glyphs are reached through tables nothing here can see.
   * Counting them reported two hundred and sixty-five dead letters in DejaVu
   * Sans: Arabic initial and final forms, every one of them fine.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Checks", exact: true }).click();
  await page.getByRole("button", { name: "Run checks", exact: true }).click();
  await expect(page.getByText(/glyphs checked/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("drawn but nothing can reach", { exact: false })).toHaveCount(0);
});

test("the proof sets the joined letters, and can be asked not to", async ({ page }) => {
  /*
   * A proof laid out character by character shows a font nobody will ever see:
   * every ligature in it sitting unused while the letters it replaces are set
   * side by side. And the switch matters as much as the substitution -- what a
   * ligature is *for* is the collision it takes out, and the only way to judge
   * the joined drawing is against the pair standing beside it.
   *
   * Proved by ink rather than by eye. A ligature whose drawing this font has
   * not got is made empty, so where it fires the letters vanish: fewer pixels
   * covered with it on than with it off, which no amount of anti-aliasing
   * explains away.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();
  await page
    .getByRole("group", { name: "Inspector scope" })
    .getByRole("button", { name: "build" })
    .click();

  await page.getByLabel("Letters to join").fill("t h");
  await page.getByRole("button", { name: "Join", exact: true }).click();
  await expect(page.getByText("t h now draws as t_h", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Proof", exact: true }).click();
  await page.locator("textarea").first().fill("the thin the other the thing");
  await page.waitForTimeout(700);

  const joined = await measureInk(page);
  await page.locator("[data-proof-ligatures]").click();
  await page.waitForTimeout(700);
  const separate = await measureInk(page);

  expect(separate).toBeGreaterThan(joined);
});

test("the ligature switch stays away until the font has one", async ({ page }) => {
  /*
   * A switch that changes nothing is furniture. Asked of a font just started
   * rather than of DejaVu, which arrives with its own ligatures now that an
   * import reads them -- and so rightly gets the switch.
   */
  await page.goto("/");
  await startBlank(page);
  // A letter, so the proof shows its controls rather than its empty state --
  // the switch has to be absent from a bar that is actually on screen.
  await page.getByRole("button", { name: "Font", exact: true }).click();
  await page.locator("[data-add-glyph]").click();
  await page.getByRole("button", { name: "Proof", exact: true }).click();
  await expect(page.locator("[data-proof-ligatures]")).toHaveCount(0);

  // And a font that has one gets it, which is the other half of the claim.
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Proof", exact: true }).click();
  await expect(page.locator("[data-proof-ligatures]")).toHaveCount(1);
});

test("a font opened from another mode takes you to where it opened", async ({ page }) => {
  /*
   * Found by touring Draw, Assemble and Trace, which had never been looked at.
   *
   * Every other door already did this -- a UFO, a saved project, a typeface
   * adopted from the library all set the mode to the one that now holds the
   * work. A plain font was the one that did not, so opening one from the
   * toolbar while standing in Trace loaded it into the editor's document and
   * left you where you were: the status line reporting `Opened — 6,253 glyphs`
   * over a view saying `Nothing traced yet`. Two statements about the same
   * action, contradicting each other on the same screen, with the font itself
   * perfectly fine and one mode away.
   */
  await page.goto("/");
  for (const mode of ["Trace", "Draw", "Assemble"]) {
    await page.getByRole("button", { name: mode, exact: true }).click();
    await expect(page.getByRole("button", { name: mode, exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await openFont(page);
    await expect(
      page.getByRole("button", { name: "Edit", exact: true }),
      `opening a font from ${mode} left the person in ${mode}`,
    ).toHaveAttribute("aria-pressed", "true");
    // And the font really is there, rather than the mode having switched to an
    // empty editor.
    await expect(page.locator("[data-font-name]")).toContainText("DejaVu Sans");
  }
});

test("Trace says what it is holding, as the other three modes do", async ({ page }) => {
  /*
   * Three of the four named their document in the toolbar -- `Untitled
   * Regular`, `Untitled Sans`, `Untitled 0 drawings` -- and the fourth left the
   * space blank. The one mode whose whole subject is a font somebody else made
   * was the one that never said which font.
   */
  await page.goto("/");
  await page.getByRole("button", { name: "Trace", exact: true }).click();
  // Scoped to the toolbar: the canvas beside it also says "Nothing traced yet",
  // which is the empty state and a different sentence doing a different job.
  const toolbar = page.getByRole("banner");
  await expect(toolbar.getByText("nothing traced", { exact: false })).toBeVisible();

  // The other three name theirs too, which is the point of adding the fourth.
  for (const [mode, says] of [
    ["Draw", "Sans"],
    ["Assemble", "drawings"],
  ]) {
    await page.getByRole("button", { name: mode, exact: true }).click();
    await expect(toolbar.getByText(says, { exact: false }).first()).toBeVisible();
  }
});

test("a font that was opened can be shipped as one file that varies", async ({ page }) => {
  /*
   * The `fvar`/`gvar`/`STAT` writer has been here since the forge learned to
   * put a family in one file, and it takes masters as whole typefaces -- so
   * nothing about it was ever particular to a drawn-from-nothing face. Only the
   * forge could reach it, so an imported or hand-drawn font could not be
   * shipped as a varying one at all.
   *
   * What the file actually draws is settled by fontTools in
   * `varying-drawn.integration.test.ts`, which pins it at each end and measures
   * the ink. This is the browser half: that the choice is offered, and that
   * what comes down the wire is a font a browser will parse with an axis in it.
   */
  await page.goto("/");
  await openFont(page);

  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Download font" });
  await expect(dialog).toBeVisible();
  await dialog.getByText("Variable (.ttf)").click();

  // The compiling questions go: a varying font is always a rebuild, because
  // every master has to split its curves the same number of ways.
  await expect(dialog.getByText("What to carry over")).toHaveCount(0);

  const download = await Promise.race([
    page.waitForEvent("download", { timeout: 120_000 }),
    dialog
      .getByRole("button", { name: "Download" })
      .click()
      .then(() => page.waitForEvent("download", { timeout: 120_000 })),
  ]);

  const bytes = readFileSync((await download.path())!);
  expect([...bytes.subarray(0, 4)]).toEqual([0, 1, 0, 0]);

  // The table that makes it a variable font, found by name in the directory.
  const tags: string[] = [];
  const count = (bytes[4] << 8) | bytes[5];
  for (let i = 0; i < count; i++) {
    tags.push(String.fromCharCode(...bytes.subarray(12 + i * 16, 16 + i * 16)));
  }
  expect(tags).toContain("fvar");
  expect(tags).toContain("gvar");
  expect(tags).toContain("STAT");

  // And a browser will take it, which nothing malformed gets past.
  const loaded = await page.evaluate(
    async (data) => {
      const face = new FontFace("TypeforgeVariable", new Uint8Array(data).buffer);
      try {
        await face.load();
        return true;
      } catch {
        return false;
      }
    },
    [...bytes],
  );
  expect(loaded).toBe(true);
});

test("the pen can close an outline, which nothing here could do", async ({ page }) => {
  /*
   * Not a missing state but a missing action. `addPoint` appended to the last
   * open contour or started a new one, and nothing anywhere in this application
   * ever set `closed` -- so every outline drawn with the pen stayed open, and
   * an open contour does not fill. Somebody could draw a perfectly good `o` and
   * watch it stay a wire.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();
  await page.waitForTimeout(400);
  const box = (await page.locator("canvas").first().boundingBox())!;

  await page.locator('[data-tool="pen"]').click();
  /*
   * `Click to start an outline` is gone deliberately.
   *
   * It was the sentence the pen showed over an existing edge while a click
   * there put a point on that edge instead, and it named neither of the two
   * things a press can actually be. What replaced it names both.
   */
  await expect(page.locator("[data-tool-says]")).toHaveText(/hold and pull for a curve/);

  const a = { x: box.x + 850, y: box.y + 180 };
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(a.x + 90, a.y);
  await page.mouse.click(a.x + 90, a.y + 90);

  // Three points down, so there is something worth closing.
  await page.mouse.move(a.x + 40, a.y + 40);
  await expect(page.locator("[data-tool-says]")).toHaveText(/The first point closes it/);

  // On the point that would close it, the pen says so before the click.
  await page.mouse.move(a.x, a.y);
  await expect(page.locator("[data-tool-says]")).toHaveText("Click to close the outline.");
  await expect(page.locator('[data-tool="pen"]')).toHaveAttribute("data-phase", "willDo");

  await page.mouse.click(a.x, a.y);
  await expect(page.getByText("Outline closed.", { exact: false })).toBeVisible();

  // And the outline really is closed: the pen is back to starting a new one.
  // Moved well inside the canvas rather than out towards its edge, where
  // leaving it clears the line and the test would be reading that instead.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await expect(page.locator("[data-tool-says]")).toHaveText(/hold and pull for a curve/);
});

test("the knife says whether the line would cut before you let go", async ({ page }) => {
  /*
   * A knife drawn short, or down beside a stem rather than across it, does
   * nothing at all -- and did it silently. The only way to find out was to let
   * go and watch nothing happen.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();
  await page.waitForTimeout(400);
  const box = (await page.locator("canvas").first().boundingBox())!;
  const mid = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await page.locator('[data-tool="knife"]').click();
  // Armed the moment it is picked up, rather than waiting for a pointer move.
  await expect(page.locator("[data-tool-says]")).toHaveText(/right across a shape/);

  await page.mouse.move(box.x + 30, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 40, { steps: 4 });
  await expect(page.locator("[data-tool-says]")).toHaveText(/has to cross a shape/);
  await expect(page.locator('[data-tool="knife"]')).toHaveAttribute("data-phase", "active");

  await page.mouse.move(mid.x + 300, mid.y, { steps: 8 });
  await expect(page.locator("[data-tool-says]")).toHaveText("Let go to cut here.");
  await expect(page.locator('[data-tool="knife"]')).toHaveAttribute("data-phase", "willDo");
  await page.mouse.up();
  await expect(page.getByText("Cut into", { exact: false })).toBeVisible();
});

test("a tool says what it is for the moment it is picked up", async ({ page }) => {
  /*
   * `setTool` clears the phase and nothing reported a new one until the pointer
   * next moved, so choosing the knife left the status line still offering to
   * type a point's position. Somebody who picks a tool and reads the line
   * before moving is exactly the person the line is for.
   */
  await page.goto("/");
  await openFont(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();
  await page.waitForTimeout(400);

  /*
   * Through the flyout, because the tools are grouped now.
   *
   * A group button carries `data-tool` for whichever of its tools was last
   * used, so the four defaults are still reachable by that selector and the
   * other nine are not. `pencil` is `freehand` and lives under the pen, being
   * a pen that takes a drawn line rather than a series of clicks.
   */
  const takeUp = async (group: string, tool: string) => {
    const button = page.locator(`[data-tool-group="${group}"]`);
    await button.click();
    if ((await page.locator(`[data-flyout-tool="${tool}"]`).count()) === 0) await button.click();
    await page.locator(`[data-flyout-tool="${tool}"]`).click();
  };

  for (const [group, tool, expected] of [
    ["pen", "freehand", /Drag to draw/],
    ["shape", "rectangle", /Drag out a rectangle/],
    ["shape", "ellipse", /Drag out an ellipse/],
    ["knife", "knife", /right across a shape/],
  ] as const) {
    await takeUp(group, tool);
    await expect(page.locator("[data-tool-says]"), `${tool} said nothing`).toHaveText(expected);
  }

  // And select over nothing says nothing, which is the state most time is
  // spent in and does not need narrating.
  await takeUp("select", "select");
  await expect(page.locator("[data-tool-says]")).toHaveText(/Select one point/);
});

/**
 * Writing a letter with a pen, which is the fourth way into a letterform.
 *
 * The other three each ask for something a person may not have: the forge gives
 * no way back to your own letter because you never touched it, Trace needs the
 * font you are trying to make, and the outline tools need the one skill this is
 * meant to make unnecessary. This one asks what a calligrapher already knows --
 * draw the line down the middle and let the pen have the width.
 *
 * Driven through the palette and the canvas rather than through the store,
 * because the whole claim is that a person can do it.
 */
test("writes a letter with a pen, down the middle", async ({ page }) => {
  await page.goto("/");
  await startBlank(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();
  // A blank font has no letters, so there is nothing to write on until one is
  // made. This is the state somebody starting a font from nothing is in.
  await page.getByRole("button", { name: "New letter" }).first().click();
  await page.waitForTimeout(400);

  const canvas = page.locator("canvas").first();
  const box = (await canvas.boundingBox())!;
  const at = (x: number, y: number) => ({ x: box.x + x, y: box.y + y });

  await takeUpTool(page, "write", "skeleton");
  await expect(page.locator("[data-tool-says]")).toHaveText(/down the middle of the letter/);

  // The pen's three numbers are there before anything is drawn, because the
  // pen is what somebody sets first.
  await expect(page.locator("[data-pen-panel]")).toBeVisible();
  await expect(page.locator("[data-pen-scope]")).toHaveText("for the next stroke");

  const blank = await measureInk(page);

  /*
   * Three clicks down the middle of the letter, which is a stem with a bend.
   * The ink appears from the second: one point is a place and two are a stroke.
   */
  const first = at(box.width * 0.35, box.height * 0.7);
  await page.mouse.click(first.x, first.y);
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.45);
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.25);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  const written = await measureInk(page);
  expect(written).toBeGreaterThan(blank);

  /*
   * And the pen can be taken hold of and turned, which is the thing three
   * numbers cannot teach. Picking up the pen tool shows an ellipse at every
   * point that was put down; clicking one puts it in the panel.
   */
  await takeUpTool(page, "write", "nib");
  /*
   * And it says there is a pen to take hold of, rather than that nothing is
   * written here. The facts about the letter -- has it strokes, is one being
   * written -- have to reach the sentence the moment the tool is picked up, and
   * not only once the pointer moves: picking up the pen on a letter with two
   * strokes in it said "nothing written here yet, write a stroke first", which
   * is the sentence for an empty letter. Matched on the whole phrase, because
   * the wrong sentence has the word "pen" in it too and a loose match passed.
   */
  await expect(page.locator("[data-tool-says]")).toHaveText(/Take hold of/);

  await page.mouse.click(first.x, first.y);
  await page.waitForTimeout(200);
  await expect(page.locator("[data-pen-scope]")).toHaveText(/stroke 1, point 1/);

  // Turned at one point only, the pen now turns along the stroke -- and the
  // panel says so, which is how somebody knows the letter is doing it.
  await expect(page.locator("[data-pen-along]")).toHaveText(/held the same way/);
  const angle = page.locator("[data-pen-panel]").getByRole("textbox", { name: "Angle" });
  await angle.fill("110");
  await angle.press("Enter");
  await page.waitForTimeout(300);
  await expect(page.locator("[data-pen-along]")).toHaveText(/turns from/);

  const turned = await measureInk(page);
  // Turning the pen moves ink. Nothing else about the stroke changed.
  expect(Math.abs(turned - written)).toBeGreaterThan(0);
});

/**
 * Three named pens, and one edit that reaches every letter using one.
 *
 * This is the answer to the complaint that making a font here needed too much
 * technical know-how. An alphabet looks like one family because its letters
 * share a few pens, and keeping forty sets of numbers in line by hand is
 * exactly the expertise nobody should need. So the pen is named, the letters
 * follow it, and changing it changes them.
 */
test("names a pen, and one change reaches every letter using it", async ({ page }) => {
  await page.goto("/");
  await startBlank(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();
  await page.getByRole("button", { name: "New letter" }).first().click();
  await page.waitForTimeout(400);

  const canvas = page.locator("canvas").first();
  const box = (await canvas.boundingBox())!;
  await takeUpTool(page, "write", "skeleton");

  /*
   * The pens a written alphabet starts with are real hands, not placeholders.
   * The name is a field rather than a label, because a pen is renamed by typing
   * over it -- so it is read as a value.
   */
  const textura = page.locator("[data-saved-pen='textura']");
  await expect(textura.getByRole("textbox")).toHaveValue("Textura");
  await expect(textura).toContainText("40°");

  // Write with the Textura pen, so the stroke follows it rather than holding
  // its own numbers.
  await page.locator("[data-use-pen='textura']").click();
  await expect(page.locator("[data-saved-pen='textura']")).toHaveAttribute("data-on", "true");
  await expect(page.locator("[data-pen-follows]")).toHaveText(/every stroke written with it/);

  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.3);
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.7);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const written = await measureInk(page);
  expect(written).toBeGreaterThan(0);

  /*
   * Now change the pen itself. Typing into the fields while a pen is being
   * followed changes the pen, which is what makes one edit reach an alphabet --
   * and the status line says how many letters moved, so it is not a silent act.
   */
  const width = page
    .locator("[data-pen-panel]")
    .getByRole("textbox", { name: "Width", exact: true });
  await width.fill("160");
  await width.press("Enter");
  await page.waitForTimeout(400);

  const heavier = await measureInk(page);
  expect(heavier).toBeGreaterThan(written);
  // And the saved pen itself now reads 160, so the row and the letter agree.
  await expect(page.locator("[data-saved-pen='textura']")).toContainText("160");

  /*
   * And a stroke that has to be its own can be freed, after which the saved
   * pen no longer moves it. That is the escape hatch that makes following safe
   * to do by default.
   */
  await takeUpTool(page, "write", "nib");
  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.3);
  await page.waitForTimeout(200);
  await expect(page.locator("[data-pen-scope]")).toHaveText(/stroke 1/);
  await page.locator("[data-free-pen]").click();
  await page.waitForTimeout(200);
  await expect(page.locator("[data-pen-follows]")).toHaveCount(0);

  /*
   * A pen is renamed by typing in its row and thrown away by the cross beside
   * it. Both were missing: the name was asked for once by a browser prompt --
   * the only one in the application -- and could never be changed, and there
   * was no way at all to remove a pen from a list that only ever grew.
   */
  const row = page.locator("[data-saved-pen='textura']");
  await row.getByRole("textbox").fill("Blackletter");
  await page.waitForTimeout(200);
  await expect(row.getByRole("textbox")).toHaveValue("Blackletter");

  await page.locator("[data-delete-pen='ruqaa']").click();
  await page.waitForTimeout(200);
  await expect(page.locator("[data-saved-pen='ruqaa']")).toHaveCount(0);
  // And the letter is untouched: a pen thrown away leaves the strokes written
  // with it exactly as they were.
  await expect(page.locator("[data-saved-pen='textura']")).toHaveCount(1);
});

/**
 * Taking a written letter's ink, and putting it back.
 *
 * This is what makes writing safe to start with: it does not have to be able
 * to draw everything, because the fourteen outline tools are one button away.
 * Write the letter, take its ink, fix the one curve that is wrong.
 *
 * And the way back is kept for exactly as long as it is true. Every other tool
 * with an Expand tells its users to save a copy first and leaves them with
 * undo; here the button is there until the outlines are edited by hand, and
 * then it is gone rather than offering to throw the edit away.
 */
test("takes a written letter's ink, and gives it back until it is edited", async ({ page }) => {
  await page.goto("/");
  await startBlank(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();
  await page.getByRole("button", { name: "New letter" }).first().click();
  await page.waitForTimeout(400);

  const canvas = page.locator("canvas").first();
  const box = (await canvas.boundingBox())!;
  await takeUpTool(page, "write", "skeleton");

  // Nothing to take before anything is written.
  await expect(page.locator("[data-expand]")).toHaveCount(0);

  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.3);
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.7);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const written = await measureInk(page);

  await expect(page.locator("[data-expand]")).toBeVisible();
  await page.locator("[data-expand]").click();
  await page.waitForTimeout(300);

  // The ink is the same ink: taking it changes nothing about the drawing.
  expect(Math.abs((await measureInk(page)) - written)).toBeLessThan(written * 0.02);
  // And the pen says so rather than pretending it still moves the letter.
  await expect(page.locator("[data-pen-expanded]")).toHaveText(/no longer moves it/);
  await expect(page.locator("[data-unexpand]")).toBeVisible();

  // Back to strokes, and the pen moves it again.
  await page.locator("[data-unexpand]").click();
  await page.waitForTimeout(300);
  await expect(page.locator("[data-pen-expanded]")).toHaveCount(0);
  await expect(page.locator("[data-expand]")).toBeVisible();

  /*
   * Take it again, then edit the outlines by hand. The way back goes, because
   * putting it back would re-sweep and throw the edit away.
   */
  await page.locator("[data-expand]").click();
  await page.waitForTimeout(200);
  await takeUpTool(page, "select", "select");
  await page.locator("[data-panel-section='params']").first().waitFor();
  await page.getByRole("button", { name: "Flip", exact: false }).first().click();
  await page.waitForTimeout(400);
  await takeUpTool(page, "write", "skeleton");
  await expect(page.locator("[data-unexpand]")).toHaveCount(0);
});

/**
 * The two things an expanded letter must not pretend about.
 *
 * Its ink no longer follows the pen, so the three numbers must not accept
 * edits that move nothing -- or, worse, move every *other* letter following the
 * same saved pen. And writing a new stroke on it means the person wants the pen
 * back, so it goes back to strokes rather than drawing into nothing.
 */
test("an expanded letter says the pen is idle, and writing brings it back", async ({ page }) => {
  await page.goto("/");
  await startBlank(page);
  await page.getByRole("button", { name: "Glyph", exact: true }).click();
  await page.getByRole("button", { name: "New letter" }).first().click();
  await page.waitForTimeout(400);

  const canvas = page.locator("canvas").first();
  const box = (await canvas.boundingBox())!;
  await takeUpTool(page, "write", "skeleton");
  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.3);
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.7);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  await page.locator("[data-expand]").click();
  await page.waitForTimeout(300);

  // The numbers are held, because typing in them would move nothing here.
  const width = page
    .locator("[data-pen-panel]")
    .getByRole("textbox", { name: "Width", exact: true });
  await expect(width).toBeDisabled();

  /*
   * And nothing is reported about the outlines, which the person did not draw.
   * Taking the ink changes no point of the letter -- only what it is called --
   * so a page of warnings about the fitter's points is a page of warnings for
   * an act that moved nothing.
   */
  await expect(page.getByText("Two points sit on top of each other")).toHaveCount(0);

  // Writing again brings the letter back to its strokes rather than drawing
  // into ink that no longer follows them.
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.3);
  await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.7);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await expect(page.locator("[data-pen-expanded]")).toHaveCount(0);
  await expect(width).toBeEnabled();
});
