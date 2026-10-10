/**
 * The pen, the drops and the bowls of the Soft Serif, and two of its pen's
 * faults:
 *
 * - arches drawn with the pen turned further (`shoulder.angle`), the stems and
 *   the r's arm left on the face's own;
 * - a stroke thinned into its drop (`terminal.dropTaper`), so a drop can be
 *   smaller than the stroke is wide;
 * - a bowl's heft faded toward the stem it stands against (`bowl.heftFade`);
 * - the ends of an open bowl left blunt where every other end tapers
 *   (`bowl.blunt`);
 * - the s and the S at a Black on the Soft Serif's pen, which leaned like an
 *   italic, and their beaks at a text weight, which stood off the letter as
 *   stalks;
 * - the six and the nine past a Black, whose drops shut their openings.
 *
 * Each is measured on the drawn letter against the same letter drawn without
 * it, so each fails the moment its feature stops doing anything; and each
 * field left out, or at nought, draws exactly what was drawn before.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { ready } from "@/font/boolean";
import { contourArea } from "@/font/geometry";
import { contoursIntersect } from "@/font/outline";
import type { Contour, GlyphNode, Vec2 } from "@/font/types";
import { drawLetter, makeLetter } from "./build";
import { formOf, startFrom } from "./document";
import { widthedStyle } from "./family";
import { readyToShape } from "./layers";
import { LETTERS, recipeOf } from "./letters";
import { flatten, pointAt, windingAt } from "./soft";
import { SOFT_SERIF } from "./starts";
import { SANS, SERIF, type Style } from "./style";
import { foldSweep } from "./testing/fold-sweep";
import { signatureText } from "./testing/signature";

beforeAll(async () => {
  await ready();
  await readyToShape();
});

const PENS = [30, 60, 87, 142, 194, 260];
const WIDTHS = [75, 100, 125];

const atPen = (style: Style, weight: number, width = 100): Style =>
  widthedStyle({ ...style, pen: { ...style.pen, weight } }, width);

type PartsOf = Style["parts"];
/** The style with fields of one part set. */
function withPart<K extends keyof PartsOf>(
  style: Style,
  part: K,
  fields: Partial<PartsOf[K]>,
): Style {
  return { ...style, parts: { ...style.parts, [part]: { ...style.parts[part], ...fields } } };
}

/** The form a document started from the face draws each letter in. */
function formsOf(face: Style): (name: string) => string | undefined {
  const forge = startFrom(face);
  return (name) => formOf(forge, name) || undefined;
}

const drawn = (name: string, style: Style, form?: string) => {
  const made = drawLetter(name, style, form);
  if (!made) throw new Error(`${name} did not draw`);
  return made;
};

/** Points along a contour, `steps` to an edge. */
function along(contour: Contour, steps = 24): Vec2[] {
  const out: Vec2[] = [];
  const { nodes } = contour;
  for (let k = 0; k < nodes.length; k++) {
    const from = nodes[k];
    const to = nodes[(k + 1) % nodes.length];
    for (let step = 0; step < steps; step++) out.push(pointAt(from, to, step / steps));
  }
  return out;
}

/** How far a point is from the nearest edge of a set of contours, sampled finely. */
function distanceTo(points: Vec2[], point: Vec2): number {
  let best = Infinity;
  for (let k = 0; k < points.length; k++) {
    const a = points[k];
    const b = points[(k + 1) % points.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    const t =
      length > 0
        ? Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length))
        : 0;
    best = Math.min(best, Math.hypot(point.x - a.x - dx * t, point.y - a.y - dy * t));
  }
  return best;
}

/** Which of a letter's contours are inked where: the letter on a grid, nonzero. */
function raster(contours: Contour[], step: number) {
  const flat = flatten(contours, 16);
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  for (const polygon of flat.polygons) {
    xMin = Math.min(xMin, polygon.xMin);
    yMin = Math.min(yMin, polygon.yMin);
    xMax = Math.max(xMax, polygon.xMax);
    yMax = Math.max(yMax, polygon.yMax);
  }
  // A clear border all round, so the outside is one region.
  xMin -= step * 2;
  yMin -= step * 2;
  const columns = Math.ceil((xMax - xMin) / step) + 3;
  const rows = Math.ceil((yMax - yMin) / step) + 3;
  const inked: boolean[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const point = { x: xMin + (column + 0.5) * step, y: yMin + (row + 0.5) * step };
      inked.push(windingAt(flat, point) !== 0);
    }
  }
  return { inked, columns, rows, xMin, yMin, step };
}

