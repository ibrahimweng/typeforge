/**
 * A fingerprint of every face's outlines at the weight it is actually drawn at.
 *
 * A change to a recipe or to the sweep is meant to be about the other three
 * masters. The drawn weight is the face somebody designed, and if it moves the
 * change is not a fix to the axis but a redesign nobody asked for.
 *
 * Taken from the contours rather than from the exported file, which carries a
 * timestamp and so hashes differently every run -- hashing the file says
 * everything changed whatever was done to it, which is worse than not checking.
 *
 *   npx vite-node scripts/drawnbytes.ts
 */

import { createHash } from "node:crypto";

import { startFrom, weighted } from "@/forge/document";
import { BASES } from "@/forge/style";
import { toTypeface } from "@/forge/typeface";

for (const face of BASES) {
  const forge = { ...startFrom(face), family: { drawn: 400, also: [] } };
  const typeface = await toTypeface(weighted(forge, 400), {
    familyName: "Probe",
    styleName: "Probe",
    weightClass: 400,
    merge: false,
  });
  const sum = createHash("sha256");
  let nodes = 0;
  for (const glyph of typeface.glyphs) {
    sum.update(`${glyph.name}|${glyph.advanceWidth.toFixed(3)}|`);
    for (const contour of glyph.contours) {
      sum.update(contour.closed ? "[" : "(");
      for (const node of contour.nodes) {
        nodes += 1;
        sum.update(`${node.point.x.toFixed(3)},${node.point.y.toFixed(3)};`);
      }
    }
  }
  console.log(
    `  ${face.name.padEnd(13)} ${sum.digest("hex").slice(0, 16)}  ${typeface.glyphs.length} glyphs, ${nodes} nodes`,
  );
}
