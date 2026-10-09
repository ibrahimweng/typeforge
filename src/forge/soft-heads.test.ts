/**
 * The heads of the lowercase stems: kept on the x-height on a face whose
 * arches stop short of it (`slab.headKeep`), and drawn deeper where the face
 * asks (`slab.headDepth`).
 *
 * A shoulder that stops short of the x-height (`shoulder.crest` below one)
 * takes the stem it springs from down with it, so the stem does not poke up
 * past its own arch; but a sloped head is laid on a line, and the n and the m
 * of such a face went bare beside an i, an r and a p wearing theirs. Kept,
 * they stand on the x-height and wear the i's head exactly. And a soft text
 * face's flag runs further down its stem than a text weight's.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { ready } from "@/font/boolean";
import { contoursIntersect } from "@/font/outline";
import type { Contour } from "@/font/types";
import { drawLetter, makeLetter } from "./build";
import { widthedStyle } from "./family";
import { readyToShape } from "./layers";
import { openWaveBook, type WaveBook, waveBookAt } from "./shapes";
import { SOFT_SERIF } from "./starts";
import { SERIF, type Style } from "./style";
import { foldSweep, withField } from "./testing/fold-sweep";
import { signatureText } from "./testing/signature";

beforeAll(async () => {
  await ready();
  await readyToShape();
});

const PENS = [30, 60, 87, 142, 194, 260];
const WIDTHS = [75, 100, 125];

const at = (style: Style, pen: number, width = 100): Style =>
  widthedStyle({ ...style, pen: { ...style.pen, weight: pen } }, width);

/** The Serif with its arches stopped short of the x-height, as the Soft Serif's are. */
const SHORT = withField(SERIF, "shoulder.crest", 0.97);
const KEPT = withField(SHORT, "slab.headKeep", true);

/**
 * A letter's first run -- its stem -- in the letter's own frame, before it was
 * slid to fit its advance: the swept stem, and the serifs on its head (every
 * other contour of the run lying wholly above the middle of the x-height).
 */
function stemOf(name: string, style: Style): { stem: Contour; head: Contour[] } {
  const made = makeLetter(name, style, style.forms?.[name])!;
  const moved = made.runs[0].contours.map((contour) => ({
    ...contour,
    nodes: contour.nodes.map((node) => ({
      ...node,
      point: { x: node.point.x - made.slide, y: node.point.y },
      handleIn: node.handleIn && { x: node.handleIn.x - made.slide, y: node.handleIn.y },
      handleOut: node.handleOut && { x: node.handleOut.x - made.slide, y: node.handleOut.y },
    })),
  }));
  const half = style.metrics.xHeight / 2;
  const [stem, ...hung] = moved;
  return {
    stem,
    head: hung.filter((contour) => contour.nodes.every((node) => node.point.y > half)),
  };
}

const topOf = (contour: Contour): number => Math.max(...contour.nodes.map((node) => node.point.y));
const leftOf = (contour: Contour): number => Math.min(...contour.nodes.map((node) => node.point.x));

/** The contours moved across by `dx`, to the last bit of every node rounded to a millionth. */
function said(contours: Contour[], dx: number): string {
  const r = (v: number) => Math.round(v * 1e6) / 1e6;
  return JSON.stringify(
    contours.map((contour) =>
      contour.nodes.map((node) => [
        r(node.point.x + dx),
        r(node.point.y),
        node.handleIn && [r(node.handleIn.x + dx), r(node.handleIn.y)],
        node.handleOut && [r(node.handleOut.x + dx), r(node.handleOut.y)],
      ]),
    ),
  );
}

describe("a stem an arch springs from, its head kept", () => {
  it("stops with its arch where the face does not keep it, as it always has", () => {
    for (const name of ["n", "m"]) {
      const { stem, head } = stemOf(name, at(SHORT, 87));
      expect(topOf(stem), name).toBeLessThan(SHORT.metrics.xHeight - 5);
      // Nothing on its head but the slivers a refused serif leaves in the ink.
      const flag = head.filter((contour) => leftOf(contour) < leftOf(stem) - 1);
      expect(flag, name).toEqual([]);
    }
  });

  for (const [label, face] of [
    ["the Serif with short arches", KEPT],
    ["the Soft Serif", withField(SOFT_SERIF, "slab.headKeep", true)],
  ] as const) {
    it(`stands the n's and the m's stems on the x-height wearing the i's head, on ${label}`, () => {
      const differ: string[] = [];
      for (const pen of PENS) {
        for (const width of WIDTHS) {
          const style = at(face, pen, width);
          const i = stemOf("i", style);
          for (const name of ["n", "m"]) {
            const mine = stemOf(name, style);
            const dx = leftOf(i.stem) - leftOf(mine.stem);
            if (mine.head.length === 0) differ.push(`${name} at ${pen}/${width}: no head`);
            else if (said([mine.stem, ...mine.head], dx) !== said([i.stem, ...i.head], 0)) {
              differ.push(`${name} at ${pen}/${width}: not the i's head`);
            }
          }
        }
      }
      expect(differ).toEqual([]);
    });
  }

  it("leaves a face whose arches reach the x-height as it was", () => {
    for (const name of ["n", "m", "h", "r"]) {
      for (const pen of [30, 87, 260]) {
        const plain = drawLetter(name, at(SERIF, pen));
        const kept = drawLetter(name, at(withField(SERIF, "slab.headKeep", true), pen));
        expect(kept?.contours, `${name} at ${pen}`).toEqual(plain?.contours);
      }
    }
  });

  it("leaves a face without serifs as it was", () => {
    const sans = withField(withField(SERIF, "slab.on", false), "shoulder.crest", 0.97);
    for (const name of ["n", "m"]) {
      const plain = drawLetter(name, at(sans, 87));
      const kept = drawLetter(name, at(withField(sans, "slab.headKeep", true), 87));
      expect(kept?.contours, name).toEqual(plain?.contours);
    }
  });
});

