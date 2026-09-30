/**
 * The joined faces and the two hand-drawn ones, held to what a foundry would
 * ship: joins that run into the next letter without crossing it, a hand-over at
 * the waist that survives the end of a word, a Light and a Black that still
 * read, and ink with no slits, splinters or fused dots in it.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "@/font/boolean";
import { contoursBounds, inkRunsAt } from "@/font/geometry";
import type { Contour } from "@/font/types";
import { drawLetter } from "./build";
import { drawnEnds, proof, startFrom, type Forge } from "./document";
import { boundaryRules } from "./joins";
import { readyToShape } from "./layers";
import { joinWeight, writtenLead } from "./letters";
import { frame } from "./letters/common";
import { seamHeading, seamsOf } from "./script";
import { BASES, scriptUnit, type Style } from "./style";
import { toTypeface } from "./typeface";

const base = (name: string): Style => BASES.find((one) => one.name === name)!;
const at = (style: Style, weight: number): Style => ({
  ...style,
  pen: { ...style.pen, weight },
});
const heavier = (forge: Forge, weight: number): Forge => ({
  ...forge,
  style: at(forge.style, weight),
});
const WRITTEN = ["Handwriting", "Formal Script", "Casual Script", "Monoline Script"];

beforeAll(async () => {
  await ready();
  await readyToShape();
});

describe("a written lead-in", () => {
  /*
   * The written `n` climbs from the seam, not from the writing line. Struck
   * from the line, everything of it under the seam stood inside the letter
   * before, where it crossed that letter's last stem and its lead-out: `in`
   * and `an` each had an X at the join.
   */
  it("reaches back past its origin only above the seam", () => {
    for (const name of WRITTEN) {
      const style = base(name);
      const f = frame(style);
      const drawn = drawLetter("n", style, "written")!;
      const seam = seamsOf(style.parts.script, f.x, f.half).low;
      // Ink left of the origin, and how low it goes.
      let lowest = Infinity;
      for (const contour of drawn.contours) {
        for (const node of contour.nodes) {
          if (node.point.x < -f.half) lowest = Math.min(lowest, node.point.y);
        }
      }
      expect([name, lowest > seam - f.half * 2.5]).toEqual([name, true]);
    }
  });

  it("is level where it is taken high, and climbs where it is taken low", () => {
    const script = base("Monoline Script").parts.script;
    expect(seamHeading(script, true)).toEqual({ x: 1, y: 0 });
    expect(seamHeading(script, false).y).toBeGreaterThan(0.5);
    expect(writtenLead("n", base("Monoline Script")).high).toBe(false);
  });
});

describe("the hand-over at the waist", () => {
  /*
   * A word ending `on` needs its `n` to arrive high and to have no lead-out.
   * The word-end rule used to run first and win, so the pair dropped the
   * hand-over and the `o` left low -- a bar struck through the join.
   */
  it("composes with the end of a word", () => {
    const rules = boundaryRules(
      [
        ["n", "end"],
        ["o", "begin"],
      ],
      ["n", "o", "space"],
      [
        ["n.init", "end"],
        ["o.medi", "begin"],
      ],
    );
    const ending = rules.find((rule) => rule.after !== undefined && rule.before === undefined)!;
    expect(ending.input[0]).toContain("n.init");
    expect(ending.swaps[0].swap).toContainEqual({ plain: "n.init", alternate: "n.init.end" });
    const beginning = rules.find((rule) => rule.before !== undefined && rule.after === undefined)!;
    expect(beginning.swaps[0].swap).toContainEqual({
      plain: "o.medi",
      alternate: "o.medi.begin",
    });
  });

  it("is in the font, after the pair rule", async () => {
    const typeface = await toTypeface(startFrom(base("Monoline Script")), {
      familyName: "M",
      styleName: "R",
      merge: false,
    });
    const names = new Set(typeface.glyphs.map((glyph) => glyph.name));
    expect(names.has("n.init.end")).toBe(true);
    expect(names.has("o.medi.begin")).toBe(true);
    // The pair rule first, so the word-end rules see what it made.
    expect(typeface.alternates[0].input).toHaveLength(2);
  }, 120_000);
});

describe("a joined face away from its own weight", () => {
  /*
   * Its joins measured in a pen held near its own: at a Light the Roundhand's
   * letters closed up to a third of their spacing and each lead-in ran up
   * beside its stem as a loop, and `minimum` read as a row of `p`s.
   */
  it("keeps its spacing at a Light and its joins lighter than its stems at a Black", () => {
    const roundhand = base("Roundhand");
    const own = roundhand.pen.weight;
    expect(scriptUnit(at(roundhand, 30))).toBeGreaterThan(own * 0.75);
    expect(scriptUnit(at(roundhand, 260))).toBeLessThan(own * 1.4);
    expect(joinWeight(roundhand)).toBe(1);
    expect(joinWeight(at(roundhand, 200))).toBeLessThan(0.7);
  });

  it("climbs into its joins on the Roundhand too", () => {
    expect(base("Roundhand").parts.script.tilt).toBeGreaterThan(30);
  });
});

describe("the letters that were broken", () => {
  it("writes the Formal Script's a as the others do", () => {
    expect(base("Formal Script").forms?.a).toBe("written");
  });

  it("hands the written r on from its arm", () => {
    for (const name of [...WRITTEN, "Roundhand"]) {
      expect([name, base(name).forms?.r]).toEqual([name, "written"]);
    }
  });

  /*
   * A Black brush opens its diagonals rather than filling them: the Brush's
   * `v` was a solid wedge at 260, with nothing between its arms half way
   * up.
   */
  it("keeps a Black brush's vees open", () => {
    const brush = at(base("Brush"), 260);
    for (const letter of ["v", "V", "w", "W"]) {
      const drawn = drawLetter(letter, brush)!;
      const top = contoursBounds(drawn.contours).yMax;
      const runs = inkRunsAt(drawn.contours, top * 0.5, "y");
      expect([letter, runs.length >= 2]).toEqual([letter, true]);
    }
  });
});

describe("the ink the tool leaves", () => {
  const holes = (contours: Contour[]) => contours.length;

  /*
   * The Casual Script's joined letters came out of the roughening with white
   * knife-cuts through their strokes, where a lead-in ran into a bowl nearly
   * side by side. A `d` is its outline and its counter, and nothing else.
   */
  it("leaves no slits in a roughened stroke", () => {
    const forge = startFrom(base("Casual Script"));
    expect(holes(proof("d", forge)!.contours)).toBe(2);
  });

  /*
   * The rough is the whole face's, so it is on the drawings a shaper swaps in
   * as well -- or a word mixes rough letters with smooth ones.
   */
  it("roughens the second drawings as it does the first", async () => {
    const forge = startFrom(base("Casual Script"));
    const plain = drawnEnds("m", "end", forge)!;
    const rough = drawnEnds("m", "end", forge, true)!;
    const count = (contours: Contour[]) =>
      contours.reduce((sum, contour) => sum + contour.nodes.length, 0);
    expect(count(rough.contours)).toBeGreaterThan(count(plain.contours) * 1.3);
  });

  /*
   * A pool of ink is where a stroke stopped or two met, and a dot is neither:
   * pooled, the Marker's tittle bridged to its stem at a Black and stood on
   * it as a keyhole.
   */
  it("keeps a Marker's dots off their stems at a Black", () => {
    const forge = heavier(startFrom(base("Marker")), 260);
    for (const letter of ["i", "j", "exclam"]) {
      const drawn = proof(letter, forge)!;
      expect([letter, drawn.contours.length]).toEqual([letter, 2]);
    }
  });
});
