/**
 * The Soft Serif's arm and head fields at the ends of their ranges.
 *
 * The middle arm (`metrics.middleArm`) is a share of the other arms' reach
 * from the stem's centre, held to half of it at the least -- but at a Black
 * the stem covers most of a short arm, and at half its reach the middle arm
 * of a narrow Black E stood six units out of its stem where the others stood
 * 133: an L with a stub on it, which the least was there to prevent. Now it
 * never shows less than a third of what the others show past the stem.
 *
 * A kept head (`slab.headKeep`) stands an arch's stem on the x-height where
 * the arch stops short of it. The panel's arch height runs on past one, and
 * there the stem was still stopped on the x-height, under its own arch's
 * top; now it goes up with the arch, as it does on a face that does not ask.
 *
 * And the Grotesque's E and F, drawn to Geist's measures with every arm its
 * own length, keep their arms whatever the middle arm is set to, as the
 * field says.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { ready } from "@/font/boolean";
import type { Contour } from "@/font/types";
import { drawLetter, makeLetter } from "./build";
import { widthedStyle } from "./family";
import { readyToShape } from "./layers";
import { frame, middleBar, stemSide } from "./letters/common";
import { flatten } from "./soft";
import { SOFT_SERIF } from "./starts";
import { BASES, SERIF, type Style } from "./style";
import { withField } from "./testing/fold-sweep";

beforeAll(async () => {
  await ready();
  await readyToShape();
});

const PENS = [30, 60, 87, 142, 194, 260];
const WIDTHS = [75, 100, 125];

const at = (style: Style, pen: number, width = 100): Style =>
  widthedStyle({ ...style, pen: { ...style.pen, weight: pen } }, width);

/** A letter's contours in its own frame, before it was slid to fit its advance. */
function unslid(name: string, style: Style, form?: string): Contour[] {
  const made = makeLetter(name, style, form ?? style.forms?.[name])!;
  return made.runs.flatMap((run) =>
    run.contours.map((contour) => ({
      ...contour,
      nodes: contour.nodes.map((node) => ({
        ...node,
        point: { x: node.point.x - made.slide, y: node.point.y },
      })),
    })),
  );
}

/** How far right the ink reaches along a level line: the last crossing of any outline. */
function rightmost(contours: Contour[], y: number): number {
  let most = -Infinity;
  for (const { points } of flatten(contours, 48).polygons) {
    for (let k = 0; k < points.length; k++) {
      const a = points[k];
      const b = points[(k + 1) % points.length];
      if ((a.y - y) * (b.y - y) > 0 || a.y === b.y) continue;
      most = Math.max(most, a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
  }
  return most;
}

describe("the middle arm at its least", () => {
  const FACES: Array<[string, Style]> = [
    ["the Soft Serif", SOFT_SERIF],
    ["the Serif", SERIF],
  ];

  for (const [label, face] of FACES) {
    it(`shows at least a third of what the arm over it shows past the stem, on ${label}`, () => {
      const short: string[] = [];
      for (const pen of PENS) {
        for (const width of WIDTHS) {
          const style = at(withField(face, "metrics.middleArm", 0.5), pen, width);
          const f = frame(style);
          const stemRight = f.edge + stemSide(f);
          const top = f.cap - f.upright * f.bar;
          const middle = middleBar(f, f.cap);
          for (const name of ["E", "F"]) {
            const contours = unslid(name, style);
            const over = rightmost(contours, top) - stemRight;
            const shows = rightmost(contours, middle) - stemRight;
            if (shows < over / 3 - 0.5) {
              short.push(`${name} at ${pen}/${width}: ${shows.toFixed(1)} of ${over.toFixed(1)}`);
            }
          }
        }
      }
      expect(short).toEqual([]);
    });
  }

  it("is still half the others' reach where the stem covers little of it", () => {
    for (const pen of [30, 60, 87]) {
      const style = at(SERIF, pen);
      for (const name of ["E", "F", "AE", "OE"]) {
        const half = drawLetter(name, withField(style, "metrics.middleArm", 0.5))?.contours;
        const less = drawLetter(name, withField(style, "metrics.middleArm", 0.3))?.contours;
        expect(less, `${name} at ${pen}`).toEqual(half);
      }
    }
  });

  it("asks nothing more of the Soft Serif's own share, at any pen or width", () => {
    // At 0.69 the Soft Serif's middle arm shows less than a third nowhere.
    for (const pen of PENS) {
      for (const width of WIDTHS) {
        const style = at(SOFT_SERIF, pen, width);
        const f = frame(style);
        const reach = f.capBowl * 1.15;
        const side = stemSide(f);
        expect(reach * 0.69 - side, `${pen}/${width}`).toBeGreaterThan((reach - side) / 3);
      }
    }
  });
});

describe("a kept head on an arch raised past the x-height", () => {
  for (const crest of [1, 1.02, 1.05]) {
    it(`draws the n, the m and the h as an unkept head does, at an arch height of ${crest}`, () => {
      const differ: string[] = [];
      const raised = withField(SOFT_SERIF, "shoulder.crest", crest);
      for (const pen of PENS) {
        for (const width of [75, 125]) {
          for (const name of ["n", "m", "h"]) {
            const kept = drawLetter(name, at(raised, pen, width), raised.forms?.[name]);
            const unkept = drawLetter(
              name,
              at(withField(raised, "slab.headKeep", false), pen, width),
              raised.forms?.[name],
            );
            if (JSON.stringify(kept?.contours) !== JSON.stringify(unkept?.contours)) {
              differ.push(`${name} at ${pen}/${width}`);
            }
          }
        }
      }
      expect(differ).toEqual([]);
    });
  }

  it("stands the n's stem as high as its arch at the panel's highest arch", () => {
    const raised = withField(SOFT_SERIF, "shoulder.crest", 1.05);
    for (const pen of [30, 87, 260]) {
      const style = at(raised, pen);
      const made = makeLetter("n", style, style.forms?.n)!;
      const [stem] = made.runs[0].contours;
      const stemTop = Math.max(...stem.nodes.map((node) => node.point.y));
      expect(stemTop, `n at ${pen}`).toBeGreaterThan(style.metrics.xHeight + 1);
    }
  });
});

describe("the Grotesque's E and F", () => {
  const sans = BASES.find((base) => base.name === "Sans")!;
  const FACES: Array<[string, Style]> = [
    ["the Sans", sans],
    ["the Soft Serif", SOFT_SERIF],
  ];

  for (const [label, face] of FACES) {
    it(`keep the arms they are measured to whatever the middle arm is set to, on ${label}`, () => {
      for (const pen of [30, 87, 260]) {
        for (const name of ["E", "F"]) {
          const plain = withField(face, "metrics.middleArm", 0.86);
          const own = drawLetter(name, at(plain, pen), "grotesque")?.contours;
          for (const share of [0.5, 0.69, 1]) {
            const said = drawLetter(
              name,
              at(withField(face, "metrics.middleArm", share), pen),
              "grotesque",
            )?.contours;
            expect(said, `${name} at ${pen}, ${share}`).toEqual(own);
          }
        }
      }
    });
  }
});
