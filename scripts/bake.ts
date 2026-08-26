/**
 * What a textured font actually costs, and whether it is a font at all.
 *
 *   npx vite-node scripts/bake.ts
 */
import { ready } from "@/font/boolean";
import { noEffects } from "@/forge/effects";
import { deliver } from "@/forge/deliver";
import { startFrom } from "@/forge/document";
import { BASES } from "@/forge/style";

await ready();
const base = BASES.find((one) => one.name === "Sans")!;

for (const [label, effects] of [
  ["plain", undefined],
  ["rough", (() => { const e = noEffects(); e.rough.on = true; return e; })()],
  ["marker", (() => {
    const e = noEffects();
    e.rough.on = true;
    e.pool.on = true;
    return e;
  })()],
  ["all four", (() => {
    const e = noEffects();
    e.rough.on = true; e.pool.on = true; e.skip.on = true; e.press.on = true;
    return e;
  })()],
] as const) {
  const forge = { ...startFrom(base), effects: effects ?? undefined };
  const at = performance.now();
  const made = await deliver(forge, { familyName: "Proof", format: "ttf" });
  const bytes = made.bytes.length;
  console.log(
    `${label.padEnd(9)} ${(bytes / 1024).toFixed(0).padStart(5)}KB   ${Math.round(performance.now() - at)}ms   ${made.fileName}`,
  );
}
