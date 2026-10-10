/**
 * The arm flare (`slab.swell`, the panel's "Arm flare", nought to 0.6) on
 * every base that wears its serifs as wings, not only the two faces
 * `soft-ends.test.ts` sweeps it on.
 *
 * A swelled arm's beak keeps its buried side square across the arm, so a
 * rasteriser draws no seam along it (see `wing` in build.ts). Laid where the
 * wing leaves the arm and nowhere else, that side stood out past the flared
 * edge wherever the edge ran in further than the wing bites over its depth --
 * a short arm swelled hard, as the foot of a Slab t is, and the top of its
 * bar -- and the beak's hollow came down onto it in the paper and turned back
 * on itself. Buried a unit or two deep and all but invisible, but the outline
 * crossed itself: the t, the t with a bar and the sharp s on the Slab and the
 * Typewriter from the first step of the slider, the Z and the r's grotesque
 * arm further along it, at nearly every weight, and through a wave book too.
 * The sweep the other tests run, on the Sans with its serifs and the Serif,
 * never met an arm that short.
 *
 * So here every letter of each of these bases, at every pen and width a
 * family is drawn through, in its default form and in the form its own
 * document draws it in, with the arm flare a little way along the slider and
 * all the way, and again through a wave book recorded at the base's own
 * weight and read back at 30 and 260: nothing crosses itself.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { ready } from "@/font/boolean";
import { contoursIntersect } from "@/font/outline";
import type { Contour } from "@/font/types";
import { builtFrom, drawLetter, letterNames } from "./build";
import { formOf, startFrom } from "./document";
import { widthedStyle } from "./family";
import { readyToShape } from "./layers";
import { openWaveBook, type WaveBook, waveBookAt } from "./shapes";
import { BASES, type Style } from "./style";
import { withField } from "./testing/fold-sweep";

beforeAll(async () => {
  await ready();
  await readyToShape();
});

const PENS = [30, 60, 87, 142, 194, 260];
const WIDTHS = [75, 100, 125];
/** A little way along the slider, and all the way. */
const FLARES = [0.3, 0.6];
/**
 * Every base whose serifs are wings: the Wavy sweeps its serifs as strokes
 * instead (`sweptWing`), which has no buried side to keep square.
 */
const WINGED = ["Serif", "Fairground", "Didone", "Slab", "Typewriter"];
/** Letters built from others are their pieces, moved, as `foldSweep` has it. */
const NAMES = letterNames().filter((name) => !builtFrom(name));

const at = (style: Style, pen: number, width: number): Style =>
  widthedStyle({ ...style, pen: { ...style.pen, weight: pen } }, width);

function baseNamed(name: string): Style {
  const base = BASES.find((style) => style.name === name);
  if (!base) throw new Error(`no base named ${name}`);
  return base;
}

/** The forms to draw a letter in: its default, and its document's where that is another. */
function formsOf(face: Style): (name: string) => Array<string | undefined> {
  const forge = startFrom(face);
  return (name) => {
    const own = formOf(forge, name);
    return own ? [undefined, own] : [undefined];
  };
}

const crosses = (contours: Contour[]): boolean =>
  contours.some((contour) => contoursIntersect([contour]));

describe("the arm flare on a base that wears its serifs as wings", () => {
  it("names every such base", () => {
    for (const name of WINGED) expect(baseNamed(name).parts.slab.on, name).toBe(true);
  });

  for (const name of WINGED) {
    for (const flare of FLARES) {
      it(`crosses nothing on the ${name} at ${flare}, at every pen and width, in either form`, {
        timeout: 300_000,
      }, () => {
        const face = withField(baseNamed(name), "slab.swell", flare);
        const forms = formsOf(face);
        const folds: string[] = [];
        for (const pen of PENS) {
          for (const width of WIDTHS) {
            const style = at(face, pen, width);
            for (const letter of NAMES) {
              for (const form of forms(letter)) {
                const drawn = drawLetter(letter, style, form);
                const label = `${letter}${form ? `/${form}` : ""} at ${pen}/${width}`;
                if (!drawn) folds.push(`${label} would not draw`);
                else if (crosses(drawn.contours)) folds.push(`${label} crosses itself`);
              }
            }
          }
        }
        expect(folds).toEqual([]);
      });
    }
  }

  /*
   * Recorded at the base's own weight and read back at 30 and 260, as the
   * strict test reads the Soft Serif's. Every style the book is read at is
   * drawn once first without it: what a letter remembers against a style is
   * remembered from its first drawing.
   */
  for (const name of ["Slab", "Typewriter"]) {
    for (const flare of FLARES) {
      it(`crosses nothing on the ${name} at ${flare} through a wave book`, {
        timeout: 300_000,
      }, () => {
        const face = withField(baseNamed(name), "slab.swell", flare);
        const forge = startFrom(face);
        const form = (letter: string) => formOf(forge, letter) || undefined;
        const thin = at(face, 30, 100);
        const black = at(face, 260, 100);
        for (const one of [face, thin, black]) {
          for (const letter of NAMES) drawLetter(letter, one, form(letter));
        }
        const pages: WaveBook = {
          lengths: new Map(),
          bowls: new Map(),
          balls: new Map(),
          corners: new Map(),
          recording: true,
        };
        const folds: string[] = [];
        const was = openWaveBook(pages);
        try {
          for (const letter of NAMES) {
            pages.lengths.clear();
            pages.bowls.clear();
            pages.balls.clear();
            pages.corners.clear();
            pages.recording = true;
            for (const [label, one] of [
              ["own", face],
              ["30", thin],
              ["260", black],
            ] as const) {
              waveBookAt(letter);
              const drawn = drawLetter(letter, one, form(letter));
              if (!drawn) folds.push(`${letter} book ${label} would not draw`);
              else if (crosses(drawn.contours))
                folds.push(`${letter} book ${label} crosses itself`);
              pages.recording = false;
            }
          }
        } finally {
          openWaveBook(was);
        }
        expect(folds).toEqual([]);
      });
    }
  }
});
