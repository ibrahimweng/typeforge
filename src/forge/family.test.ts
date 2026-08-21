/**
 * A family, and what makes one.
 *
 * The easy half of this was drawing nine weights: the engine takes a pen width
 * and the pen width is a number. The hard half is that nine fonts are not a
 * family. What makes them one is the relationship between them -- how much the
 * counters give back, how much the letters widen, what stays exactly where it
 * was -- and none of that can be checked by looking at one weight.
 *
 * So it is checked against families somebody else drew. Six of them ship with
 * the machine this runs on, each carrying a Regular and a Bold by a designer
 * who knew what they were doing, and they agree with each other closely enough
 * to say what the rule is. The last test here re-measures them: if the shipped
 * fonts change, or the derivation drifts, the two stop matching and this says
 * which way.
 */

import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { contoursBounds } from "@/font/geometry";
import { importFont } from "@/font/parse";
import { resolveGlyphContours } from "@/font/transform";
import type { Typeface } from "@/font/types";
import { drawLetter } from "./build";
import { startFrom, weighted } from "./document";
import { WEIGHTS, memberOf, nameOfWeight, weightClassOf, weightedStyle, weightsOf } from "./family";
import { BASES, DISPLAY, SANS, SERIF, type Style } from "./style";

/** The left stem, the counter beside it and the whole ink width of an n. */
function anatomyOfN(style: Style): { stem: number; counter: number; ink: number } {
  const drawn = drawLetter("n", style)!;
  const cut = style.metrics.xHeight * 0.42;
  const crossings: number[] = [];
  for (const contour of drawn.contours) {
    const nodes = contour.nodes;
    for (let index = 0; index < nodes.length; index++) {
      const a = nodes[index].point;
      const b = nodes[(index + 1) % nodes.length].point;
      const handleOut = nodes[index].handleOut;
      const handleIn = nodes[(index + 1) % nodes.length].handleIn;
      const steps = handleOut || handleIn ? 32 : 1;
      let previous = a;
      for (let step = 1; step <= steps; step++) {
        const t = step / steps;
        const u = 1 - t;
        const c1 = handleOut ?? a;
        const c2 = handleIn ?? b;
        const point = {
          x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
          y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
        };
        if ((previous.y <= cut && point.y > cut) || (point.y <= cut && previous.y > cut)) {
          crossings.push(previous.x + ((cut - previous.y) / (point.y - previous.y)) * (point.x - previous.x));
        }
        previous = point;
      }
    }
  }
  crossings.sort((one, other) => one - other);
  const box = contoursBounds(drawn.contours);
  return {
    stem: crossings.length >= 2 ? crossings[1] - crossings[0] : 0,
    counter: crossings.length >= 3 ? crossings[2] - crossings[1] : 0,
    ink: box.xMax - box.xMin,
  };
}

const inkWidth = (style: Style, letter: string): number => {
  const box = contoursBounds(drawLetter(letter, style)!.contours);
  return box.xMax - box.xMin;
};

describe("which weight a face already is", () => {
  /*
   * Half the faces here are not a Regular, and calling them one is how a
   * family goes wrong before it is drawn: a display face asked for a Bold of
   * its own gets a stem half again as wide as the one already closing its
   * counters.
   */
  it("reads a weight off the stem rather than assuming four hundred", () => {
    expect(weightClassOf(SANS)).toBe(400);
    expect(weightClassOf(SERIF)).toBe(400);
    // Its stem is a third of its x-height, which is where a bold sits.
    expect(weightClassOf(DISPLAY)).toBe(700);
  });

  it("puts every base somewhere on the scale", () => {
    for (const base of BASES) {
      const asked = weightClassOf(base);
      expect(asked, base.name).toBeGreaterThanOrEqual(100);
      expect(asked, base.name).toBeLessThanOrEqual(900);
      expect(asked % 100, base.name).toBe(0);
    }
  });

  /*
   * The same rule read forwards and backwards. Ask a face what weight it is,
   * draw that weight from it, and nothing should have moved.
   */
  it("comes back to itself", () => {
    for (const base of BASES) {
      const asked = weightClassOf(base);
      const again = weightedStyle(base, asked, asked);
      expect(again.pen.weight, base.name).toBe(base.pen.weight);
    }
  });

  it("starts a document at the weight the base actually is", () => {
    expect(startFrom(SANS).family?.drawn).toBe(400);
    expect(startFrom(DISPLAY).family?.drawn).toBe(700);
  });
});