/** How many counters a letter has: regions of no ink the outside does not reach. */
function countersOf(contours: Contour[], step = 4): number {
  const { inked, columns, rows } = raster(contours, step);
  const seen = new Uint8Array(inked.length);
  const fill = (start: number) => {
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const at = stack.pop()!;
      const row = Math.floor(at / columns);
      const column = at % columns;
      for (const [dr, dc] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const r = row + dr;
        const c = column + dc;
        if (r < 0 || c < 0 || r >= rows || c >= columns) continue;
        const next = r * columns + c;
        if (seen[next] || inked[next]) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
  };
  fill(0);
  let counters = 0;
  for (let at = 0; at < inked.length; at++) {
    if (inked[at] || seen[at]) continue;
    // A speck of a cell or two between two strokes is not a counter.
    let size = 0;
    const stack = [at];
    seen[at] = 1;
    while (stack.length > 0) {
      const here = stack.pop()!;
      size++;
      const row = Math.floor(here / columns);
      const column = here % columns;
      for (const [dr, dc] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const r = row + dr;
        const c = column + dc;
        if (r < 0 || c < 0 || r >= rows || c >= columns) continue;
        const next = r * columns + c;
        if (seen[next] || inked[next]) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    if (size > 3) counters++;
  }
  return counters;
}

/** The centre of the ink between two heights, off the letter on a grid. */
function inkCentreX(contours: Contour[], low: number, high: number, step = 3): number {
  const grid = raster(contours, step);
  let sum = 0;
  let count = 0;
  for (let row = 0; row < grid.rows; row++) {
    const y = grid.yMin + (row + 0.5) * step;
    if (y < low || y > high) continue;
    for (let column = 0; column < grid.columns; column++) {
      if (!grid.inked[row * grid.columns + column]) continue;
      sum += grid.xMin + (column + 0.5) * step;
      count++;
    }
  }
  return sum / count;
}

/** A drop's five nodes, as `drops.test.ts` tells them apart: three corners round two smooth nodes. */
interface Drop {
  O: GlyphNode;
  F: GlyphNode;
  T: GlyphNode;
  M: GlyphNode;
  B: GlyphNode;
}
function dropOf(contour: Contour): Drop | null {
  if (contour.nodes.length !== 5) return null;
  const types = contour.nodes.map((one) => (one.type === "smooth" ? "s" : "c")).join("");
  const flip = (one: GlyphNode): GlyphNode => ({
    ...one,
    handleIn: one.handleOut,
    handleOut: one.handleIn,
  });
  if (types === "csscc") {
    const [O, F, T, M, B] = contour.nodes;
    return { O, F, T, M, B };
  }
  if (types === "ccssc") {
    const [B, M, T, F, O] = contour.nodes.map(flip);
    return { O, F, T, M, B };
  }
  return null;
}

/** Each drop of a letter, with the swept stroke it hangs on. */
function dropsIn(
  name: string,
  style: Style,
  form?: string,
): Array<{ drop: Drop; ink: Contour; contour: Contour }> {
  const made = makeLetter(name, style, form);
  if (!made) throw new Error(`${name} did not draw`);
  const out: Array<{ drop: Drop; ink: Contour; contour: Contour }> = [];
  for (const run of made.runs) {
    for (const contour of run.contours) {
      const drop = dropOf(contour);
      // Not a serif's sliver buried in the stroke, which has the same five nodes
      // in little, nor a serif's wing, whose "ball" is its tip a stem away.
      if (!drop || !(ballOf(drop) > 2)) continue;
      const reach = Math.hypot(drop.F.point.x - drop.O.point.x, drop.F.point.y - drop.O.point.y);
      if (reach < ballOf(drop) * 4) out.push({ drop, ink: run.contours[0], contour });
    }
  }
  return out;
}

/** A drop's ball: its tip and its top are a quarter circle apart. */
function ballOf(drop: Drop): number {
  return Math.hypot(drop.F.point.x - drop.T.point.x, drop.F.point.y - drop.T.point.y) / Math.SQRT2;
}

describe("arches drawn with the pen turned further (shoulder.angle)", () => {
  const turned = withPart(SERIF, "shoulder", { angle: 12 });

  it("turns the pen for the arches of n, m, h, the eng and the eta, and for nothing else", () => {
    const angles = (name: string, style: Style) =>
      (recipeOf(name) ?? LETTERS[name])(style).strokes.map((stroke) => stroke.pen.angle);
    const own = SERIF.pen.angle;
    expect(angles("n", turned)).toEqual([own, own + 12]);
    expect(angles("m", turned)).toEqual([own, own + 12, own + 12]);
    expect(angles("h", turned)).toEqual([own, own + 12]);
    expect(angles("eng", turned)).toEqual([own, own + 12]);
    expect(angles("η", turned)).toEqual([own, own + 12]);
    // The r's arm is heavy where it leaves its stem, and keeps the face's pen.
    expect(angles("r", turned)).toEqual([own, own]);
    for (const name of ["i", "l", "u", "o", "b"]) {
      expect(
        angles(name, turned).every((angle) => angle === own),
        name,
      ).toBe(true);
    }
  });

  it("leaves the arch thinner where it leaves the stem", () => {
    const style = atPen(SOFT_SERIF, 87);
    const plain = withPart(style, "shoulder", { angle: 0 });
    // How deep the arch's own ink is, straight up through a point a third of
    // the way from the stem to the leg.
    const depth = (face: Style) => {
      const [, arch] = (recipeOf("n") ?? LETTERS.n)(face).strokes;
      const segments = arch.spine.segments;
      const first = segments[0];
      const last = segments[segments.length - 1];
      if (first.kind !== "arc" || last.kind !== "line") throw new Error("the arch is not as drawn");
      const from = first.centre.x - first.radius;
      const x = from + (last.from.x - from) * 0.32;
      const ink = makeLetter("n", face)!.runs[1].contours[0];
      const flat = flatten([ink], 32);
      let run = 0;
      for (let y = 0; y < 800; y += 0.25) if (windingAt(flat, { x, y }) !== 0) run += 0.25;
      return run;
    };
    expect(depth(style)).toBeLessThan(depth(plain) - 1);
  });

  it("draws exactly as before where the field is left out or nought", () => {
    for (const face of [SERIF, SANS, SOFT_SERIF]) {
      const without = { ...face, parts: { ...face.parts, shoulder: { ...face.parts.shoulder } } };
      delete without.parts.shoulder.angle;
      const nought = withPart(without, "shoulder", { angle: 0 });
      for (const name of ["n", "m", "h", "eng", "η", "r"]) {
        expect(JSON.stringify(drawn(name, nought)), `${face.name} ${name}`).toBe(
          JSON.stringify(drawn(name, without)),
        );
      }
    }
  });

  it("keeps every arched letter's points at every pen and width, and never folds", () => {
    for (const angle of [-45, 12, 45]) {
      const face = withPart(SOFT_SERIF, "shoulder", { angle });
      // Not the eng, which the Serif itself draws with other points at some of
      // these settings (see `soft-serif-strict.test.ts`): it is held to folds.
      for (const name of ["n", "m", "h", "η", "hbar", "napostrophe"]) {
        const signatures = new Set<string>();
        for (const pen of PENS) {
          for (const width of WIDTHS) {
            const made = drawn(name, atPen(face, pen, width));
            expect(
              made.contours.some((contour) => contoursIntersect([contour])),
              `${name} at ${angle}, ${pen}/${width}`,
            ).toBe(false);
            signatures.add(signatureText(made.contours));
          }
        }
        expect(signatures.size, `${name} at ${angle}`).toBe(1);
      }
    }
    expect(foldSweep("shoulder.angle", [-45, 45], ["n", "m", "h", "eng", "η"])).toEqual([]);
  });
});

describe("a stroke thinned into its drop (terminal.dropTaper)", () => {
  // A face asking for small drops, which the stroke's own width held up.
  const small = withPart(atPen(SOFT_SERIF, 87), "terminal", { dropSize: -0.3, dropTaper: 0 });
  const thinned = withPart(small, "terminal", { dropTaper: 0.7 });

  it("lets a drop be smaller than the stroke is wide", () => {
    // The c's head: its end is thick, and a drop never less than it was.
    const [held] = dropsIn("c", small, "humanist");
    const [free] = dropsIn("c", thinned, "humanist");
    expect(ballOf(free.drop)).toBeLessThan(ballOf(held.drop) * 0.85);
  });

  it("thins the stroke into the drop, which covers its end and leaves no sliver", () => {
    // At the Soft Serif's own drops, thinned as it ships and as far as the field goes.
    for (const face of [0.7, 0.85].map((dropTaper) =>
      withPart(SOFT_SERIF, "terminal", { dropTaper }),
    )) {
      for (const pen of [30, 87, 142, 260]) {
        const style = atPen(face, pen);
        const forms = formsOf(face);
        for (const name of [
          "a",
          "c",
          "f",
          "r",
          "y",
          "j",
          "question",
          "six",
          "nine",
          "two",
          "three",
        ]) {
          for (const { drop, ink, contour } of dropsIn(name, style, forms(name))) {
            // A drop with no room is closed off through its own centre: nothing to check.
            if (
              Math.hypot(drop.M.point.x - drop.T.point.x, drop.M.point.y - drop.T.point.y) < 1e-6
            ) {
              continue;
            }
            const edge = along(ink, 48);
            const label = `${name} at ${pen}`;
            // The neck comes back onto the stroke's edge as it was drawn in,
            // or into its ink where a curl has buried that edge -- never out
            // in the counter, where it stood off as a spur.
            const onEdge = distanceTo(edge, drop.M.point) < 1;
            expect(onEdge || windingAt(flatten([ink], 48), drop.M.point) !== 0, label).toBe(true);
            /*
             * And the closing edge runs through ink, so nothing of the
             * counter is left between the drop and the stroke: inked on both
             * sides of it, by the stroke or the drop, over the half of it
             * back from the drop's corner -- past where a drop closed onto its
             * foot leaves the inner edge, and short of the corner itself,
             * where the closing edge, the stroke's edge and the drop's outer
             * side all arrive together.
             */
            const both = flatten([ink, contour], 48);
            for (let step = 3; step <= 12; step++) {
              const point = pointAt(drop.B, drop.O, step / 24);
              const ahead = pointAt(drop.B, drop.O, (step + 0.01) / 24);
              const length = Math.hypot(ahead.x - point.x, ahead.y - point.y) || 1;
              const side = { x: -(ahead.y - point.y) / length, y: (ahead.x - point.x) / length };
              for (const way of [1, -1]) {
                const probe = {
                  x: point.x + side.x * way * 0.3,
                  y: point.y + side.y * way * 0.3,
                };
                expect(windingAt(both, probe) !== 0, `${label}, closing edge at ${step}/24`).toBe(
                  true,
                );
              }
            }
          }
        }
      }
    }
  });

  it("draws exactly as before where the field is left out or nought", () => {
    for (const face of [SERIF, SOFT_SERIF]) {
      const without = { ...face, parts: { ...face.parts, terminal: { ...face.parts.terminal } } };
      delete without.parts.terminal.dropTaper;
      const nought = withPart(without, "terminal", { dropTaper: 0 });
      const forms = formsOf(face);
      for (const name of ["a", "c", "f", "r", "y", "j", "six", "nine", "question"]) {
        expect(JSON.stringify(drawn(name, nought, forms(name))), `${face.name} ${name}`).toBe(
          JSON.stringify(drawn(name, without, forms(name))),
        );
      }
    }
  });

  it("keeps every drop's letter its points at every pen and width, and never folds", () => {
    for (const taper of [0.3, 0.85]) {
      const face = withPart(SOFT_SERIF, "terminal", { dropTaper: taper });
      const forms = formsOf(face);
      for (const name of [
        "a",
        "c",
        "f",
        "r",
        "y",
        "j",
        "g",
        "six",
        "nine",
        "two",
        "three",
        "question",
        "J",
      ]) {
        const signatures = new Set<string>();
        for (const pen of PENS) {
          for (const width of WIDTHS) {
            const made = drawn(name, atPen(face, pen, width), forms(name));
            expect(
              made.contours.some((contour) => contoursIntersect([contour])),
              `${name} at ${taper}, ${pen}/${width}`,
            ).toBe(false);
            signatures.add(signatureText(made.contours));
          }
        }
        expect(signatures.size, `${name} at ${taper}`).toBe(1);
      }
    }
    expect(
      foldSweep(
        "terminal.dropTaper",
        [0.85],
        ["a", "c", "f", "r", "y", "j", "six", "nine", "two", "question"],
      ),
    ).toEqual([]);
  });
});

describe("a bowl's heft faded toward its stem (bowl.heftFade)", () => {
  const heavy = withPart(atPen(SOFT_SERIF, 87), "bowl", { heft: 0.3, heftFade: 0 });
  const faded = withPart(heavy, "bowl", { heftFade: 1 });
  const none = withPart(heavy, "bowl", { heft: 0 });

  /** The counter of a bowl: the contour wound the other way. */
  const counterOf = (name: string, style: Style): Vec2[] => {
    const holes = drawn(name, style).contours.filter((contour) => contourArea(contour) < 0);
    expect(holes.length, name).toBe(1);
    return along(holes[0], 64);
  };
  const extreme = (points: Vec2[], side: number): Vec2 =>
    points.reduce((best, point) => (point.x * side > best.x * side ? point : best));

  it("leaves the counter where the pen drew it at the stem, and moves it the whole heft across from it", () => {
    for (const [name, stem] of [
      ["p", -1],
      ["b", -1],
      ["d", 1],
      ["q", 1],
    ] as const) {
      const atStem = (style: Style) => extreme(counterOf(name, style), stem);
      const across = (style: Style) => extreme(counterOf(name, style), -stem);
      // At the stem's side the faded counter is the unhefted one ...
      expect(Math.abs(atStem(faded).y - atStem(none).y), `${name} at its stem`).toBeLessThan(0.5);
      // ... where the even heft had moved it.
      expect(
        Math.abs(atStem(heavy).y - atStem(none).y),
        `${name} hefted at its stem`,
      ).toBeGreaterThan(2);
      // And across from the stem it takes the whole heft, as the even one does.
      expect(Math.abs(across(faded).y - across(heavy).y), `${name} across`).toBeLessThan(0.5);
    }
  });

  it("is exact: the same points, the counter smooth, at every pen and width", () => {
    for (const name of ["b", "d", "p", "q"]) {
      const signatures = new Set<string>();
      for (const pen of PENS) {
        for (const width of WIDTHS) {
          const style = atPen(withPart(SOFT_SERIF, "bowl", { heft: 0.5, heftFade: 1 }), pen, width);
          const made = drawn(name, style);
          expect(
            made.contours.some((contour) => contoursIntersect([contour])),
            `${name} ${pen}/${width}`,
          ).toBe(false);
          signatures.add(signatureText(made.contours));
          // As many points as the bowl hefted evenly, lines and curves alike.
          const even = drawn(name, withPart(style, "bowl", { heftFade: 0 }));
          expect(signatureText(made.contours), `${name} ${pen}/${width}`).toBe(
            signatureText(even.contours),
          );
        }
      }
      expect(signatures.size, name).toBe(1);
    }
  });

  it("draws exactly as before where the field is left out or nought, and without a heft", () => {
    const without = {
      ...SOFT_SERIF,
      parts: { ...SOFT_SERIF.parts, bowl: { ...SOFT_SERIF.parts.bowl } },
    };
    delete without.parts.bowl.heftFade;
    const nought = withPart(without, "bowl", { heftFade: 0 });
    const unhefted = withPart(without, "bowl", { heft: 0 });
    for (const name of ["b", "d", "p", "q", "o"]) {
      expect(JSON.stringify(drawn(name, nought)), name).toBe(JSON.stringify(drawn(name, without)));
      expect(JSON.stringify(drawn(name, withPart(unhefted, "bowl", { heftFade: 1 }))), name).toBe(
        JSON.stringify(drawn(name, unhefted)),
      );
    }
  });
});

describe("the ends of an open bowl left blunt (bowl.blunt)", () => {
  const face = atPen(SOFT_SERIF, 87);
  const tapered = withPart(face, "bowl", { blunt: 0 });
  const blunt = withPart(face, "bowl", { blunt: 1 });
  const untapered = withPart(tapered, "terminal", { taper: 0 });
  const forms = formsOf(SOFT_SERIF);

  it("cuts the c's tail and the C's foot as wide as the pen leaves them", () => {
    for (const name of ["c", "C"]) {
      const form = forms(name);
      expect(JSON.stringify(drawn(name, blunt, form)), name).toBe(
        JSON.stringify(drawn(name, untapered, form)),
      );
      expect(JSON.stringify(drawn(name, tapered, form)), name).not.toBe(
        JSON.stringify(drawn(name, untapered, form)),
      );
    }
  });

  it("leaves every other end tapered: the t's tail and the a's foot", () => {
    for (const name of ["t", "a", "e", "j"]) {
      const form = forms(name);
      expect(JSON.stringify(drawn(name, blunt, form)), name).toBe(
        JSON.stringify(drawn(name, tapered, form)),
      );
    }
    expect(JSON.stringify(drawn("t", blunt, forms("t")))).not.toBe(
      JSON.stringify(drawn("t", untapered, forms("t"))),
    );
  });

  it("keeps the c, the C and the G their points at every pen and width", () => {
    for (const name of ["c", "C", "G", "cent"]) {
      const signatures = new Set<string>();
      for (const pen of PENS) {
        for (const width of WIDTHS) {
          signatures.add(
            signatureText(
              drawn(
                name,
                atPen(withPart(SOFT_SERIF, "bowl", { blunt: 1 }), pen, width),
                forms(name),
              ).contours,
            ),
          );
        }
      }
      expect(signatures.size, name).toBe(1);
    }
  });
});

describe("the s and the S on the Soft Serif's pen", () => {
  it("are drawn as a text serif's at a Black, upright and as wide as the Serif's", () => {
    for (const pen of [194, 260]) {
      for (const [name, height] of [
        ["s", SOFT_SERIF.metrics.xHeight],
        ["S", SOFT_SERIF.metrics.capHeight],
      ] as const) {
        const measure = (style: Style, form?: string) => {
          const { contours } = drawn(name, style, form);
          let xMin = Infinity;
          let xMax = -Infinity;
          for (const point of contours.flatMap((contour) => along(contour, 8))) {
            xMin = Math.min(xMin, point.x);
            xMax = Math.max(xMax, point.x);
          }
          return {
            // How far right the upper half of the ink stands of the lower half.
            lean:
              inkCentreX(contours, height * 0.55, height * 1.05) -
              inkCentreX(contours, -20, height * 0.45),
            wide: xMax - xMin,
          };
        };
        const soft = measure(atPen(SOFT_SERIF, pen), "humanist");
        const serif = measure(atPen(SERIF, pen), "humanist");
        const label = `${name} at ${pen}: lean ${soft.lean.toFixed(1)} against ${serif.lean.toFixed(1)}, ${soft.wide.toFixed(0)} wide against ${serif.wide.toFixed(0)}`;
        // Not leaning like an italic ...
        expect(Math.abs(soft.lean - serif.lean), label).toBeLessThan(25);
        // ... nor left narrow past the Bold, as a didone's would be.
        expect(Math.abs(soft.wide / serif.wide - 1), label).toBeLessThan(0.07);
      }
    }
  });

  it("hang their beaks as beaks at a text weight: narrowing to a rounded tip, not a stalk", () => {
    for (const pen of [30, 87, 142]) {
      for (const name of ["s", "S"]) {
        const { contours } = drawn(name, atPen(SOFT_SERIF, pen), "humanist");
        const beaks = contours.filter((contour) => contour.nodes.length === 6);
        expect(beaks.length, `${name} at ${pen}`).toBe(2);
        for (const beak of beaks) {
          const points = along(beak, 48);
          const ys = points.map((point) => point.y);
          const low = Math.min(...ys);
          const high = Math.max(...ys);
          // Which end is the tip: the end away from the line the bar stands on.
          const line = name === "S" ? SOFT_SERIF.metrics.capHeight : SOFT_SERIF.metrics.xHeight;
          const fromLine = Math.abs(low) < Math.abs(high - line) ? low : high;
          const tip = fromLine === low ? high : low;
          const widthAt = (y: number) => {
            const near = points.filter((point) => Math.abs(point.y - y) < (high - low) * 0.04);
            const xs = near.map((point) => point.x);
            return Math.max(...xs) - Math.min(...xs);
          };
          const root = widthAt(fromLine + (tip - fromLine) * 0.15);
          const nearTip = widthAt(fromLine + (tip - fromLine) * 0.7);
          expect(nearTip, `${name} at ${pen}`).toBeLessThan(root * 0.85);
        }
      }
    }
  });
});

describe("the beaked s and S on the Soft Serif's pen", () => {
  it("are drawn as a text serif's at a Black, upright and as wide as the Serif's", () => {
    for (const pen of [194, 260]) {
      for (const [name, height] of [
        ["s", SOFT_SERIF.metrics.xHeight],
        ["S", SOFT_SERIF.metrics.capHeight],
      ] as const) {
        const measure = (style: Style, form?: string) => {
          const { contours } = drawn(name, style, form);
          let xMin = Infinity;
          let xMax = -Infinity;
          for (const point of contours.flatMap((contour) => along(contour, 8))) {
            xMin = Math.min(xMin, point.x);
            xMax = Math.max(xMax, point.x);
          }
          return {
            lean:
              inkCentreX(contours, height * 0.55, height * 1.05) -
              inkCentreX(contours, -20, height * 0.45),
            wide: xMax - xMin,
          };
        };
        const soft = measure(atPen(SOFT_SERIF, pen), "beaked");
        const serif = measure(atPen(SERIF, pen), "humanist");
        const label = `${name} at ${pen}: lean ${soft.lean.toFixed(1)} against ${serif.lean.toFixed(1)}, ${soft.wide.toFixed(0)} wide against ${serif.wide.toFixed(0)}`;
        // Leaning no further than the Serif's s, whichever way its beaks move its ink ...
        expect(Math.abs(soft.lean), label).toBeLessThan(Math.abs(serif.lean) + 25);
        // ... never left narrow as a didone's would be, and wider only by its beaks turning out.
        expect(soft.wide / serif.wide, label).toBeGreaterThan(0.93);
        expect(soft.wide / serif.wide, label).toBeLessThan(1.2);
      }
    }
  });

  it("draw their beaks as part of the stroke: one contour, no separate beak, at every pen", () => {
    for (const pen of PENS) {
      for (const width of WIDTHS) {
        for (const name of ["s", "S"]) {
          const { contours } = drawn(name, atPen(SOFT_SERIF, pen, width), "beaked");
          expect(contours.length, `${name} at ${pen}/${width}`).toBe(1);
        }
      }
    }
  });
});

describe("the six and the nine past a Black, on a face whose drops are pears", () => {
  const forms = formsOf(SOFT_SERIF);

  it("keep their openings open: one counter each, at every heavy pen and width", () => {
    for (const pen of [194, 230, 260]) {
      for (const width of WIDTHS) {
        for (const name of ["six", "nine"]) {
          const { contours } = drawn(name, atPen(SOFT_SERIF, pen, width), forms(name));
          expect(countersOf(contours), `${name} at ${pen}/${width}`).toBe(1);
        }
      }
    }
  });
});