/** The deepest a head's serif reaches down its stem, under the line it stands on. */
function headDepth(name: string, style: Style): number {
  const { head } = stemOf(name, style);
  const line = name === "h" || name === "l" ? style.metrics.ascender : style.metrics.xHeight;
  return line - Math.min(...head.flatMap((contour) => contour.nodes.map((node) => node.point.y)));
}

describe("a deeper head", () => {
  const HEADED = ["i", "n", "m", "h", "r", "p", "l"];

  it("runs further down the stem, by as much as it asks and no more", () => {
    const wrong: string[] = [];
    for (const [label, face] of [
      ["Serif", SERIF],
      ["Soft Serif", withField(SOFT_SERIF, "slab.headKeep", true)],
    ] as const) {
      for (const pen of PENS) {
        for (const name of HEADED) {
          const plain = headDepth(name, at(withField(face, "slab.headDepth", 0), pen));
          const half = headDepth(name, at(withField(face, "slab.headDepth", 0.5), pen));
          const whole = headDepth(name, at(withField(face, "slab.headDepth", 1), pen));
          // Deeper, more for more, and never past what it asked: the slope the
          // head is cut at is the same, so the part of it that grows is less
          // than the whole of it.
          if (!(half > plain + 1 && whole > half + 1 && half < plain * 1.5 && whole < plain * 2)) {
            wrong.push(
              `${label} ${name} at ${pen}: ${plain.toFixed(1)}, ${half.toFixed(1)}, ${whole.toFixed(1)}`,
            );
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it("is held to twice the head, however much more is asked", () => {
    for (const name of HEADED) {
      const most = drawLetter(name, at(withField(SERIF, "slab.headDepth", 1), 87));
      const past = drawLetter(name, at(withField(SERIF, "slab.headDepth", 3), 87));
      expect(past?.contours, name).toEqual(most?.contours);
    }
  });

  it("draws the head it always drew at nought, and with the heads not kept", () => {
    for (const name of [...HEADED, "n", "m"]) {
      for (const face of [SERIF, SHORT]) {
        const plain = drawLetter(name, at(face, 87));
        const nought = drawLetter(name, at(withField(face, "slab.headDepth", 0), 87));
        const unkept = drawLetter(name, at(withField(face, "slab.headKeep", false), 87));
        expect(nought?.contours, name).toEqual(plain?.contours);
        expect(unkept?.contours, name).toEqual(plain?.contours);
      }
    }
  });

  it("draws nothing else differently", () => {
    for (const name of ["E", "H", "o", "v", "s", "a", "one"]) {
      const plain = drawLetter(name, at(SERIF, 87));
      const deeper = drawLetter(name, at(withField(SERIF, "slab.headDepth", 1), 87));
      expect(deeper?.contours, name).toEqual(plain?.contours);
    }
  });
});

describe("kept and deeper heads at every master", () => {
  const FACE = withField(KEPT, "slab.headDepth", 0.5);
  const LETTERS = ["n", "m", "h", "i", "r", "p", "l", "j", "u", "k", "b", "d", "q"];

  it("keep their points at every pen and width, and never cross themselves", () => {
    const moved: string[] = [];
    const folds: string[] = [];
    for (const name of LETTERS) {
      const seen = new Set<string>();
      for (const pen of PENS) {
        for (const width of WIDTHS) {
          const drawn = drawLetter(name, at(FACE, pen, width), FACE.forms?.[name]);
          if (!drawn) continue;
          seen.add(signatureText(drawn.contours));
          if (drawn.contours.some((contour) => contoursIntersect([contour]))) {
            folds.push(`${name} at ${pen}/${width}`);
          }
        }
      }
      if (seen.size !== 1) moved.push(`${name}: ${seen.size} drawings`);
    }
    expect(moved).toEqual([]);
    expect(folds).toEqual([]);
  });

  it("keep them through a wave book recorded at the face's weight and read at 30 and 260", () => {
    const moved: string[] = [];
    const thin = at(FACE, 30);
    const black = at(FACE, 260);
    for (const one of [FACE, thin, black]) {
      for (const name of LETTERS) drawLetter(name, one, FACE.forms?.[name]);
    }
    const pages: WaveBook = {
      lengths: new Map(),
      bowls: new Map(),
      balls: new Map(),
      corners: new Map(),
      recording: true,
    };
    const was = openWaveBook(pages);
    try {
      for (const name of LETTERS) {
        pages.lengths.clear();
        pages.bowls.clear();
        pages.balls.clear();
        pages.corners.clear();
        pages.recording = true;
        const seen = new Set<string>();
        for (const one of [FACE, thin, black]) {
          waveBookAt(name);
          const drawn = drawLetter(name, one, FACE.forms?.[name]);
          if (drawn) seen.add(signatureText(drawn.contours));
          pages.recording = false;
        }
        if (seen.size !== 1) moved.push(`${name}: ${seen.size} drawings`);
      }
    } finally {
      openWaveBook(was);
    }
    expect(moved).toEqual([]);
  });

  it("fold nothing across the controls' weights, on the Sans with serifs and the Serif", {
    timeout: 300_000,
  }, () => {
    const lower = "abcdefghijklmnopqrstuvwxyz".split("");
    expect(foldSweep("slab.headDepth", [0.5, 1], lower)).toEqual([]);
  });
});