describe("what changes between the weights", () => {
  const bolder = weightedStyle(SANS, 400, 700);

  it("makes the stem proportional to the number", () => {
    for (const { weight } of WEIGHTS) {
      const style = weightedStyle(SANS, 400, weight);
      expect(style.pen.weight / SANS.pen.weight).toBeCloseTo(weight / 400, 5);
    }
  });

  it("gives back four fifths of the stem out of the counter", () => {
    const before = anatomyOfN(SANS);
    const after = anatomyOfN(bolder);
    const gained = after.stem - before.stem;
    expect(gained).toBeGreaterThan(0);
    expect((after.counter - before.counter) / gained).toBeCloseTo(-0.8, 1);
  });

  it("leaves the spacing where it was", () => {
    for (const { weight } of WEIGHTS) {
      const style = weightedStyle(SANS, 400, weight);
      expect(style.metrics.sidebearing).toBe(SANS.metrics.sidebearing);
    }
  });

  it("leaves the lines where they were", () => {
    for (const { weight } of WEIGHTS) {
      const { metrics } = weightedStyle(SERIF, 400, weight);
      expect(metrics.xHeight).toBe(SERIF.metrics.xHeight);
      expect(metrics.capHeight).toBe(SERIF.metrics.capHeight);
      expect(metrics.ascender).toBe(SERIF.metrics.ascender);
      expect(metrics.descender).toBe(SERIF.metrics.descender);
    }
  });

  /*
   * The one that was missed first time.
   *
   * A round letter is as tall as the x-height and, being round, as wide -- so
   * left alone it is the same width at every weight. A Black whose o is its
   * Thin's o standing beside an n half again as wide reads as two fonts in one
   * word, and it is exactly what came out until the bowls were told to follow.
   */
  it("widens the round letters with the flat ones", () => {
    for (const base of [SANS, SERIF]) {
      const light = weightedStyle(base, 400, 300);
      const heavy = weightedStyle(base, 400, 800);
      const round = inkWidth(heavy, "o") - inkWidth(light, "o");
      const flat = inkWidth(heavy, "n") - inkWidth(light, "n");
      expect(round, `${base.name}: the o did not widen`).toBeGreaterThan(0);
      expect(round / flat, `${base.name}: the o and the n came apart`).toBeGreaterThan(0.5);
      expect(round / flat, `${base.name}: the o outgrew the n`).toBeLessThan(1.6);
    }
  });

  it("draws every weight of every base, and none of them the same", () => {
    for (const base of BASES) {
      const seen = new Set<string>();
      for (const { weight } of WEIGHTS) {
        const style = weightedStyle(base, weightClassOf(base), weight);
        const drawn = drawLetter("n", style);
        expect(drawn, `${base.name} at ${weight}`).not.toBeNull();
        expect(drawn!.contours.length, `${base.name} at ${weight} is empty`).toBeGreaterThan(0);
        expect(style.pen.weight, `${base.name} at ${weight} has no pen`).toBeGreaterThan(0);
        seen.add(JSON.stringify(drawn!.contours));
      }
      expect(seen.size, `${base.name} draws the same n at every weight`).toBe(WEIGHTS.length);
    }
  });
});

describe("naming the members", () => {
  it("uses the names the world uses", () => {
    expect(nameOfWeight(400)).toBe("Regular");
    expect(nameOfWeight(700)).toBe("Bold");
    expect(nameOfWeight(900)).toBe("Black");
  });

  it("names the files the way a foundry does", () => {
    expect(memberOf("My Slab", 700)).toEqual({ styleName: "Bold", fileName: "MySlab-Bold" });
    expect(memberOf("", 400).fileName).toBe("Untitled-Regular");
  });

  it("always has the weight being drawn in it", () => {
    expect(weightsOf({ drawn: 700, also: [] })).toEqual([700]);
    expect(weightsOf({ drawn: 700, also: [300, 700, 900] })).toEqual([300, 700, 900]);
  });

  it("draws the document at another weight and leaves the exceptions alone", () => {
    const forge = startFrom(SANS);
    forge.exceptions = { p: { slab: { projection: 1.4 } } };
    const heavy = weighted(forge, 900);
    expect(heavy.exceptions).toEqual(forge.exceptions);
    expect(heavy.style.pen.weight).toBeGreaterThan(forge.style.pen.weight);
  });
});

/**
 * The families this machine already has, measured.
 *
 * Not a fixture and not a copy: the actual files, read with the same importer
 * the application uses. What the derivation claims about a family is a claim
 * about families in general, and this is where it meets some.
 */
