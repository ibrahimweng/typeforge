/**
 * The text bases -- Geometric, Grotesque, Didone, Slab, Typewriter -- at the
 * ends of their weight axis, held to what a heavy cut of Futura, Rockwell or
 * Bodoni does where the construction had come apart: the S whose spine was a
 * flat bar, the slab F whose middle beak hung onto its foot, the a whose
 * bowl stepped under its foot serif, the ball-less Didone, the thin-winged k,
 * the notched r, the stadium o, the fused plus-minus, and the diagonals
 * spaced like stems.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { ready, unite } from "@/font/boolean";
import { contoursBounds, inkRunsAt } from "@/font/geometry";
import type { Contour } from "@/font/types";
import { drawLetter } from "./build";
import { formOf, startFrom } from "./document";
import { BASES, type Style } from "./style";

beforeAll(async () => {
  await ready();
});

const face = (name: string): Style => BASES.find((one) => one.name === name)!;
const at = (base: Style, weight: number): Style => ({ ...base, pen: { ...base.pen, weight } });
const draw = (name: string, style: Style) =>
  drawLetter(name, style, formOf(startFrom(face(style.name)), name))!;
/** The letter's ink as one shape, so overlapping strokes read as one run. */
const ink = (contours: Contour[]) => unite(contours, "winding");
/** Where a line crosses ink, as runs, on the letter's united ink. */
const runs = (name: string, style: Style, value: number, along: "x" | "y") =>
  inkRunsAt(ink(draw(name, style).contours), value, along, 48);
const counts = (name: string, style: Style) =>
  [30, 140, 260].map((weight) =>
    draw(name, at(style, weight))
      .contours.map((contour) => contour.nodes.length)
      .join("+"),
  );

describe("the S at an Ultra", () => {
  it("stays about as wide as it is tall, its spine falling across it", () => {
    for (const name of ["Geometric", "Grotesque", "Slab"]) {
      const { contours } = draw("S", at(face(name), 260));
      const box = contoursBounds(contours);
      // Every Black's S is taller than it is wide; this one ran a tenth wider.
      expect((box.xMax - box.xMin) / (box.yMax - box.yMin), name).toBeLessThan(1);
      // Three strokes down the middle: the crown, the spine and the foot.
      const through = inkRunsAt(ink(contours), (box.xMin + box.xMax) / 2, "x", 48);
      expect(through.length, name).toBe(3);
    }
  });

  it("keeps the same pieces at every weight, S, s, dollar and section", () => {
    for (const name of ["Geometric", "Grotesque", "Slab", "Typewriter", "Sans"]) {
      for (const letter of ["S", "s", "dollar", "section"]) {
        expect(new Set(counts(letter, face(name))).size, `${name} ${letter}`).toBe(1);
      }
    }
  });

  it("stands the section mark's two halves on one ring rather than crossing them", () => {
    const { contours } = draw("section", face("Geometric"));
    // An s and its own copy turned half round about the ring's centre: two
    // runs of the same height, reaching the same distance either side of it.
    expect(contours.length).toBe(2);
    const [upper, lower] = contours.map((contour) => contoursBounds([contour]));
    expect(Math.abs(upper.yMax - upper.yMin - (lower.yMax - lower.yMin))).toBeLessThan(2);
    expect(Math.abs(upper.xMax - upper.xMin - (lower.xMax - lower.xMin))).toBeLessThan(2);
    expect(upper.yMin).toBeLessThan(lower.yMax);
  });
});

