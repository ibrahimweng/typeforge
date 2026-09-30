/**
 * The typographic punctuation: curly quotes, low quotes, single guillemets,
 * dashes, the ellipsis, the bullet, the minus, the euro, the trade mark and
 * the daggers.
 *
 * Every Draw base drew four hundred and fifty-two glyphs and none of these, so
 * a line of ordinary prose -- "don’t", a dash, an ellipsis -- set with holes in
 * it. What is checked here is that every base now draws them, as the same
 * font: on the same points at every weight, so a weight axis can run through
 * them; never through themselves, so they fill; built out of the marks they
 * belong with, so they sit where those marks sit; and under the names and
 * codepoints every other font uses.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { glyphNameFor } from "@/assemble/slots";
import { ready } from "@/font/boolean";
import { contoursBounds, crossesItself } from "@/font/geometry";
import { contoursIntersect } from "@/font/outline";
import { decidedBy, drawLetter, letterNames } from "./build";
import { formOf, startFrom } from "./document";
import { openWaveBook, waveBookAt, type WaveBook } from "./shapes";
import { BASES, type Style } from "./style";
import { codepointsFor } from "./typeface";

/** The new glyphs, by name, and the character each one is. */
const TYPOGRAPHIC: Record<string, string> = {
  quoteleft: "‘",
  quoteright: "’",
  quotesinglbase: "‚",
  quotedblleft: "“",
  quotedblright: "”",
  quotedblbase: "„",
  guilsinglleft: "‹",
  guilsinglright: "›",
  endash: "–",
  emdash: "—",
  ellipsis: "…",
  bullet: "•",
  minus: "−",
  Euro: "€",
  trademark: "™",
  dagger: "†",
  daggerdbl: "‡",
};
const NAMES = Object.keys(TYPOGRAPHIC);

/** A base's letter in the form a document started from it draws it in. */
const drawIn = (name: string, style: Style) =>
  drawLetter(name, style, formOf(startFrom(style), name) || undefined)!;
const at = (base: Style, weight: number): Style => ({ ...base, pen: { ...base.pen, weight } });
const box = (name: string, style: Style) => contoursBounds(drawIn(name, style).contours);

beforeAll(async () => {
  await ready();
});

describe("the typographic punctuation is in the font", () => {
  it("is drawn by every base, under the names and codepoints fonts use", () => {
    const names = new Set(letterNames());
    for (const [name, character] of Object.entries(TYPOGRAPHIC)) {
      expect(names.has(name), `${name} is not drawn`).toBe(true);
      expect(codepointsFor(name), name).toEqual([character.codePointAt(0)]);
      expect(glyphNameFor(character), name).toBe(name);
    }
    for (const style of BASES) {
      for (const name of NAMES) {
        const drawn = drawIn(name, style);
        expect(drawn?.contours.length ?? 0, `${name} is empty on ${style.name}`).toBeGreaterThan(0);
        expect(drawn.advanceWidth, `${name} on ${style.name}`).toBeGreaterThan(0);
      }
    }
  });

  it("takes its decisions from the mark it is made of", () => {
    for (const name of ["quoteleft", "quoteright", "quotesinglbase", "quotedblleft"]) {
      expect(decidedBy(name)).toBe("comma");
    }
    expect(decidedBy("endash")).toBe("hyphen");
    expect(decidedBy("emdash")).toBe("hyphen");
    expect(decidedBy("ellipsis")).toBe("period");
    expect(decidedBy("minus")).toBe("plus");
    expect(decidedBy("Euro")).toBe("C");
  });

  /*
   * A variable font moves every point of a glyph between its masters, so each
   * has to be drawn with the same points from the Thin to past the Black.
   *
   * Drawn with a book opened at the drawn weight, as a family is exported: how
   * many humps a wave has and whether an end carries a ball are the drawn
   * weight's answers at every master (see `WaveBook`). Without one, the Wavy's
   * own T counts its humps differently at the Black, and so does the T in its
   * trade mark.
   */
  it("keeps the same points at every weight, on every base", () => {
    const moved: string[] = [];
    const book: WaveBook = {
      lengths: new Map(),
      bowls: new Map(),
      balls: new Map(),
      corners: new Map(),
      recording: true,
    };
    const was = openWaveBook(book);
    try {
      for (const base of BASES) {
        book.lengths.clear();
        book.bowls.clear();
        book.balls.clear();
        book.corners.clear();
        for (const name of NAMES) {
          book.recording = true;
          waveBookAt(name);
          drawIn(name, base);
          book.recording = false;
          const counts = [0.35, 1, 2, 2.6].map((share) => {
            waveBookAt(name);
            return drawIn(name, at(base, base.pen.weight * share))
              .contours.map((contour) => contour.nodes.length)
              .join("+");
          });
          if (new Set(counts).size > 1) moved.push(`${base.name} ${name}: ${counts.join(" | ")}`);
        }
      }
    } finally {
      openWaveBook(was);
    }
    expect(moved).toEqual([]);
  }, 300_000);

  it("never crosses itself, at any weight, on any base", () => {
    const folded: string[] = [];
    for (const base of BASES) {
      for (const name of NAMES) {
        for (const share of [0.35, 1, 2, 2.6]) {
          const contours = drawIn(name, at(base, base.pen.weight * share)).contours;
          if (contours.some((contour) => crossesItself(contour) || contoursIntersect([contour]))) {
            folded.push(`${base.name} ${name} x${share}`);
          }
        }
      }
    }
    expect(folded).toEqual([]);
  }, 300_000);
});

