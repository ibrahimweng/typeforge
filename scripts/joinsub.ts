/**
 * What a joined face actually ships, read back out of the exported file.
 *
 * Exports each script face, opens the result with fontTools, and prints the
 * alternates and the rule that reaches them. The point is to check the whole
 * path at once -- the second drawings are built, they are in the font, the
 * table names them by the ids they ended up with, and the reference
 * implementation can read the lot.
 *
 *   npx vite-node scripts/joinsub.ts             every joined face
 *   npx vite-node scripts/joinsub.ts Handwriting one of them
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ready } from "@/font/boolean";
import { deliver } from "@/forge/deliver";
import { startFrom } from "@/forge/document";
import { BASES } from "@/forge/style";

await ready();

const wanted = process.argv[2];
const faces = BASES.filter((one) => (wanted ? one.name === wanted : one.parts.script.on));
const dir = mkdtempSync(join(tmpdir(), "joinsub-"));

for (const base of faces) {
  const forge = startFrom(base);
  const made = await deliver(forge, { familyName: base.name.replace(/\s+/g, ""), format: "ttf" });
  const file = join(dir, `${base.name.replace(/\s+/g, "")}.ttf`);
  writeFileSync(file, made.bytes);
  console.log(`\n${base.name}: ${(made.bytes.length / 1024).toFixed(0)}KB  ${made.fileName}`);
  for (const step of [
    ["scripts/joinsub.py", file],
    ["scripts/shape.py", file, "on,oa,oo,ow,br,ve,no,an,handwriting"],
  ]) {
    const run = spawnSync("python3", step, { encoding: "utf8" });
    console.log(run.stdout ?? "");
    if (run.status !== 0) {
      console.error(run.stderr);
      process.exit(1);
    }
  }
}