describe("the Slab's serifs at a heavy weight", () => {
  it("keeps the F's middle beak well clear of its foot", () => {
    const style = at(face("Slab"), 260);
    const { contours } = draw("F", style);
    const box = contoursBounds(contours);
    const cap = style.metrics.capHeight;
    // Under the middle arm's beak, wherever there is one: the paper between
    // it and the foot's slab more than a sixth of the cap height. It hung to
    // within an eighth.
    let least = Infinity;
    for (let x = box.xMin; x < box.xMax; x += 4) {
      const found = inkRunsAt(ink(contours), x, "x", 48);
      if (found.length === 3) least = Math.min(least, found[1][0] - found[0][1]);
    }
    expect(least).toBeLessThan(Infinity);
    expect(least).toBeGreaterThan(cap * 0.16);
  });

  it("stands the G's spur bare on the line, with no foot stepping past it", () => {
    const style = at(face("Slab"), 260);
    const { contours } = draw("G", style);
    const box = contoursBounds(contours);
    // The right of the letter is the upright itself, from the bar to the line.
    const low = inkRunsAt(ink(contours), 20, "y", 48);
    const high = inkRunsAt(ink(contours), style.metrics.capHeight * 0.35, "y", 48);
    expect(Math.abs(low[low.length - 1][1] - high[high.length - 1][1])).toBeLessThan(2);
    expect(box.xMax - high[high.length - 1][1]).toBeLessThan(2);
  });

  it("gives the k's arm and leg a slab as deep as a slab", () => {
    const style = at(face("Slab"), 112);
    const { contours } = draw("k", style);
    const pieces = contours.map((contour) => contoursBounds([contour]));
    // The foot's slab, and the serif on the arm at the x-height.
    const foot = pieces.find((one) => one.yMin === 0 && one.xMin < 60)!;
    const arm = pieces.find(
      (one) =>
        Math.abs(one.yMax - style.metrics.xHeight) < 1 &&
        one.xMax - one.xMin > 60 &&
        one.yMax - one.yMin < 150,
    )!;
    expect(arm.yMax - arm.yMin).toBeGreaterThan((foot.yMax - foot.yMin) * 0.6);
  });

  it("opens the K between its stem and its arm", () => {
    const style = at(face("Slab"), 260);
    // Just under the cap line, paper between the stem's head and the arm's.
    const found = runs("K", style, style.metrics.capHeight * 0.95, "y");
    expect(found.length).toBe(2);
    expect(found[1][0] - found[0][1]).toBeGreaterThan(120);
  });
});

describe("the heavy stacked letters", () => {
  it("keeps both of a Slab ze's counters open, the small one too", () => {
    const style = at(face("Slab"), 260);
    const { contours } = draw("з", style);
    const box = contoursBounds(contours);
    const found = inkRunsAt(ink(contours), (box.xMin + box.xMax) / 2 + 20, "x", 48);
    expect(found.length).toBe(3);
    for (let index = 1; index < found.length; index++) {
      expect(found[index][0] - found[index - 1][1]).toBeGreaterThan(60);
    }
    for (const name of ["З", "з", "ґ", "Ґ"]) {
      expect(new Set(counts(name, face("Slab"))).size, name).toBe(1);
    }
  });

  it("stands the two-storey a's bowl on the line, not a step under its foot", () => {
    for (const name of ["Slab", "Didone", "Typewriter"]) {
      for (const weight of [87, 200, 260]) {
        const box = contoursBounds(draw("a", at(face(name), weight)).contours);
        expect(box.yMin, `${name} ${weight}`).toBeGreaterThan(-1);
      }
    }
  });

  it("sets the plus-minus's plus clear of its rule", () => {
    const style = at(face("Slab"), 260);
    const box = contoursBounds(draw("plusminus", style).contours);
    const found = runs("plusminus", style, (box.xMin + box.xMax) / 2, "x");
    expect(found.length).toBe(2);
    expect(found[1][0] - found[0][1]).toBeGreaterThan(40);
  });

  it("carries a heavy r's top level into its arm, with no notch on the shoulder", () => {
    const style = at(face("Grotesque"), 260);
    // A unit under the top: the notch was a unit and a half deep.
    expect(runs("r", style, style.metrics.xHeight - 1, "y").length).toBe(1);
  });
});

describe("the Didone's balls", () => {
  it("finishes its curved ends in balls and leaves its straight ends cut", () => {
    const style = face("Didone");
    // A disc on each end of the c; none on the one's flag.
    const discs = (name: string) =>
      draw(name, style).contours.filter((contour) => {
        const box = contoursBounds([contour]);
        const across = box.xMax - box.xMin;
        return across > 20 && Math.abs(across - (box.yMax - box.yMin)) < 2;
      }).length;
    expect(discs("c")).toBe(2);
    expect(discs("one")).toBe(0);
  });

  it("keeps the same pieces at every weight", () => {
    for (const name of ["a", "c", "f", "r", "j", "t", "one", "Q", "S", "s", "two", "three"]) {
      expect(new Set(counts(name, face("Didone"))).size, name).toBe(1);
    }
  });
});

