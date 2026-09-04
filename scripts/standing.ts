/**
 * Which letters cannot follow the weight axis, and where they come apart.
 *
 * Two weights can only be joined where they are drawn with the same points, so
 * a letter that gains or loses a node somewhere along the axis is left at one
 * master for the rest of it -- a Regular `G` in a Black word. The count alone
 * does not say what to fix, so this reports each letter contour by contour: how
 * many points at each weight, where that contour sits, and which one changed.
 *
 * It reads the drawings the way the exporter does rather than the way they come
 * off the pen, because that is where the comparison actually happens: the same
 * `weightedStyle` the family uses, `merge: false` as the varying path asks for,
 * and the curves cut into the fixed number of pieces a varying font is written
 * with. A diagnostic run on the raw strokes agrees about ten letters and misses
 * six, which is the sort of near-miss that sends a morning the wrong way.
 *
 *   npx vite-node scripts/standing.ts
 *   ONLY="G,M,yen" npx vite-node scripts/standing.ts
 */

import { buildGlyfTables } from "@/font/glyf";
import { PIECES_PER_CURVE } from "@/font/variable";
import { deliver } from "@/forge/deliver";
import { correctDirection } from "@/font/outline";
import { startFrom, weighted } from "@/forge/document";
import { BASES, SANS } from "@/forge/style";
import { toTypeface } from "@/forge/typeface";

const WEIGHTS = [100, 400, 700, 900];
const DRAWN = 400;
const only = process.env.ONLY?.split(",").map((one) => one.trim());
const face = BASES.find((one) => one.name === (process.env.FACE ?? "Sans")) ?? SANS;

/** Every glyph's points, as the gvar builder will see them. */
async function pointsAt(weight: number) {
  const forge = { ...startFrom(face), family: { drawn: DRAWN, also: WEIGHTS } };
  const typeface = await toTypeface(weighted(forge, weight), {
    familyName: "Probe",
    styleName: "Probe",
    weightClass: weight,
    merge: false,
  });
  const built = buildGlyfTables(
    typeface.glyphs.map((glyph) => ({
      contours: correctDirection(glyph.contours, "truetype", "winding"),
      advanceWidth: glyph.advanceWidth,
      rebuild: true,
    })),
    0.5,
    // What the varying path asks for, taken from the varying path rather than
    // written down again: a diagnostic that splits curves a different number of
    // ways from the exporter answers a question nobody asked.
    PIECES_PER_CURVE,
    true,
  );
  return new Map(typeface.glyphs.map((glyph, index) => [glyph.name, built.points[index]]));
}

/*
 * The verdict comes from the exporter, not from the reading above.
 *
 * `pointsAt` walks the same steps the varying path walks and it is not the
 * same walk: it misses whatever `masterOf` does to a master on the way, and a
 * replica that is nearly the exporter answers nearly the question. It said
 * five letters had been fixed and the file said one. So the list of letters
 * left standing is asked of a delivered font, and the replica is kept only for
 * saying where in a letter the two masters part company.
 */
const delivered = await deliver(
  { ...startFrom(face), family: { drawn: DRAWN, also: WEIGHTS.filter((w) => w !== DRAWN) } },
  { familyName: "Probe", format: "ttf", variable: true },
);
const held = new Set(delivered.held);

const byWeight = new Map<number, Map<string, { x: number; y: number; onCurve: boolean }[]>>();
for (const weight of WEIGHTS) byWeight.set(weight, await pointsAt(weight));

const names = only ?? [...byWeight.get(DRAWN)!.keys()];
const drifted: string[] = [];

for (const name of names) {
  const runs = WEIGHTS.map((weight) => byWeight.get(weight)!.get(name));
  if (runs.some((one) => one === undefined || one.length === 0)) continue;
  const kindOf = (points: NonNullable<(typeof runs)[number]>) =>
    points.map((point) => (point.onCurve ? "-" : "o")).join("");
  const kinds = runs.map((one) => kindOf(one!));
  if (new Set(kinds).size === 1) continue;

  drifted.push(name);
  console.log(
    `\n${name}${held.has(name) ? "" : " (the replica only)"}: ` +
      WEIGHTS.map((w, i) => `${w}:${runs[i]!.length}`).join("  "),
  );

  // Where the two shapes stop agreeing, walked from the front and from the back.
  const base = kinds[WEIGHTS.indexOf(DRAWN)];
  for (let i = 0; i < WEIGHTS.length; i++) {
    if (kinds[i] === base) continue;
    let front = 0;
    while (front < kinds[i].length && front < base.length && kinds[i][front] === base[front])
      front++;
    let back = 0;
    while (
      back < kinds[i].length - front &&
      back < base.length - front &&
      kinds[i][kinds[i].length - 1 - back] === base[base.length - 1 - back]
    )
      back++;
    const at = runs[i]![Math.min(front, runs[i]!.length - 1)];
    console.log(
      `    ${String(WEIGHTS[i]).padStart(3)} differs from the ${DRAWN} after ${front} points ` +
        `and before the last ${back}, around (${at.x.toFixed(0)},${at.y.toFixed(0)})`,
    );
  }
}

const missed = [...held].filter((one) => !drifted.includes(one));
console.log(`\n${face.name}: the file leaves ${held.size} standing: ${[...held].sort().join(" ")}`);
console.log(
  `  the replica finds ${drifted.length}${missed.length ? `, and misses ${missed.join(" ")}` : ""}`,
);
