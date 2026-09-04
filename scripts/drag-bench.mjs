/**
 * What one pull of one slider costs the person doing the pulling.
 *
 * Not how long the arithmetic takes -- how long the window is unable to answer
 * while it happens, and the longest single stretch of that, which is the number
 * that decides whether a control feels alive or dead. A page can spend ten
 * seconds working and stay usable; it cannot spend one second in a single task
 * and stay usable.
 *
 * Wants a dev server already up:
 *
 *   npx vite --host 127.0.0.1 --port 5173 &
 *   node scripts/drag-bench.mjs
 *
 * Measured this way, ten steps each, before and after the work that made the
 * draw page keep up. The middle column is time the window could not answer in;
 * the last is the longest single stretch of it, which is the one that decides
 * whether the page feels broken.
 *
 *                            drag            blocked   worst task
 *   Squareness (no cast)     2.6s ->  2.7s      1.7s   0.4s
 *   Shadow: How far          124s ->  2.2s      2.7s   12.0s -> 0.4s
 *   Rim: Thickness           185s ->  1.9s      1.8s   16.9s -> 0.3s
 *   Inline: Width            296s ->  1.9s      1.1s   28.2s -> 0.3s
 *   Fillets: Size            424s ->  2.2s      2.0s   37.9s -> 0.3s
 */
import { chromium } from "playwright";

const CASES = [
  ["part", "squareness", "Squareness (no cast)"],
  ["cast", "extrude:distance", "Shadow: How far"],
  ["cast", "outline:width", "Rim: Thickness"],
  ["cut", "inline:width", "Inline: Width"],
  ["cast", "weld:size", "Fillets: Size"],
];
const STEPS = 10;

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});

for (const [kind, what, label] of CASES) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
  await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await page.waitForTimeout(2500);
  const gotIt = page.getByRole("button", { name: "Got it" });
  if (await gotIt.count()) {
    await gotIt.first().click();
    await page.waitForTimeout(300);
  }

  let slider;
  if (kind === "part") {
    slider = page.locator(`[data-slot="slider"]`).nth(3);
  } else {
    const [name, key] = what.split(":");
    const sw = page.locator(`[data-cut-switch="${name}"]`);
    await sw.scrollIntoViewIfNeeded();
    await sw.click();
    await page.waitForSelector(`[data-cut-control="${name}:${key}"]`, { timeout: 600000 });
    await page.waitForTimeout(6000);
    slider = page.locator(`[data-cut-control="${name}:${key}"] [data-slot="slider"]`).first();
  }
  await slider.scrollIntoViewIfNeeded();
  const box = await slider.boundingBox();

  await page.evaluate(() => {
    globalThis.__long = [];
    globalThis.__t0 = performance.now();
    new PerformanceObserver((l) => {
      for (const e of l.getEntries())
        globalThis.__long.push([Math.round(e.startTime - globalThis.__t0), Math.round(e.duration)]);
    }).observe({ entryTypes: ["longtask"] });
  });

  const y = box.y + box.height / 2;
  const x0 = box.x + box.width * 0.05;
  const x1 = box.x + box.width * 0.6;
  const started = Date.now();
  await page.mouse.move(x0, y);
  await page.mouse.down();
  for (let i = 1; i <= STEPS; i++) await page.mouse.move(x0 + ((x1 - x0) * i) / STEPS, y);
  await page.mouse.up();
  const drag = Date.now() - started;
  // Let everything the release set off finish before calling the pull done.
  await page.waitForTimeout(15000);
  const long = await page.evaluate(() => globalThis.__long);
  const blocked = long.reduce((sum, [, ms]) => sum + Math.max(0, ms - 50), 0);
  const worst = Math.max(0, ...long.map(([, ms]) => ms));
  console.log(
    `${label.padEnd(22)} drag ${String(drag).padStart(6)} ms   blocked ${String(blocked).padStart(6)} ms   worst task ${String(worst).padStart(6)} ms`,
  );
  await page.close();
}
await browser.close();