describe("the Geometric at an Ultra", () => {
  it("keeps its o nearer a circle than a stadium", () => {
    const box = contoursBounds(draw("o", at(face("Geometric"), 260)).contours);
    expect((box.xMax - box.xMin) / (box.yMax - box.yMin)).toBeLessThan(1.28);
  });

  it("draws its S and s round at a hairline, not flat bars on a straight spine", () => {
    // Crossing the top of the S a quarter in from its left, the ink is the
    // crown's curve, not a level bar lying on the cap line.
    const style = at(face("Geometric"), 30);
    const { contours } = draw("S", style);
    const box = contoursBounds(contours);
    const top = (x: number) => {
      const found = inkRunsAt(ink(contours), x, "x", 48);
      return found[found.length - 1][1];
    };
    const quarter = top(box.xMin + (box.xMax - box.xMin) * 0.25);
    const middle = top((box.xMin + box.xMax) / 2);
    expect(middle - quarter).toBeGreaterThan(10);
  });
});

describe("the diagonals' spacing", () => {
  it("sets the A, V and T closer than a stem on the Geometric and the Slab", () => {
    for (const name of ["Geometric", "Slab"]) {
      const style = face(name);
      const side = (letter: string) => {
        const drawn = draw(letter, style);
        const box = contoursBounds(drawn.contours);
        return drawn.advanceWidth - (box.xMax - box.xMin);
      };
      for (const letter of ["A", "V", "T"]) {
        // Both sides together, against two plain sidebearings: 116 of 116
        // before, where Geist gives its A and V about a quarter of that.
        expect(side(letter), `${name} ${letter}`).toBeLessThan(style.metrics.sidebearing * 2 * 0.6);
      }
    }
  });

  it("leaves the Typewriter one advance for every letter", () => {
    const style = face("Typewriter");
    const widths = new Set(["A", "H", "i", "m"].map((letter) => draw(letter, style).advanceWidth));
    expect(widths.size).toBe(1);
  });
});

describe("the Geometric's S", () => {
  it("stands narrow beside its round O, as Futura's does", () => {
    /*
     * The grotesque's S measured off a circle ran four fifths as wide as the
     * O, its spine lying nearly flat: a squat disc of an S among letters built
     * on circles. Futura's is about three fifths of its O.
     */
    const style = face("Geometric");
    const width = (name: string) => {
      const box = contoursBounds(draw(name, style).contours);
      return box.xMax - box.xMin;
    };
    expect(width("S") / width("O")).toBeLessThan(0.7);
    expect(width("s") / width("o")).toBeLessThan(0.8);
  });
});

describe("the Didone's hairlines", () => {
  const style = face("Didone");

  it("cuts the y's thick arm along its hairline, not square across it", () => {
    /*
     * Nothing a hairline wide buries a thick arm's square end: its corner
     * stood out right of the hairline and the two read as an x crossed on the
     * line. Nothing of the letter stands right of the hairline's own edge.
     */
    const edge = (y: number) => runs("y", style, y, "y").at(-1)![1];
    const [low, high] = [-120, -40];
    const slope = (edge(high) - edge(low)) / (high - low);
    for (const y of [0, 20, 40, 50, 60]) {
      expect(edge(y), `${y}`).toBeLessThan(edge(high) + slope * (y - high) + 3);
    }
  });

  it("closes a bracket into one crescent rather than a sheaf of hairlines", () => {
    for (const name of ["parenleft", "parenright"]) {
      const { contours } = draw(name, style);
      const box = contoursBounds(contours);
      const across = runs(name, style, (box.yMin + box.yMax) / 2, "y");
      expect(across.length, name).toBe(1);
    }
  });

  it("draws its at sign with the face's own contrast", () => {
    /*
     * The grotesque's, drawn without contrast, was a monoline ring among
     * hairlines and fat stems. Across its middle the ring's sides are heavy
     * and down its middle its crown is a hairline, as the O's are.
     */
    const { contours } = draw("at", style);
    const box = contoursBounds(contours);
    const side = runs("at", style, (box.yMin + box.yMax) / 2, "y")[0];
    const crown = runs("at", style, (box.xMin + box.xMax) / 2, "x").at(-1)!;
    expect((side[1] - side[0]) / (crown[1] - crown[0])).toBeGreaterThan(2.5);
  });
});

describe("the Typewriter's narrow letters", () => {
  it("run their serifs out to fill the column, as Courier's do", () => {
    /*
     * With a text face's serifs the i, the l and the I stood as bare sticks
     * in a column made for an m, and a word set in them read as gapped.
     */
    const style = face("Typewriter");
    for (const name of ["i", "l", "I", "dotlessi"]) {
      const drawn = draw(name, style);
      const box = contoursBounds(drawn.contours);
      expect((box.xMax - box.xMin) / drawn.advanceWidth, name).toBeGreaterThan(0.5);
    }
  });
});