const REAL: Array<[string, string, string]> = [
  ["DejaVu Sans", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"],
  ["DejaVu Serif", "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"],
  ["Liberation Sans", "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"],
  ["Liberation Serif", "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf", "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf"],
  ["FreeSans", "/usr/share/fonts/truetype/freefont/FreeSans.ttf", "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf"],
  ["FreeSerif", "/usr/share/fonts/truetype/freefont/FreeSerif.ttf", "/usr/share/fonts/truetype/freefont/FreeSerifBold.ttf"],
];

const present = REAL.filter(([, regular, bold]) => existsSync(regular) && existsSync(bold));

/*
 * Twelve fonts, read once between them.
 *
 * Reading a font is the slow part of this file by an order of magnitude, and
 * three tests asking the same six families the same questions read each of them
 * three times. Left that way the block ran past the suite's own patience under
 * load and failed as a timeout, which reads as "the derivation is wrong" and is
 * not.
 */
const read = new Map<string, Promise<Anatomy>>();

interface Anatomy {
  stem: number;
  counter: number;
  ink: number;
  x: number;
}

describe.skipIf(present.length < 3)("against families somebody else drew", { timeout: 120_000 }, () => {
  /** The stem, the counter and the n's ink, off a real font. */
  function anatomyOfFile(path: string): Promise<Anatomy> {
    const known = read.get(path);
    if (known) return known;
    const measuring = measureFile(path);
    read.set(path, measuring);
    return measuring;
  }

  async function measureFile(path: string): Promise<Anatomy> {
    const { typeface } = await importFont(new Uint8Array(readFileSync(path)), path);
    const em = typeface.unitsPerEm;
    const scale = 1000 / em;
    const x = (typeface.metrics.xHeight || em * 0.52) * scale;
    const cut = (x / scale) * 0.42;
    const crossings = crossingsAt(typeface, "n", cut);
    const glyph = typeface.glyphs[typeface.glyphIndex.get("n")!];
    const box = contoursBounds(resolveGlyphContours(glyph, typeface));
    return {
      stem: (crossings[1] - crossings[0]) * scale,
      counter: (crossings[2] - crossings[1]) * scale,
      ink: (box.xMax - box.xMin) * scale,
      x,
    };
  }

  function crossingsAt(typeface: Typeface, name: string, y: number): number[] {
    const glyph = typeface.glyphs[typeface.glyphIndex.get(name)!];
    const found: number[] = [];
    for (const contour of resolveGlyphContours(glyph, typeface)) {
      const nodes = contour.nodes;
      for (let index = 0; index < nodes.length; index++) {
        const a = nodes[index];
        const b = nodes[(index + 1) % nodes.length];
        const steps = a.handleOut || b.handleIn ? 32 : 1;
        let previous = a.point;
        for (let step = 1; step <= steps; step++) {
          const t = step / steps;
          const u = 1 - t;
          const c1 = a.handleOut ?? a.point;
          const c2 = b.handleIn ?? b.point;
          const point = {
            x: u * u * u * a.point.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.point.x,
            y: u * u * u * a.point.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.point.y,
          };
          if ((previous.y <= y && point.y > y) || (point.y <= y && previous.y > y)) {
            found.push(previous.x + ((y - previous.y) / (point.y - previous.y)) * (point.x - previous.x));
          }
          previous = point;
        }
      }
    }
    return found.sort((one, other) => one - other);
  }

  it("takes back the counter at the rate they do", async () => {
    const rates: number[] = [];
    for (const [, regular, bold] of present) {
      const light = await anatomyOfFile(regular);
      const heavy = await anatomyOfFile(bold);
      rates.push((heavy.counter - light.counter) / (heavy.stem - light.stem));
    }
    const middle = rates.sort((one, other) => one - other)[Math.floor(rates.length / 2)];
    // Every one of them is between two thirds and one; ours is four fifths.
    expect(middle).toBeLessThan(-0.6);
    expect(middle).toBeGreaterThan(-1.0);

    const before = anatomyOfN(SANS);
    const after = anatomyOfN(weightedStyle(SANS, 400, 700));
    const ours = (after.counter - before.counter) / (after.stem - before.stem);
    expect(Math.abs(ours - middle), `ours ${ours.toFixed(2)}, theirs ${middle.toFixed(2)}`).toBeLessThan(0.3);
  });

  it("widens the letter at the rate they do", async () => {
    const rates: number[] = [];
    for (const [, regular, bold] of present) {
      const light = await anatomyOfFile(regular);
      const heavy = await anatomyOfFile(bold);
      rates.push((heavy.ink - light.ink) / (heavy.stem - light.stem));
    }
    const middle = rates.sort((one, other) => one - other)[Math.floor(rates.length / 2)];
    const before = anatomyOfN(SANS);
    const after = anatomyOfN(weightedStyle(SANS, 400, 700));
    const ours = (after.ink - before.ink) / (after.stem - before.stem);
    expect(Math.abs(ours - middle), `ours ${ours.toFixed(2)}, theirs ${middle.toFixed(2)}`).toBeLessThan(0.35);
  });

  /*
   * And the scale itself: their Bold is about seven hundred over four hundred
   * of their Regular, which is the whole of what the numbers mean and the
   * reason the stem here is simply proportional to them.
   */
  it("puts a bold where the number says", async () => {
    for (const [name, regular, bold] of present) {
      const light = await anatomyOfFile(regular);
      const heavy = await anatomyOfFile(bold);
      const ratio = heavy.stem / light.stem;
      expect(ratio, `${name} is ${ratio.toFixed(2)} rather than about 1.75`).toBeGreaterThan(1.4);
      expect(ratio, `${name} is ${ratio.toFixed(2)} rather than about 1.75`).toBeLessThan(2.1);
    }
  });
});
