/**
 * Where two masters of one letter stop agreeing, node by node.
 *
 * `standing.ts` says a letter comes apart and roughly where. This says what is
 * actually there: the two node lists side by side from a little before the
 * first disagreement, so the piece that appears at one weight and not the other
 * can be read off rather than guessed at.
 *
 *   LETTER=two FACE=Display npx vite-node scripts/apart.ts
 */

import { buildGlyfTables } from "@/font/glyf";
import { PIECES_PER_CURVE } from "@/font/variable";
import { correctDirection } from "@/font/outline";
import { startFrom, weighted } from "@/forge/document";
import { BASES, SANS } from "@/forge/style";
import { toTypeface } from "@/forge/typeface";

const WEIGHTS = (process.env.WEIGHTS ?? "100,400").split(",").map(Number);
const letter = process.env.LETTER ?? "two";
const face = BASES.find((one) => one.name === (process.env.FACE ?? "Display")) ?? SANS;

async function pointsAt(weight: number) {
  const forge = { ...startFrom(face), family: { drawn: 400, also: [100, 400, 700, 900] } };
  const typeface = await toTypeface(weighted(forge, weight), {
    familyName: "Probe",
    styleName: "Probe",
    weightClass: weight,
    merge: false,
  });
  const built = buildGlyfTables(
    typeface.glyphs.map((glyph) => ({
      contours: correctDirection(glyph.contours, "winding"),
      advanceWidth: glyph.advanceWidth,
    })),
    0.5,
    PIECES_PER_CURVE,
    true,
  );
  const at = typeface.glyphs.findIndex((glyph) => glyph.name === letter);
  return at < 0 ? [] : built.points[at];
}

const lists = new Map<number, Awaited<ReturnType<typeof pointsAt>>>();
for (const weight of WEIGHTS) lists.set(weight, await pointsAt(weight));

/*
 * The same list with every run of points sitting on one spot collapsed to a
 * single entry saying how many there were.
 *
 * A stall -- a piece of no length, emitted so that something is emitted -- comes
 * out as several nodes on one point, and so does a corner cut back to where its
 * offsets cross. Reading the raw lists side by side is useless once they differ
 * by one, because everything after that is compared against the wrong thing.
 * Collapsed, the two can be lined up by what they are rather than by where they
 * fall.
 */
const collapsed = (list: ReadonlyArray<{ x: number; y: number; onCurve: boolean }>) => {
  const out: Array<{ x: number; y: number; count: number }> = [];
  for (const point of list) {
    const last = out[out.length - 1];
    if (last && Math.hypot(last.x - point.x, last.y - point.y) < 0.75) {
      last.count += 1;
      continue;
    }
    out.push({ x: point.x, y: point.y, count: 1 });
  }
  return out;
};

for (const weight of WEIGHTS) {
  const list = lists.get(weight)!;
  const runs = collapsed(list);
  const stalls = runs.filter((run) => run.count > 1);
  console.log(
    `${face.name} ${letter} at ${weight}: ${list.length} points, ` +
      `${runs.length} places, ${stalls.length} of them stood still ` +
      `(${stalls.reduce((n, r) => n + r.count, 0)} points)`,
  );
  console.log(`   stalls: ${stalls.map((r) => `${r.count}@(${r.x.toFixed(0)},${r.y.toFixed(0)})`).join("  ")}`);
}
