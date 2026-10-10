/**
 * An arm swelled toward its beak (`slab.swell`), met cleanly by the beak.
 *
 * The beak is a wing laid on the arm's end, its hollow coming down onto the
 * arm's edge and its buried side running back inside the arm. Swelled, that
 * edge flares, and the wing has to follow the edge the sweep actually draws:
 * on a pen held at an angle the reach across a level arm is longer than the
 * arm is half-wide, and a hollow laid off that reach came down three units
 * clear of the edge at a text weight and ten at a Black -- a step where the
 * arm met its beak, on the E, the F, the L, the T and both zeds. And the
 * buried side leaned with the flare, a long edge a hair off level inside the
 * arm that a rasteriser drew as a seam along the beak's foot.
 *
 * Asked of the Soft Serif, which swells its arms, at every master; and of the
 * Serif with the arms swelled, where the pen is held nearly upright.
 */

import { describe, expect, it } from "vitest";

import type { Contour, GlyphNode, Vec2 } from "@/font/types";
import { makeLetter } from "./build";
import { widthedStyle } from "./family";
import { flatten, windingAt } from "./soft";
import { SOFT_SERIF } from "./starts";
import { SERIF, type Style } from "./style";
import { withField } from "./testing/fold-sweep";

const PENS = [30, 60, 87, 142, 194, 260];
const WIDTHS = [75, 100, 125];
/** Every letter whose arm wears a beak, and the copies of them other scripts draw. */
const ARMED = ["E", "F", "L", "T", "Z", "z", "Ε", "Е", "Ζ", "Г", "Γ"];

const at = (style: Style, pen: number, width: number): Style =>
  widthedStyle({ ...style, pen: { ...style.pen, weight: pen } }, width);

/** One handle and not the other: the two ends of a beak's one curve. */
const halfHandled = (node: GlyphNode): boolean =>
  (node.handleIn === null) !== (node.handleOut === null);
const bare = (node: GlyphNode): boolean => node.handleIn === null && node.handleOut === null;
const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** How far a point is from the nearest edge of a contour flattened to a polygon. */
function fromEdge(point: Vec2, contour: Contour): number {
  const ring = flatten([contour]).polygons[0].points;
  let nearest = Infinity;
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k];
    const b = ring[(k + 1) % ring.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    const t =
      length > 0
        ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length))
        : 0;
    nearest = Math.min(nearest, distance(point, { x: a.x + dx * t, y: a.y + dy * t }));
  }
  return nearest;
}

interface Beak {
  where: string;
  /** The stroke the beak is laid on, as swept. */
  arm: Contour;
  /** Where the beak's hollow comes down onto the arm. */
  meet: Vec2;
  /** The ends of the beak's buried side: at the arm's end, and under the hollow. */
  buriedAtEnd: Vec2;
  buriedUnderMeet: Vec2;
}

/**
 * Every beak hanging off a level arm in a letter: a wing of five nodes, its
 * one curve running from its tip to the arm, reaching well past the arm.
 */
function beaksOf(name: string, style: Style, where: string): Beak[] {
  const made = makeLetter(name, style, style.forms?.[name]);
  if (!made) return [];
  const found: Beak[] = [];
  for (const run of made.runs) {
    const [arm, ...hung] = run.contours;
    if (!arm) continue;
    const armInk = flatten([arm]);
    for (const wing of hung) {
      const { nodes } = wing;
      if (nodes.length !== 5) continue;
      const ends = nodes.map((node, k) => [node, k] as const).filter(([node]) => halfHandled(node));
      if (ends.length !== 2) continue;
      // The hollow's end on the arm is the one nearer the arm's edge, and the
      // other is on the tip; the node beside the first with no handles is the
      // buried side's far end.
      const [[meet, k], [tip]] = [...ends].sort(
        ([a], [b]) => fromEdge(a.point, arm) - fromEdge(b.point, arm),
      );
      // A beak, not a sliver buried in the arm: its tip stands well out of it.
      if (windingAt(armInk, tip.point) !== 0 || fromEdge(tip.point, arm) < 20) continue;
      // Round the wing from the hollow's end: the buried side's two ends, the
      // one under the hollow and the one on the arm's end.
      const step = bare(nodes[(k + 1) % 5]) ? 1 : 4;
      const under = nodes[(k + step) % 5];
      const end = nodes[(k + 2 * step) % 5];
      if (!bare(under) || !bare(end)) continue;
      // Only a beak on a level arm: its buried side runs along the arm.
      if (Math.abs(under.point.x - end.point.x) < Math.abs(under.point.y - end.point.y)) continue;
      found.push({
        where,
        arm,
        meet: meet.point,
        buriedAtEnd: end.point,
        buriedUnderMeet: under.point,
      });
    }
  }
  return found;
}

function everyBeak(face: Style): Beak[] {
  const all: Beak[] = [];
  for (const pen of PENS) {
    for (const width of WIDTHS) {
      const style = at(face, pen, width);
      for (const name of ARMED) all.push(...beaksOf(name, style, `${name} at ${pen}/${width}`));
    }
  }
  return all;
}

const FACES: Array<[string, Style]> = [
  ["the Soft Serif", SOFT_SERIF],
  ["the Serif with its arms swelled", withField(SERIF, "slab.swell", 0.3)],
];

describe("a beak on a swelled arm", () => {
  for (const [label, face] of FACES) {
    const beaks = everyBeak(face);

    it(`is found on every armed letter, on ${label}`, () => {
      for (const name of ["E", "F", "L", "T", "Z", "z"]) {
        expect(
          beaks.some((beak) => beak.where.startsWith(`${name} at`)),
          name,
        ).toBe(true);
      }
    });

    it(`comes down onto the flared edge, a hair inside it, never short of it, on ${label}`, {
      timeout: 120_000,
    }, () => {
      const steps: string[] = [];
      for (const beak of beaks) {
        const inside = windingAt(flatten([beak.arm]), beak.meet) !== 0;
        const off = fromEdge(beak.meet, beak.arm);
        // A step is the hollow ending in the paper beside the arm; a notch is
        // it ending deep inside, crossing the edge at a corner on its way. It
        // is laid half a unit in, and where the arm's edge has begun to turn
        // into the corner beside it -- a Black zed at its narrowest -- a
        // little more.
        if (!inside || off > 1) {
          steps.push(`${beak.where}: ${inside ? "inside" : "outside"} by ${off.toFixed(2)}`);
        }
      }
      expect(steps).toEqual([]);
    });

    it(`runs its buried side square across the arm, so it draws no seam, on ${label}`, {
      timeout: 120_000,
    }, () => {
      const leaning: string[] = [];
      for (const beak of beaks) {
        const along = {
          x: beak.buriedUnderMeet.x - beak.buriedAtEnd.x,
          y: beak.buriedUnderMeet.y - beak.buriedAtEnd.y,
        };
        // The arm is level: the buried side runs level with it.
        const lean = Math.abs(along.y) / Math.max(Math.abs(along.x), 1e-9);
        if (lean > 1e-9) leaning.push(`${beak.where}: leans ${lean.toExponential(2)}`);
      }
      expect(leaning).toEqual([]);
    });
  }
});
