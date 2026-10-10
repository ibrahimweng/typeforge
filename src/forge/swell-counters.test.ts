/**
 * The arm flare (`slab.swell`) leaves no counter of its own in the outline a
 * font is made from.
 *
 * A swelled arm's beak keeps its buried side square across the arm (see
 * `wing` in build.ts). Laid where the wing leaves the arm and nowhere else,
 * that side stood out past the flared edge wherever the edge ran in further
 * than the wing bites over its depth -- a short arm, or the end of a curved
 * tail, swelled hard -- and the beak's hollow came down onto it in the paper.
 * Where it crossed itself `swell-bases.test.ts` sees it. Where it did not,
 * the level side stood a unit or two out from the stroke over a sliver of
 * paper and closed it off: the union an export is made from came back with a
 * counter the letter does not have, a speck of paper inside the ink of the
 * sharp s, the grotesque r, j, a, t, f and feminine ordinal, the xi and the
 * Slab's and the Typewriter's Z, with the flare at its own 0.3 on the Soft
 * Serif and further along the slider elsewhere. Nothing crossed itself and
 * every test of the outline itself passed.
 *
 * So here those letters, at every pen and width a family is drawn through,
 * with the flare a little way along the slider and all the way: the export's
 * union has no more contours than the same letter drawn with no flare at all.
 * Left out are the arms that close a counter whatever their beaks do: a
 * heavy t-bar's on the Slab, the Typewriter and the Sans with serifs, and the
 * grotesque f's on the Sans, swell until they touch the stroke beside them.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { ready } from "@/font/boolean";
import { removeOverlaps } from "@/font/overlap";
import { drawLetter } from "./build";
import { widthedStyle } from "./family";
import { readyToShape } from "./layers";
import { SOFT_SERIF } from "./starts";
import { BASES, SERIF, type Style } from "./style";
import { withField } from "./testing/fold-sweep";

beforeAll(async () => {
  await ready();
  await readyToShape();
});

const PENS = [30, 60, 87, 142, 194, 260];
const WIDTHS = [75, 100, 125];
/** A little way along the slider, and all the way. */
const FLARES = [0.3, 0.6];

/** Letters whose beaks sit on short swelled arms and curved tails, as `name` or `name/form`. */
const SHORT = [
  "germandbls",
  "Z",
  "ξ",
  "r/grotesque",
  "j/grotesque",
  "a/grotesque",
  "t/grotesque",
  "ordfeminine/grotesque",
];

function baseNamed(name: string): Style {
  const base = BASES.find((style) => style.name === name);
  if (!base) throw new Error(`no base named ${name}`);
  return base;
}

const FACES: Array<[string, Style, string[]]> = [
  ["the Soft Serif", SOFT_SERIF, [...SHORT, "tbar", "f/grotesque"]],
  ["the Serif", SERIF, [...SHORT, "tbar", "f/grotesque"]],
  ["the Slab", baseNamed("Slab"), [...SHORT, "f/grotesque"]],
  ["the Typewriter", baseNamed("Typewriter"), [...SHORT, "f/grotesque"]],
  ["the Sans with serifs", withField(baseNamed("Sans"), "slab.on", true), SHORT],
];

/** The face with no flare at all, as a base without one draws it. */
function unflared(face: Style): Style {
  const { swell: _, ...slab } = face.parts.slab;
  return { ...face, parts: { ...face.parts, slab } };
}

const at = (style: Style, pen: number, width: number): Style =>
  widthedStyle({ ...style, pen: { ...style.pen, weight: pen } }, width);

/** How many contours the export keeps of a letter: its outsides and its counters. */
async function kept(name: string, style: Style, form: string | undefined): Promise<number> {
  const drawn = drawLetter(name, style, form);
  if (!drawn) throw new Error(`${name} would not draw`);
  return (await removeOverlaps(drawn.contours, "winding")).length;
}

describe("the arm flare leaves no counter of its own", () => {
  for (const [label, face, letters] of FACES) {
    it(`adds no contour to the export on ${label}, at every pen and width`, {
      timeout: 300_000,
    }, async () => {
      const plain = unflared(face);
      const flared = FLARES.map((flare) => withField(face, "slab.swell", flare));
      const added: string[] = [];
      for (const pen of PENS) {
        for (const width of WIDTHS) {
          for (const letter of letters) {
            const [name, form] = letter.split("/");
            const none = await kept(name, at(plain, pen, width), form);
            for (const [index, style] of flared.entries()) {
              const some = await kept(name, at(style, pen, width), form);
              if (some > none) {
                added.push(
                  `${letter} at ${pen}/${width}, flare ${FLARES[index]}: ${none} -> ${some}`,
                );
              }
            }
          }
        }
      }
      expect(added).toEqual([]);
    });
  }
});
