/**
 * The courses, driven the way somebody takes one.
 *
 * What is worth checking in a browser rather than in a unit test is the claim
 * the whole feature rests on: a lesson goes green because the font says so, not
 * because anybody pressed anything. So the test does the actual work -- moves
 * the actual slider, draws the actual shape -- and expects the lesson to notice
 * on its own.
 */

import { expect, test } from "@playwright/test";

type Page = import("@playwright/test").Page;

const lesson = (page: Page, id: string) => page.locator(`[data-lesson='${id}']`);
/**
 * Open the course this lesson is in, then the lesson.
 *
 * Only the first course is expanded to begin with, which is right -- four
 * courses of every lesson opened at once is a wall -- so anything past the
 * first needs its course opening first.
 */
const openLesson = async (page: Page, id: string) => {
  const course = page.locator(`[data-course='${id.split(".")[0]}']`);
  /*
   * Wait for the course before counting what is inside it.
   *
   * `count()` is a reading rather than a wait, so taken before the drawer is
   * there it returns zero however long the drawer takes. The line below then
   * reads that zero as "the course is shut", clicks it, and shuts the course
   * that was already open -- after which the lesson never appears and the
   * test waits ninety seconds for it. The drawer is fetched when it is first
   * opened, so there is now a moment where that is exactly what happens.
   */
  await course.waitFor();
  if ((await lesson(page, id).count()) === 0) await course.locator("button").first().click();
  await lesson(page, id).locator("button").first().click();
};

test("the front door offers to draw one from nothing", async ({ page }) => {
  await page.goto("/");
  /*
   * Three doors were here and all three wanted a font you already had. The
   * thing this tool is best at -- making one -- was behind a mode switch
   * nobody had been told about.
   */
  await expect(page.locator('[data-start-route="draw"]')).toBeVisible();
  await page.locator('[data-start-route="draw"]').click();
  await expect(page.getByText("Start from")).toBeVisible();
});

test("a lesson ticks itself when the font says so, not when you say so", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.goto("/");
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await page.locator("[data-open-academy]").click();
  await expect(page.locator("[data-academy]")).toBeVisible();

  // Arriving in Draw is itself the first lesson, and it is already done.
  await expect(lesson(page, "first.base")).toHaveAttribute("data-done", "yes");

  // The second is not, and there is no button that would make it so.
  await expect(lesson(page, "first.weight")).toHaveAttribute("data-done", "no");
  await openLesson(page, "first.weight");
  await expect(lesson(page, "first.weight").locator("[data-lesson-mark]")).toHaveCount(0);
  await expect(lesson(page, "first.weight")).toContainText("ticks itself");

  // Move the real control, and it notices.
  await page
    .locator("input[type=range]")
    .first()
    .evaluate((el: HTMLInputElement) => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      set.call(el, String(Number(el.value) + 25));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
  await expect(lesson(page, "first.weight")).toHaveAttribute("data-done", "yes");
});

test("a lesson with nothing checkable is marked by hand, and says which it is", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.goto("/");
  await page.locator("[data-open-academy]").click();
  await openLesson(page, "first.word");

  // No check on this one -- you looked at a word, and nothing in the document
  // records that -- so it offers a mark and is drawn differently.
  const mark = lesson(page, "first.word").locator("[data-lesson-mark]");
  await expect(mark).toBeVisible();
  await expect(lesson(page, "first.word")).toHaveAttribute("data-done", "no");
  await mark.click();
  await expect(lesson(page, "first.word")).toHaveAttribute("data-done", "yes");
});

test("Take me there puts you where the lesson happens", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.goto("/");
  await page.getByRole("button", { name: "Try the sample font" }).click();
  await expect(page.locator("[data-glyph-cell='A']")).toBeVisible({ timeout: 45_000 });

  await page.locator("[data-open-academy]").click();
  await openLesson(page, "space.kern");
  await lesson(page, "space.kern").locator("[data-lesson-go]").click();
  // The kerning view, which is where a pair is adjusted.
  await expect(page.getByRole("button", { name: "Kerning", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("what you marked by hand is forgotten; what the font answers is not", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.goto("/");
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await page.locator("[data-open-academy]").click();

  await openLesson(page, "first.word");
  await lesson(page, "first.word").locator("[data-lesson-mark]").click();
  await expect(lesson(page, "first.word")).toHaveAttribute("data-done", "yes");
  // Being in Draw is a fact about the document, so this one is done too.
  await expect(lesson(page, "first.base")).toHaveAttribute("data-done", "yes");

  await page.locator("[data-academy-reset]").click();
  await expect(lesson(page, "first.word")).toHaveAttribute("data-done", "no");
  // And this one is still done, because it was never a claim you made.
  await expect(lesson(page, "first.base")).toHaveAttribute("data-done", "yes");
});