describe("where the typographic punctuation sits", () => {
  it("sets the quotes as the comma raised and turned, the low ones as the comma", () => {
    for (const style of BASES) {
      const comma = box("comma", style);
      const low = box("quotesinglbase", style);
      expect(low.yMin, `${style.name} ‚`).toBeCloseTo(comma.yMin, 0);
      expect(low.yMax, `${style.name} ‚`).toBeCloseTo(comma.yMax, 0);
      const right = box("quoteright", style);
      const left = box("quoteleft", style);
      // As tall as the comma, or taken down to under half the cap height where
      // the comma is a long pill; and up at the cap line with the straight quote.
      const deep = Math.min(comma.yMax - comma.yMin, style.metrics.capHeight * 0.48);
      expect(right.yMax - right.yMin, `${style.name} ’`).toBeCloseTo(deep, -1);
      expect(right.yMax, `${style.name} ’`).toBeGreaterThan(style.metrics.capHeight - 2);
      // The opening one the same comma turned over, as high or a little higher.
      expect(left.yMax - left.yMin, `${style.name} ‘`).toBeCloseTo(deep, -1);
      expect(left.yMax, `${style.name} ‘`).toBeGreaterThanOrEqual(right.yMax - 1);
      expect(left.yMax, `${style.name} ‘`).toBeLessThan(right.yMax + style.metrics.overshoot + 2);
      // The double ones are two of the single ones.
      const double = box("quotedblright", style);
      expect(double.yMax).toBeCloseTo(right.yMax, 0);
      expect(double.xMax - double.xMin).toBeGreaterThan((right.xMax - right.xMin) * 1.5);
    }
  });

  it("puts the Sans's quotes where Geist's are and the Serif's where Lora's are", () => {
    const sans = BASES.find((one) => one.name === "Sans")!;
    const serif = BASES.find((one) => one.name === "Serif")!;
    // Geist Regular: ’ 441..710, ‘ 457..726.
    expect(box("quoteright", sans).yMax).toBeCloseTo(710, -1);
    expect(box("quoteleft", sans).yMax).toBeGreaterThan(710);
    expect(box("quoteleft", sans).yMax).toBeLessThan(727);
    // Lora Regular: ’ and ‘ 480..760.
    expect(box("quoteright", serif).yMax).toBeCloseTo(760, -1);
    expect(box("quoteleft", serif).yMax).toBeCloseTo(760, -1);
  });

  it("runs the dashes on the hyphen's line, longer, en shorter than em", () => {
    for (const style of BASES) {
      const hyphen = box("hyphen", style);
      const en = box("endash", style);
      const em = box("emdash", style);
      const middle = (one: typeof en) => (one.yMin + one.yMax) / 2;
      expect(Math.abs(middle(en) - middle(hyphen)), `${style.name} –`).toBeLessThan(3);
      expect(Math.abs(middle(em) - middle(hyphen)), `${style.name} —`).toBeLessThan(3);
      expect(en.xMax - en.xMin, `${style.name} –`).toBeGreaterThan(hyphen.xMax - hyphen.xMin);
      if (!style.metrics.monospaced) {
        expect(em.xMax - em.xMin, `${style.name} —`).toBeGreaterThan(en.xMax - en.xMin + 100);
      }
    }
    // Geist Regular's: 503 and 819 of ink.
    const sans = BASES.find((one) => one.name === "Sans")!;
    expect(box("endash", sans).xMax - box("endash", sans).xMin).toBeCloseTo(503, -1);
    expect(box("emdash", sans).xMax - box("emdash", sans).xMin).toBeCloseTo(819, -1);
  });

  it("lines the minus up with the plus, and centres the bullet on the x-height", () => {
    for (const style of BASES) {
      const plus = box("plus", style);
      const minus = box("minus", style);
      expect(Math.abs((minus.yMin + minus.yMax) / 2 - (plus.yMin + plus.yMax) / 2)).toBeLessThan(
        style.metrics.unitsPerEm * 0.02,
      );
      expect(minus.xMax - minus.xMin).toBeCloseTo(plus.xMax - plus.xMin, -1);
      const bullet = box("bullet", style);
      // The Serif's stands where Lora's does, three quarters of the way up the
      // x-height (374 on 500), rather than on its middle.
      const middle = style.metrics.xHeight * (style.name === "Serif" ? 0.748 : 0.5);
      expect(Math.abs((bullet.yMin + bullet.yMax) / 2 - middle), style.name).toBeLessThan(
        style.metrics.unitsPerEm * 0.02,
      );
      expect(bullet.xMax - bullet.xMin).toBeGreaterThan(
        box("period", style).xMax - box("period", style).xMin,
      );
    }
  });

  it("sets the ellipsis as three full stops on the line, a little closer than three set apart", () => {
    for (const style of BASES) {
      const period = drawIn("period", style);
      const dots = drawIn("ellipsis", style);
      expect(dots.contours.length).toBe(period.contours.length * 3);
      const one = contoursBounds(period.contours);
      const three = contoursBounds(dots.contours);
      expect(three.yMin).toBeCloseTo(one.yMin, 0);
      if (!style.metrics.monospaced) {
        expect(dots.advanceWidth, style.name).toBeLessThan(period.advanceWidth * 3.6);
      }
    }
  });

  it("leaves a monospaced face's column as wide as it was", () => {
    const typewriter = BASES.find((one) => one.metrics.monospaced)!;
    // The column is the widest letter the face had before these arrived.
    expect(drawIn("emdash", typewriter).advanceWidth).toBe(drawIn("m", typewriter).advanceWidth);
    for (const name of NAMES) {
      const ink = box(name, typewriter);
      expect(ink.xMax - ink.xMin, name).toBeLessThan(drawIn("m", typewriter).advanceWidth);
    }
  });
});
