/**
 * The Sans at the ends of its weight axis, set against Geist Thin and Geist
 * Black.
 *
 * The Sans was fitted at Geist Regular, and its Light and Black came out of
 * the construction: the o wider than the n at a hairline, the dots specks,
 * the s shut at the Black, the f a stub, the marks swelling into blots. These
 * hold each of those to what Geist Thin and Geist Black measure, and past the
 * Black to a letter that still reads.
 */

import { describe, expect, it } from "vitest";
import {
  contourArea,
  contourContainsPoint,
  contoursBounds,
  crossesItself,
  inkRunsAt,
} from "@/font/geometry";
import type { Contour } from "@/font/types";
import { drawLetter } from "./build";
import { formOf, startFrom } from "./document";
import { SANS, SERIF, type Style } from "./style";

const forge = startFrom(SANS);
const at = (weight: number, base: Style = SANS): Style => ({
  ...base,
  pen: { ...base.pen, weight },
});
const draw = (name: string, weight: number) => drawLetter(name, at(weight), formOf(forge, name))!;
const box = (name: string, weight: number) => contoursBounds(draw(name, weight).contours);
/** The ink along a line, as runs; `along` "y" is a level line at `value`, "x" an upright one. */
const runs = (contours: Contour[], value: number, along: "x" | "y") =>
  inkRunsAt(contours, value, along, 48);

/**
 * Where a level line at `y` passes through ink, as it is filled: the letter's
 * strokes overlap, and a ruler that pairs up every edge it meets reads the
 * ink two strokes share as white.
 */
const filled = (
  contours: Contour[],
  value: number,
  along: "x" | "y" = "y",
): Array<[number, number]> => {
  const box = contoursBounds(contours);
  const signs = contours.map((contour) => Math.sign(contourArea(contour)));
  const [low, high] = along === "y" ? [box.xMin, box.xMax] : [box.yMin, box.yMax];
  const out: Array<[number, number]> = [];
  let from: number | null = null;
  for (let step = Math.floor(low) - 1; step <= Math.ceil(high) + 1; step += 0.5) {
    const point = along === "y" ? { x: step, y: value } : { x: value, y: step };
    let winding = 0;
    contours.forEach((contour, index) => {
      if (contourContainsPoint(contour, point)) winding += signs[index];
    });
    if (winding !== 0 && from === null) from = step;
    if (winding === 0 && from !== null) {
      out.push([from, step]);
      from = null;
    }
  }
  return out;
};

describe("the Sans at its Light, against Geist Thin", () => {
  it("keeps its straight letters as wide as its round ones", () => {
    // Geist Thin: n and h 556, m 846, u 556, x 536, o 550, a 545.
    const geist: Record<string, number> = {
      n: 556,
      h: 556,
      m: 846,
      u: 556,
      x: 536,
      o: 550,
      a: 545,
    };
    for (const [name, width] of Object.entries(geist)) {
      expect(Math.abs(draw(name, 30).advanceWidth - width), name).toBeLessThan(25);
    }
    expect(draw("n", 30).advanceWidth).toBeGreaterThan(draw("o", 30).advanceWidth - 15);
  });

  it("runs its f, t and hyphen no further than Geist Thin's", () => {
    expect(Math.abs(draw("f", 30).advanceWidth - 364)).toBeLessThan(20);
    expect(Math.abs(draw("t", 30).advanceWidth - 352)).toBeLessThan(20);
    const hyphen = box("hyphen", 30);
    expect(Math.abs(hyphen.xMax - hyphen.xMin - 296)).toBeLessThan(15);
  });

  it("gives its dots a body, and its question mark room over its dot", () => {
    // Geist Thin's full stop is 59 across; its tittle 34 by 70; its neck stops at 216.
    const period = box("period", 30);
    expect(Math.abs(period.xMax - period.xMin - 59)).toBeLessThan(8);
    const tittle = draw("i", 30)
      .contours.map((contour) => contoursBounds([contour]))
      .find((one) => one.yMin > 530)!;
    expect(tittle.yMax - tittle.yMin).toBeGreaterThan((tittle.xMax - tittle.xMin) * 1.6);
    const question = draw("question", 30).contours.map((contour) => contoursBounds([contour]));
    const neck = question.reduce((one, other) => (one.yMax > other.yMax ? one : other));
    expect(neck.yMin).toBeGreaterThan(180);
  });
});

describe("the Sans at its Black, against Geist Black", () => {
  it("keeps both of the s's apertures open, from the Bold on", () => {
    for (const weight of [142, 160, 172, 185]) {
      const { contours } = draw("s", weight);
      const ink = contoursBounds(contours);
      // Upright through the lower aperture and the upper counter: the foot,
      // the spine and the crown, apart.
      const through = filled(contours, ink.xMin + (ink.xMax - ink.xMin) * 0.4, "x");
      expect(through.length, `s at ${weight}`).toBeGreaterThanOrEqual(3);
      for (let index = 1; index < through.length; index++) {
        expect(through[index][0] - through[index - 1][1], `s at ${weight}`).toBeGreaterThan(12);
      }
      // And level across the lower aperture, just under the top of the foot's
      // cut: the foot, and well clear of it the lower bowl's right side. Shut,
      // the cut ran into the spine and the line crossed one run of ink.
      const across = filled(contours, 150);
      expect(across.length, `s at ${weight}`).toBe(2);
      expect(across[1][0] - across[0][1], `s at ${weight}`).toBeGreaterThan(80);
    }
  });

  it("reaches the f's hook and bar out past its stem as Geist Black's do", () => {
    const ink = box("f", 172);
    // Geist Black's f is 393 of ink, 41 to 434.
    expect(Math.abs(ink.xMax - ink.xMin - 393)).toBeLessThan(30);
    expect(draw("f", 260).advanceWidth).toBeGreaterThan(draw("f", 172).advanceWidth);
  });

  it("sets its round letters no narrower than its straight ones", () => {
    const n = draw("n", 172).advanceWidth;
    expect(draw("o", 172).advanceWidth).toBeGreaterThan(n);
    // Geist Black: o 636, d 648, O 781, A 765, V 766.
    const geist: Record<string, number> = { o: 636, d: 648, O: 781, A: 765, V: 766, k: 666 };
    for (const [name, width] of Object.entries(geist)) {
      expect(Math.abs(draw(name, 172).advanceWidth - width), name).toBeLessThan(25);
    }
  });

  it("turns the j's foot out as far as Geist Black's", () => {
    const { contours } = draw("j", 172);
    const stem = runs(contours, 300, "y")[0];
    expect(stem[0] - contoursBounds(contours).xMin).toBeGreaterThan(100);
  });

  it("carries the 4's bar past its stem", () => {
    for (const weight of [172, 260]) {
      const { contours } = draw("four", weight);
      const foot = runs(contours, 30, "y");
      const stemRight = foot[foot.length - 1][1];
      expect(contoursBounds(contours).xMax - stemRight, `4 at ${weight}`).toBeGreaterThan(60);
    }
  });

  it("keeps the colon's dots apart and the comma above the descender", () => {
    const colon = draw("colon", 172).contours.map((contour) => contoursBounds([contour]));
    expect(Math.max(...colon.map((one) => one.yMax))).toBeGreaterThan(500);
    for (const weight of [172, 260]) expect(box("comma", weight).yMin).toBeGreaterThan(-165);
  });
});

describe("the s from the Bold to past the Black", () => {
  it("opens both counters as tall as Geist Black's, not slots", () => {
    // Geist Black's s: crown 115 on a stem of 172, and two round-ended
    // counters each about a fifth of the x-height tall.
    for (const weight of [172, 185, 200]) {
      const { contours } = draw("s", weight);
      const ink = contoursBounds(contours);
      const through = filled(contours, ink.xMin + (ink.xMax - ink.xMin) * 0.4, "x");
      expect(through.length, `s at ${weight}`).toBe(3);
      expect(through[1][0] - through[0][1], `s lower at ${weight}`).toBeGreaterThan(100);
      expect(through[2][0] - through[1][1], `s upper at ${weight}`).toBeGreaterThan(85);
    }
    const { contours } = draw("s", 172);
    const ink = contoursBounds(contours);
    const through = filled(contours, ink.xMin + (ink.xMax - ink.xMin) * 0.5, "x");
    const crown = through[through.length - 1];
    expect(crown[1] - crown[0]).toBeLessThan(122);
  });
});

describe("the s's counters from the Black on", () => {
  it("ends each counter round, not as a slot cut square", () => {
    // Geist Black's counters are round-ended: four units in from the end of
    // each, a counter is well under half its height in the middle. With the
    // stem's pen round every turn they were slots, near full height there.
    for (const weight of [172, 200, 260]) {
      const { contours } = draw("s", weight);
      const box = contoursBounds(contours);
      const middle = (box.xMin + box.xMax) / 2;
      const down = filled(contours, middle, "x");
      expect(down.length, `s at ${weight}`).toBe(3);
      for (const [index, upper] of [
        [1, false],
        [2, true],
      ] as const) {
        const y = (down[index - 1][1] + down[index][0]) / 2;
        const across = filled(contours, y);
        const at = across.findIndex(
          (run, one) => one > 0 && across[one - 1][1] <= middle && run[0] >= middle,
        );
        const [start, end] = [across[at - 1][1], across[at][0]];
        const tall = (x: number) => {
          const runs = filled(contours, x, "x");
          const gap = runs.findIndex((run, one) => one > 0 && runs[one - 1][1] <= y && run[0] >= y);
          return runs[gap][0] - runs[gap - 1][1];
        };
        const ratio = tall(upper ? start + 4 : end - 4) / tall((start + end) / 2);
        expect(ratio, `s ${upper ? "upper" : "lower"} at ${weight}`).toBeLessThan(0.5);
      }
    }
  });
});

describe("the eight past the Black", () => {
  it("keeps its upper counter an oval, not a slot with square ends", () => {
    for (const weight of [200, 260]) {
      const { contours } = draw("eight", weight);
      const box = contoursBounds(contours);
      const middle = (box.xMin + box.xMax) / 2;
      const down = filled(contours, middle, "x");
      // The foot, the waist and the head: the upper counter under the head.
      const y = (down[down.length - 2][1] + down[down.length - 1][0]) / 2;
      const across = filled(contours, y);
      const at = across.findIndex(
        (run, one) => one > 0 && across[one - 1][1] <= middle && run[0] >= middle,
      );
      const [start, end] = [across[at - 1][1], across[at][0]];
      const tall = (x: number) => {
        const runs = filled(contours, x, "x");
        const gap = runs.findIndex((run, one) => one > 0 && runs[one - 1][1] <= y && run[0] >= y);
        return runs[gap][0] - runs[gap - 1][1];
      };
      expect(tall(start + 5) / tall((start + end) / 2), `eight at ${weight}`).toBeLessThan(0.75);
    }
  });
});

describe("the a at the Light", () => {
  it("springs its spur out of the crotch the bowl makes with the stem", () => {
    // Geist Thin: under the bowl's join, the bowl's foot and the spur's turn
    // with nothing between them -- no block of stem standing below the bowl.
    const { contours } = draw("a", 30);
    expect(filled(contours, 15).length).toBe(2);
    expect(filled(contours, 25).length).toBe(3);
  });
});

describe("the a from the Regular past the Black, as Geist draws it", () => {
  it("notches the bowl's foot where it comes up into the stem's round foot", () => {
    // Geist: the bowl's outside meets the stem's foot at 82 on the Regular
    // and 83 on the Black, in a V, and the bowl thins into the stem.
    for (const weight of [87, 130, 172, 200, 260]) {
      const { contours } = draw("a", weight);
      expect(filled(contours, 50).length, `a at ${weight}`).toBe(2);
    }
  });

  it("keeps the bowl's counter a round teardrop as tall as Geist Black's", () => {
    // Geist Black: the counter 120 tall where it meets the stem, and 146
    // across; drawn with the stem's pen the bowl crushed it to a slot.
    const { contours } = draw("a", 172);
    const across = filled(contours, 160);
    expect(across.length).toBe(2);
    expect(across[1][0] - across[0][1]).toBeGreaterThan(110);
    const higher = filled(contours, 200);
    expect(higher.length).toBe(2);
    expect(higher[1][0] - higher[0][1]).toBeGreaterThan(90);
  });

  it("stands as wide as Geist Black's and sets its spur close", () => {
    // Geist Black's a (a stem of 194): 582 of ink, 9 to spare on the right;
    // its UltraBlack's (a stem of 172) 564; the Regular's spur 19 off.
    expect(box("a", 172).xMax - box("a", 172).xMin).toBeCloseTo(564, -1.5);
    const black = draw("a", 194);
    const box194 = contoursBounds(black.contours);
    expect(box194.xMax - box194.xMin).toBeCloseTo(582, -1.5);
    expect(black.advanceWidth - box194.xMax).toBeLessThan(25);
    const regular = draw("a", 87);
    expect(regular.advanceWidth - contoursBounds(regular.contours).xMax).toBeCloseTo(19, -1);
  });
});

describe("the y and the e at the Black, as Geist draws them", () => {
  it("closes the y's vee high over the line and runs its tail flat into the foot", () => {
    // Geist Black: the arms' inside edges meet at 220, the left arm is cut
    // level at 38, and the foot runs flat under the line for 168 units.
    const { contours } = draw("y", 172);
    expect(filled(contours, 150).length).toBe(1);
    expect(filled(contours, 250).length).toBe(2);
    const foot = filled(contours, -145);
    expect(foot[0][1] - foot[0][0]).toBeGreaterThan(150);
  });

  it("drops the e's right side straight into the end of its bar", () => {
    // Geist's e is nearly upright on the right from its bar up into the
    // bowl: the bar's end neither stands out past the bowl nor is stepped
    // under it. 40 over its bar its Regular's comes in 8 units and its
    // UltraBlack's 14.
    for (const weight of [30, 87, 172, 260]) {
      const { contours } = draw("e", weight);
      const right = contoursBounds(contours).xMax;
      let top = 250;
      while (filled(contours, top).length < 2 && top < 450) top += 1;
      const above = filled(contours, top + 40);
      expect(right - above[above.length - 1][1], `e at ${weight}`).toBeLessThan(15);
    }
  });
});

describe("the marks, at the Black and past it", () => {
  it("draws the asterisk with six arms, raised, the same size at every weight", () => {
    for (const weight of [30, 87, 172, 260]) {
      const ink = box("asterisk", weight);
      expect(ink.yMin, `* at ${weight}`).toBeGreaterThan(300);
      expect(ink.xMax - ink.xMin, `* at ${weight}`).toBeLessThan(480);
    }
    // Six arms, none of them upright: a level line near its top crosses two.
    const { contours } = draw("asterisk", 87);
    expect(runs(contours, contoursBounds(contours).yMax - 10, "y")).toHaveLength(2);
  });

  it("keeps the percent no wider than a W and its ovals clear of the slash", () => {
    for (const weight of [172, 200, 260]) {
      expect(draw("percent", weight).advanceWidth).toBeLessThan(draw("W", weight).advanceWidth);
      // Three pieces of ink: two rings and the slash between them.
      const solid = draw("percent", weight).contours.filter((one) => contourArea(one) > 0);
      expect(solid.length, `% at ${weight}`).toBe(3);
    }
    // Geist UltraBlack's percent is 833 wide.
    expect(Math.abs(draw("percent", 172).advanceWidth - 833)).toBeLessThan(30);
  });

  it("keeps the a inside the at sign clear of its ring", () => {
    for (const weight of [172, 200, 260]) {
      // Level through the a: the ring's left side, then white, then the a.
      const through = runs(draw("at", weight).contours, 290, "y");
      expect(through[1][0] - through[0][1], `@ at ${weight}`).toBeGreaterThan(50);
    }
  });

  it("lets the number sign's bars stand out past its uprights", () => {
    for (const weight of [172, 260]) {
      const { contours } = draw("numbersign", weight);
      const ink = contoursBounds(contours);
      // A level line under the lower bar crosses both uprights apart.
      expect(runs(contours, ink.yMin + 20, "y"), `# at ${weight}`).toHaveLength(2);
      expect(ink.xMax - ink.xMin, `# at ${weight}`).toBeGreaterThan(560);
    }
  });
});

describe("past the Black", () => {
  it("keeps the w's three counters open", () => {
    const { contours } = draw("w", 260);
    const through = runs(contours, 400, "y");
    expect(through).toHaveLength(4);
    // The two upper counters, either side of the middle apex.
    expect(through[1][0] - through[0][1]).toBeGreaterThan(35);
    expect(through[3][0] - through[2][1]).toBeGreaterThan(35);
  });

  it("keeps the e's aperture open", () => {
    for (const weight of [200, 260]) {
      const { contours } = draw("e", weight);
      const ink = contoursBounds(contours);
      // Upright through the aperture: the foot, the bar and the crown, and
      // between the foot and the bar more than a crack.
      const through = runs(contours, ink.xMin + (ink.xMax - ink.xMin) * 0.8, "x");
      expect(through, `e at ${weight}`).toHaveLength(3);
      expect(through[1][0] - through[0][1], `e at ${weight}`).toBeGreaterThan(30);
    }
  });
});

describe("the u", () => {
  it("stands its right stem on the baseline, as an n turned round", () => {
    for (const weight of [30, 87, 172]) {
      const { contours } = draw("u", weight);
      const ink = contoursBounds(contours);
      const low = runs(contours, 4, "y");
      expect(low[low.length - 1][1], `u at ${weight}`).toBeGreaterThan(ink.xMax - 1);
    }
  });
});

describe("the word space", () => {
  it("is Geist's at every weight", () => {
    expect(Math.round(draw("space", 30).advanceWidth)).toBe(250);
    expect(Math.round(draw("space", 87).advanceWidth)).toBe(250);
    expect(Math.round(draw("space", 172).advanceWidth)).toBe(221);
  });
});

describe("a slanted face", () => {
  it("keeps the upright's spacing, as an oblique does", () => {
    for (const base of [SANS, SERIF]) {
      const upright = at(base.pen.weight, base);
      const slanted = { ...upright, metrics: { ...upright.metrics, slant: 12 } };
      const form = startFrom(base);
      for (const name of ["g", "y", "f", "E", "one", "j"]) {
        const plain = drawLetter(name, upright, formOf(form, name))!.advanceWidth;
        const leant = drawLetter(name, slanted, formOf(form, name))!.advanceWidth;
        expect(Math.abs(leant - plain), `${base.name} ${name}`).toBeLessThan(1);
      }
    }
  });
});

describe("the Sans on a slant", () => {
  it("keeps the upright's spacing, letter by letter", () => {
    // An oblique is spaced as its upright: the r beside the g, the f beside
    // the o, the E beside the S, the y beside the one and the figures.
    const slanted: Style = { ...SANS, metrics: { ...SANS.metrics, slant: 12 } };
    const names = [..."rgfoESy", "one", "two", "three", "four", "seven", "nine"];
    const moved = names.filter((name) => {
      const upright = drawLetter(name, SANS, formOf(forge, name))!;
      const leaned = drawLetter(name, slanted, formOf(forge, name))!;
      return Math.abs(upright.advanceWidth - leaned.advanceWidth) > 0.5;
    });
    expect(moved).toEqual([]);
  });
});

describe("the marks as Geist draws them", () => {
  it("sets the caret narrow and high, the colon's dot and the percent's rings where Geist's are", () => {
    // Geist Regular: the caret 346 wide from 383 to 673; the colon's upper
    // dot topped at 506; the percent's rings 308 wide, 352 tall, the lower
    // one ending 714 from the left of the upper.
    const caret = contoursBounds(draw("asciicircum", 87).contours);
    expect(caret.xMax - caret.xMin).toBeCloseTo(346, -1);
    expect(caret.yMin).toBeCloseTo(383, -1);
    expect(caret.yMax).toBeCloseTo(673, -1);
    expect(contoursBounds(draw("colon", 87).contours).yMax).toBeCloseTo(506, -1);
    const percent = contoursBounds(draw("percent", 87).contours);
    expect(percent.xMax - percent.xMin).toBeCloseTo(714, -1.3);
    expect(percent.yMax - percent.yMin).toBeCloseTo(726, -1.3);
  });
});

describe("the s's spine", () => {
  it("curves as Geist's does, steeper where it leaves the bowls than through its middle", () => {
    // Measured down the middle of the spine at 35, 45, 55 and 65 per cent
    // across the letter: straight, it fell as far through the middle tenth
    // as through the tenths beside it.
    for (const name of ["s", "S"]) {
      for (const weight of [30, 87, 130, 172]) {
        const { contours } = draw(name, weight);
        const box = contoursBounds(contours);
        const middle = (share: number) => {
          const runs = filled(contours, box.xMin + (box.xMax - box.xMin) * share, "x");
          return (runs[1][0] + runs[1][1]) / 2;
        };
        const [a, b, c] = [0.35, 0.45, 0.55].map(middle);
        expect(b - c, `${name} at ${weight}`).toBeLessThan(a - b - 1.5);
      }
    }
  });
});

describe("the eight's width", () => {
  it("is as wide as Geist's from the Regular to the Black", () => {
    // Geist's ink widths: 524 at the Regular, 572 at the SemiBold (a stem of
    // 128), 620 at the UltraBlack (172) and 644 at the Black (194). With the
    // pen's weight alone round its sides, the eight was 30 units narrow at
    // 130 and 49 at the Black.
    for (const [weight, width] of [
      [87, 524],
      [130, 572],
      [172, 620],
      [194, 644],
    ]) {
      const ink = box("eight", weight);
      expect(Math.abs(ink.xMax - ink.xMin - width), `eight at ${weight}`).toBeLessThan(15);
    }
  });
});

describe("the at sign", () => {
  it("is as wide as Geist's, and its tail runs as far round", () => {
    // Geist's ink: 826 across at the Thin, 816 at the Regular, 899 at the
    // UltraBlack (a stem of 172) and 920 at the Black (194), and 40 under the
    // line its tail reaches 578, 580, 646 and 662 in from the left. The ring
    // was 31 narrow at the Thin and 45 at the Black, the tail 119 short.
    for (const [weight, width, tail] of [
      [30, 826, 578],
      [87, 816, 580],
      [172, 899, 646],
    ]) {
      const { contours } = draw("at", weight);
      const ink = contoursBounds(contours);
      expect(Math.abs(ink.xMax - ink.xMin - width), `@ at ${weight}`).toBeLessThan(15);
      // Up to 710 at every weight, as Geist's is: the ring stopped 27 short
      // of it on the Thin, and at 172 hung 18 short of Geist's -124.
      expect(Math.abs(ink.yMax - 710), `@ top at ${weight}`).toBeLessThan(8);
      expect(ink.yMin, `@ foot at ${weight}`).toBeLessThan(-85);
      const under = filled(contours, -40, "y");
      const end = under[under.length - 1][1] - ink.xMin;
      expect(Math.abs(end - tail), `tail at ${weight}`).toBeLessThan(15);
    }
  });
});

describe("the Sans at its Light, against Geist Thin's widths", () => {
  it("does not widen the letters Geist Thin keeps narrow", () => {
    // Geist Thin's ink widths. The face widens its light letters as Geist
    // Thin's o and n are widened, and the r's arm, the A, the v, the w, the G
    // and the figures took that on top of their own: the r 48 units wide, the
    // A 22, the G 30, the 7 26.
    const thin: Record<string, number> = {
      r: 208,
      A: 564,
      v: 434,
      w: 729,
      W: 830,
      G: 570,
      two: 477,
      seven: 469,
      eight: 500,
      k: 436,
    };
    for (const [name, width] of Object.entries(thin)) {
      const ink = box(name, 30);
      expect(Math.abs(ink.xMax - ink.xMin - width), name).toBeLessThan(12);
    }
  });
});

describe("the grave and the acute", () => {
  it("are Geist's steep marks, on their own and over a letter", () => {
    // Geist's grave: 160 across from 598 up to 726 on the Regular, 234 from
    // 587 to 747 on the Black (a stem of 194). The plain one lay nearer level.
    for (const [weight, wide, foot, top] of [
      [87, 160, 598, 726],
      [194, 234, 587, 747],
    ]) {
      for (const name of ["grave", "acute"]) {
        const ink = box(name, weight);
        const said = `${name} at ${weight}`;
        expect(Math.abs(ink.xMax - ink.xMin - wide), said).toBeLessThan(12);
        expect(Math.abs(ink.yMax - ink.yMin - (top - foot)), said).toBeLessThan(12);
      }
      // And the same mark on the à: as tall as it is on its own.
      for (const [name, geist] of [
        ["circumflex", weight === 87 ? [274, 133] : [378, 166]],
        ["dieresis", weight === 87 ? [262, 98] : [422, 136]],
        ["tilde", weight === 87 ? [315, 127] : [361, 165]],
      ] as const) {
        // Geist's accents across and high. The plain circumflex came to a
        // point, the dots were smaller and closer, the tilde a round swash.
        const ink = box(name, weight);
        const said = `${name} at ${weight}`;
        expect(Math.abs(ink.xMax - ink.xMin - geist[0]), said).toBeLessThan(15);
        expect(Math.abs(ink.yMax - ink.yMin - geist[1]), said).toBeLessThan(15);
      }
      const accented = draw("agrave", weight).contours.map((one) => contoursBounds([one]));
      const mark = accented.reduce((high, one) => (one.yMax > high.yMax ? one : high));
      expect(Math.abs(mark.yMax - mark.yMin - (top - foot)), `à at ${weight}`).toBeLessThan(12);
    }
  });
});

describe("the accents' places", () => {
  it("stand as far off their letters as Geist's, the steep ones by their feet", () => {
    // Geist: 55 over a lowercase letter, 66 over a capital, with the foot of
    // a grave or an acute over the letter's middle. The accents stood 28 and
    // 13 off, centred by their whole width, half their lean to one side.
    for (const [name, base, gap] of [
      ["agrave", "a", 55],
      ["eacute", "e", 55],
      ["Agrave", "A", 66],
      ["Eacute", "E", 66],
    ] as const) {
      const letter = contoursBounds(draw(base, 87).contours);
      const pieces = draw(name, 87).contours.map((one) => ({ one, at: contoursBounds([one]) }));
      const mark = pieces.reduce((high, piece) => (piece.at.yMax > high.at.yMax ? piece : high));
      expect(Math.abs(mark.at.yMin - letter.yMax - gap), `${name} gap`).toBeLessThan(6);
      const foot = filled([mark.one], mark.at.yMin + 1, "y");
      const footMiddle = (foot[0][0] + foot[foot.length - 1][1]) / 2;
      const accented = contoursBounds(
        pieces.filter((piece) => piece !== mark).map((piece) => piece.one),
      );
      const middle = (accented.xMin + accented.xMax) / 2;
      expect(Math.abs(footMiddle - middle), `${name} foot`).toBeLessThan(10);
    }
  });
});

describe("the bar and the ampersand", () => {
  it("are Geist's height and width", () => {
    // Geist's bar runs from 110 under the line to 750, as its brackets do;
    // the plain one stood from the descender to the cap line. Geist
    // UltraBlack's ampersand (a stem of 172) is 690 across; its foot and arm
    // stood short, 678.
    for (const weight of [30, 87, 172]) {
      const bar = box("bar", weight);
      expect(bar.yMin, `bar at ${weight}`).toBeCloseTo(-110, -1);
      expect(bar.yMax, `bar at ${weight}`).toBeCloseTo(750, -1);
    }
    const ampersand = box("ampersand", 172);
    expect(Math.abs(ampersand.xMax - ampersand.xMin - 690)).toBeLessThan(8);
  });
});

describe("the tilde past the Black", () => {
  it("stays a wave, its lowest ink a round turn rather than a wedged end", () => {
    // Grown heavier as fast as the pen past the Black, its left end came
    // down past the turn above it and was cut level into a wedge 160 to 260
    // units long, the lowest thing in the mark.
    for (const weight of [200, 230, 260]) {
      const { contours } = draw("asciitilde", weight);
      const ink = contoursBounds(contours);
      const bottom = runs(contours, ink.yMin + 2, "y");
      expect(bottom[0][1] - bottom[0][0], `~ at ${weight}`).toBeLessThan(
        (ink.xMax - ink.xMin) * 0.2,
      );
    }
  });
});

describe("the stops and the bar at the heavy weights", () => {
  it("close their spacing as fast as Geist's do", () => {
    // Geist UltraBlack (a stem of 172) stands its bar and colon 68 off a
    // side and its full stop 34, closing them as fast as its n. Closed only
    // half as fast, they stood 81 and 42 off.
    for (const [name, side] of [
      ["bar", 68],
      ["colon", 68],
      ["period", 34],
    ] as const) {
      const drawn = draw(name, 172);
      const ink = contoursBounds(drawn.contours);
      expect(Math.abs(ink.xMin - side), `${name} left`).toBeLessThan(6);
      expect(Math.abs(drawn.advanceWidth - ink.xMax - side), `${name} right`).toBeLessThan(6);
    }
  });
});

describe("the percent past the old Black", () => {
  it("is Geist Black's width at pen 194", () => {
    // Geist's Black (a stem of 194) is 777 across. Moved apart from pen 172
    // on, as if nothing heavier than a stem of 172 were drawn, it was 828.
    const ink = box("percent", 194);
    expect(Math.abs(ink.xMax - ink.xMin - 777)).toBeLessThan(15);
  });
});

describe("the widths of the letters redrawn to the current Geist", () => {
  it("are Geist's width from the Thin to the Black", () => {
    // Geist's ink widths at its Thin, Regular, SemiBold, UltraBlack and
    // Black. The plain bowls grew past Geist's with the weight: the O 21
    // units too wide at UltraBlack and 33 at the Black, the D 34 and 66.
    const geist: Record<string, number[]> = {
      O: [614, 649, 677, 706, 720],
      D: [530, 561, 589, 618, 632],
      // And the B, C, P and R, which stood about 20 units narrow from the
      // SemiBold to the Black.
      B: [487, 526, 561, 596, 613],
      C: [581, 618, 643, 668, 680],
      P: [477, 506, 540, 574, 591],
      R: [479, 518, 554, 591, 609],
      // And the diagonal capitals, which stood 2 per cent narrow at the
      // Regular and grew 2 per cent too wide by the Black.
      A: [564, 628, 671, 714, 735],
      V: [594, 627, 671, 715, 736],
      W: [830, 869, 917, 965, 989],
      Y: [545, 588, 627, 665, 684],
      K: [499, 533, 579, 626, 649],
      N: [519, 559, 588, 617, 631],
      // And the H, M and zero, 9 to 15 narrow at the Regular and SemiBold.
      H: [484, 529, 559, 588, 603],
      M: [658, 693, 742, 791, 816],
      zero: [528, 563, 591, 619, 633],
      // And the f, c, j, e and g: the f 26 narrow at UltraBlack, the c 13,
      // the j 12, the e 12 wide.
      f: [254, 296, 344, 394, 418],
      c: [441, 468, 512, 556, 578],
      j: [152, 187, 243, 299, 327],
      e: [450, 473, 512, 552, 571],
      g: [435, 470, 511, 552, 572],
      // And the lowercase bowls and the y, which grew to their UltraBlack
      // widths too soon: the o, b and p 14 wide at the Black, the y 22.
      o: [450, 485, 525, 565, 584],
      b: [435, 471, 512, 552, 572],
      p: [435, 471, 512, 552, 572],
      y: [449, 493, 528, 562, 579],
      // And the figures, which grew too fast past the UltraBlack: the 2 29
      // wide at the Black, the 6 22, the 3 17 and the 9 15.
      one: [181, 234, 282, 330, 354],
      two: [477, 499, 525, 551, 565],
      three: [489, 513, 545, 578, 594],
      four: [500, 535, 571, 606, 624],
      five: [473, 505, 541, 577, 595],
      six: [478, 503, 533, 564, 579],
      seven: [469, 504, 518, 531, 538],
      nine: [478, 503, 536, 569, 586],
      // And the diagonals: the x 13 wide at the SemiBold and 11 narrow at
      // the Black, the X 19 wide at the Regular and 17 narrow at the Black,
      // the k 17 narrow and the slashes 25 narrow at the Black.
      x: [438, 491, 536, 581, 603],
      X: [558, 576, 634, 693, 722],
      k: [436, 463, 512, 560, 584],
      slash: [327, 375, 422, 468, 491],
      backslash: [327, 375, 421, 468, 491],
      // And the marks whose widths swung about Geist's: the parentheses 14
      // wide at the Thin, the question 16 narrow at the SemiBold, the
      // ampersand 15 narrow there and 11 wide at the Black, the S 16 narrow
      // at the Thin, the dollar 17 wide at UltraBlack, the number sign 14
      // wide at the Regular.
      parenleft: [139, 214, 250, 287, 305],
      question: [416, 471, 502, 534, 549],
      ampersand: [504, 560, 625, 690, 723],
      percent: [577, 714, 739, 765, 777],
      S: [503, 530, 562, 593, 609],
      dollar: [493, 519, 550, 581, 597],
      numbersign: [493, 493, 551, 609, 638],
      // And the arches: the n, h and u 9 wide at the SemiBold, where Geist
      // closes its counters faster than on the way to its Black, and the m
      // 18 wide there and 20 wide at the Thin.
      n: [386, 421, 461, 499, 519],
      m: [676, 717, 752, 786, 803],
      u: [386, 415, 456, 496, 517],
    };
    for (const [name, widths] of Object.entries(geist)) {
      for (const [index, weight] of [30, 87, 130, 172, 194].entries()) {
        const ink = box(name, weight);
        expect(Math.abs(ink.xMax - ink.xMin - widths[index]), `${name} at ${weight}`).toBeLessThan(
          10,
        );
      }
    }
  });
});

describe("the dollar", () => {
  it("has Geist's long light bar, and Geist's sides", () => {
    // Geist's bar runs from 90 under the line to 800, 74 across at the
    // Regular; its ink stands 55 off either side. The plain bar stood out 53
    // (to 763) and was nearly the stem's weight, and the fitting set the
    // dollar at 44 and 34. Held a few units inside what the health check
    // allows past the ascender.
    const drawn = draw("dollar", 87);
    const ink = contoursBounds(drawn.contours);
    expect(ink.yMin).toBeCloseTo(-90, -1);
    expect(ink.yMax).toBeGreaterThan(790);
    const bar = filled(drawn.contours, 770, "y");
    expect(bar.length).toBe(1);
    expect(bar[0][1] - bar[0][0]).toBeCloseTo(74, -1);
    expect(ink.xMin).toBeCloseTo(55, -1);
    expect(drawn.advanceWidth - ink.xMax).toBeCloseTo(55, -1);
  });
});

describe("the Sans's spacing at its Light", () => {
  it("opens as Geist Thin's does", () => {
    // Geist Thin sets its letters about 5 units further off either side than
    // its Regular, and its figures 10: n 85, H 96, the two 70 and the eight
    // 50. The Sans kept the Regular's spacing all the way down.
    for (const [name, side] of [
      ["n", 85],
      ["H", 96],
      ["two", 70],
      ["eight", 50],
    ] as const) {
      const drawn = draw(name, 30);
      const ink = contoursBounds(drawn.contours);
      expect(Math.abs(ink.xMin - side), `${name} left`).toBeLessThan(4);
      expect(Math.abs(drawn.advanceWidth - ink.xMax - side), `${name} right`).toBeLessThan(4);
    }
  });
});

describe("the s's width", () => {
  it("spreads as Geist's does from the Regular to the Black", () => {
    // Geist's ink widths at its Regular, SemiBold (a stem of 128),
    // UltraBlack (172) and Black (194). The s was 22 units narrow at 130 and
    // 20 at 172.
    const geist: Record<string, number[]> = { s: [432, 475, 518, 539], S: [530, 562, 593, 609] };
    for (const [name, widths] of Object.entries(geist)) {
      for (const [index, weight] of [87, 130, 172, 194].entries()) {
        const width = widths[index];
        const ink = box(name, weight);
        expect(Math.abs(ink.xMax - ink.xMin - width), `${name} at ${weight}`).toBeLessThan(15);
      }
    }
  });
});

describe("the rebuilt letters", () => {
  it("never cross themselves once rounded to whole units, as a font stores them", () => {
    const whole = (point: { x: number; y: number }) => ({
      x: Math.round(point.x),
      y: Math.round(point.y),
    });
    for (const name of ["a", "e", "s", "S", "dollar", "eight", "y"]) {
      for (const weight of [30, 87, 130, 172, 215, 260]) {
        draw(name, weight).contours.forEach((contour, index) => {
          const stored = {
            ...contour,
            nodes: contour.nodes.map((node) => ({
              ...node,
              point: whole(node.point),
              handleIn: node.handleIn && whole(node.handleIn),
              handleOut: node.handleOut && whole(node.handleOut),
            })),
          };
          expect(crossesItself(stored), `${name} at ${weight}, contour ${index}`).toBe(false);
        });
      }
    }
  });
});

describe("the brackets and braces", () => {
  it("are as wide as Geist's and stay open past the Black", () => {
    // Geist's ink widths at the Regular and the Black. The plain bracket was
    // 110 units narrow at the Regular and set solid from the Black on.
    const geist: Record<string, [number, number]> = {
      bracketleft: [240, 346],
      bracketright: [240, 346],
      braceleft: [329, 370],
      braceright: [329, 370],
    };
    for (const [name, [regular, black]] of Object.entries(geist)) {
      for (const [weight, width] of [
        [87, regular],
        [194, black],
      ]) {
        const ink = box(name, weight);
        expect(Math.abs(ink.xMax - ink.xMin - width), `${name} at ${weight}`).toBeLessThan(15);
      }
      for (const weight of [172, 260]) {
        const { contours } = draw(name, weight);
        const ink = contoursBounds(contours);
        // Through the middle of the upper half, the stem alone is ink.
        const y = ink.yMax - (ink.yMax - ink.yMin) * 0.25;
        const across = filled(contours, y, "y").reduce((sum, [from, to]) => sum + to - from, 0);
        expect(across, `${name} at ${weight}`).toBeLessThan((ink.xMax - ink.xMin) * 0.75);
      }
    }
  });
});

describe("the Sans's marks", () => {
  it("are Geist's size and stand where Geist's do", () => {
    // Geist's ink boxes at the Regular and the Black: left, bottom, right
    // and top. The plain plus was a third smaller, the underscore less than
    // half as long, the tilde wider and hung low, the less-than taller.
    const geist: Record<string, [number, number, number, number][]> = {
      plus: [
        [40, 56, 518, 534],
        [40, 32, 538, 530],
      ],
      less: [
        [40, 32, 494, 546],
        [40, 16, 504, 572],
      ],
      equal: [
        [40, 157, 500, 441],
        [40, 90, 520, 487],
      ],
      underscore: [
        [44, -78, 513, 0],
        [32, -150, 532, 0],
      ],
      asciitilde: [
        [40, 236, 483, 430],
        [40, 242, 483, 424],
      ],
    };
    for (const [name, [regular, black]] of Object.entries(geist)) {
      for (const [weight, [left, bottom, right, top]] of [
        [87, regular],
        [194, black],
      ] as const) {
        const ink = box(name, weight);
        const said = `${name} at ${weight}`;
        expect(Math.abs(ink.xMax - ink.xMin - (right - left)), said).toBeLessThan(15);
        expect(Math.abs(ink.yMin - bottom), said).toBeLessThan(15);
        expect(Math.abs(ink.yMax - top), said).toBeLessThan(15);
      }
    }
    // And the backslash is the slash turned round.
    const slash = box("slash", 87);
    const backslash = box("backslash", 87);
    expect(backslash.xMax - backslash.xMin).toBeCloseTo(slash.xMax - slash.xMin, 0);
    expect(backslash.yMin).toBeCloseTo(slash.yMin, 0);
  });
});

describe("the Sans's sidebearings", () => {
  it("stand where Geist's do at the Regular and the Black", () => {
    // Geist's left and right sidebearings at the Regular and the Black. The
    // W stood 17 closer than Geist's, the ! 6 to 11 closer, the T, Y, 7 and
    // X 12 to 26 further off, and the O 15 closer at the Black. Geist's Y, #
    // and j hang past their sides (the # 10 at the Regular), which the health
    // check once forbade: they were held 8 to 12 inside them instead.
    const geist: Record<string, [number, number, number, number]> = {
      W: [38, 38, 36, 36],
      T: [15, 15, 12, 12],
      Y: [-6, -4, -9, -7],
      numbersign: [-10, -5, 8, 10],
      j: [-5, 80, -4, 62],
      X: [15, 15, 10, 10],
      O: [45, 45, 40, 40],
      seven: [20, 8, 20, 7],
      six: [50, 40, 40, 30],
      nine: [40, 50, 30, 40],
      four: [30, 50, 20, 40],
      exclam: [50, 50, 45, 45],
      ampersand: [40, 20, 30, 10],
    };
    for (const [name, [left, right, blackLeft, blackRight]] of Object.entries(geist)) {
      for (const [weight, l, r] of [
        [87, left, right],
        [172, blackLeft, blackRight],
      ]) {
        const drawn = draw(name, weight);
        const ink = contoursBounds(drawn.contours);
        expect(Math.abs(ink.xMin - l), `${name} left at ${weight}`).toBeLessThan(9);
        expect(
          Math.abs(drawn.advanceWidth - ink.xMax - r),
          `${name} right at ${weight}`,
        ).toBeLessThan(9);
      }
    }
  });
});

describe("the heavy s's counters", () => {
  it("are narrow and tall, as Geist Black's are, not low slots", () => {
    // Geist Black's upper counter is 92 across and 70 high. Lightened in its
    // sides alone, the s's was 150 across and 60 high.
    for (const name of ["s", "S"]) {
      const { contours } = draw(name, 172);
      const ink = contoursBounds(contours);
      // The widest white between two runs of ink, in the upper half.
      let widest = { width: 0, x: 0, y: 0 };
      for (let y = ink.yMin + (ink.yMax - ink.yMin) * 0.55; y < ink.yMax; y += 4) {
        const runs = filled(contours, y, "y");
        for (let index = 1; index < runs.length; index++) {
          const width = runs[index][0] - runs[index - 1][1];
          if (width > widest.width)
            widest = { width, x: (runs[index][0] + runs[index - 1][1]) / 2, y };
        }
      }
      const column = filled(contours, widest.x, "x");
      const below = column.filter(([, to]) => to <= widest.y).at(-1)!;
      const above = column.find(([from]) => from >= widest.y)!;
      const high = above[0] - below[1];
      expect(widest.width / high, name).toBeLessThan(1.9);
    }
  });
});

describe("the sides of the lowercase bowls", () => {
  it("stand as far off as Geist's from the Thin to the Black", () => {
    // Geist's o stands 44 off either side at the Regular and 32 at the
    // Black; its b 80 off the stem and 44 off the bowl. Fitted, the bowls
    // closed to 26 and 20 at the heavy weights.
    const geist: [number, number[], number[]][] = [
      [30, [50, 50], [85, 50]],
      [87, [44, 44], [80, 44]],
      [130, [39, 39], [70, 39]],
      [172, [34, 34], [61, 34]],
      [194, [32, 32], [56, 32]],
    ];
    for (const [weight, o, b] of geist) {
      for (const [name, sides] of [
        ["o", o],
        ["b", b],
        ["d", [b[1], b[0]]],
      ] as const) {
        const glyph = draw(name, weight);
        const ink = contoursBounds(glyph.contours);
        const left = ink.xMin;
        const right = glyph.advanceWidth - ink.xMax;
        expect(Math.abs(left - sides[0]), `${name} left at ${weight}`).toBeLessThan(5);
        expect(Math.abs(right - sides[1]), `${name} right at ${weight}`).toBeLessThan(5);
      }
    }
  });
});

describe("the sides of the zero and the seven", () => {
  it("stand as far off as Geist's", () => {
    // Geist's zero stands 50 off either side at the Regular and 40 at the
    // Black (54 and 46 here before); its seven 20 off its left at every
    // weight and flush on its right, its Thin's unopened (30 and 18 before).
    const geist: [number, [number, number], [number, number]][] = [
      [30, [60, 60], [20, 0]],
      [87, [50, 50], [20, 0]],
      [194, [40, 40], [20, 0]],
    ];
    for (const [weight, zero, seven] of geist) {
      for (const [name, sides] of [
        ["zero", zero],
        ["seven", seven],
      ] as const) {
        const glyph = draw(name, weight);
        const ink = contoursBounds(glyph.contours);
        expect(Math.abs(ink.xMin - sides[0]), `${name} left at ${weight}`).toBeLessThan(5);
        expect(
          Math.abs(glyph.advanceWidth - ink.xMax - sides[1]),
          `${name} right at ${weight}`,
        ).toBeLessThan(5);
      }
    }
  });
});

describe("the five's flag", () => {
  it("reaches as far as Geist's from the Thin to the Black", () => {
    // Geist's flag ends 428 units from the ink's left at the Thin, 457 at
    // the Regular and 546 at the Black: here it stood at 454, 458 and 494.
    for (const [weight, reach] of [
      [30, 428],
      [87, 457],
      [194, 546],
    ]) {
      const { contours } = draw("five", weight);
      const ink = contoursBounds(contours);
      const top = filled(contours, 702, "y");
      const end = top[top.length - 1][1] - ink.xMin;
      expect(Math.abs(end - reach), `5 at ${weight}`).toBeLessThan(8);
    }
  });

  it("cuts its terminal as high as Geist's at the Black", () => {
    // Geist Black's terminal reaches 204 up at 60 in from its ink's left;
    // here it stopped at 187.
    const { contours } = draw("five", 194);
    const ink = contoursBounds(contours);
    const side = filled(contours, ink.xMin + 60, "x");
    expect(Math.abs(side[0][1] - 204)).toBeLessThan(6);
  });
});

describe("the horizontals at the current Black", () => {
  it("are as heavy as Geist Black's", () => {
    // Geist Black's 3 has a foot 168 deep and a top 165; its 5's flag is
    // 157. Lightened across from the UltraBlack on, they stood at 143, 144
    // and 139.
    const three = draw("three", 194).contours;
    const x = contoursBounds(three).xMin + 280;
    const column = filled(three, x, "x");
    expect(column[0][1] - column[0][0]).toBeGreaterThan(147);
    expect(column[column.length - 1][1] - column[column.length - 1][0]).toBeGreaterThan(147);
    const five = draw("five", 194).contours;
    const flag = filled(five, contoursBounds(five).xMin + 300, "x");
    expect(flag[flag.length - 1][1] - flag[flag.length - 1][0]).toBeGreaterThan(145);
  });
});

describe("the six's bowl", () => {
  it("comes down and lightens at its crown as Geist's does", () => {
    // 300 in from its ink's left, Geist's six's bowl tops out at 477 at the
    // Regular and 448 at the Black, its crown there 120 deep, and 112 of
    // white between it and the hood. On the stem's pen it stood at 484 at
    // every weight, its crown 152 deep with 65 of white under the hood.
    for (const [weight, top] of [
      [87, 477],
      [194, 448],
    ]) {
      const { contours } = draw("six", weight);
      const column = filled(contours, contoursBounds(contours).xMin + 300, "x");
      expect(Math.abs(column[1][1] - top), `6 top at ${weight}`).toBeLessThan(6);
      if (weight === 194) {
        expect(column[1][1] - column[1][0]).toBeLessThan(130);
        expect(column[2][0] - column[1][1]).toBeGreaterThan(90);
      }
    }
  });
});

describe("the five's bowl", () => {
  it("comes down and lightens at its crown as Geist's does", () => {
    // 300 in from its ink's left Geist's five's bowl tops out at 469 at the
    // Black, its crown 127 deep; on the stem's pen it stood at 471 and 153.
    const { contours } = draw("five", 194);
    const column = filled(contours, contoursBounds(contours).xMin + 300, "x");
    expect(Math.abs(column[1][1] - 469)).toBeLessThan(6);
    expect(Math.abs(column[1][1] - column[1][0] - 127)).toBeLessThan(10);
  });
});

describe("the three's waist", () => {
  it("is as light and as low as Geist's", () => {
    // 300 in from its ink's left Geist Black's three's waist runs from 297
    // to 429 and its foot is 161 deep; on the stem's pen the waist ran from
    // 304 to 453, 149 deep, over a foot of 151.
    const { contours } = draw("three", 194);
    const column = filled(contours, contoursBounds(contours).xMin + 300, "x");
    expect(column.length).toBe(3);
    expect(Math.abs(column[1][0] - 297)).toBeLessThan(6);
    expect(Math.abs(column[1][1] - 429)).toBeLessThan(6);
    expect(column[0][1] - column[0][0]).toBeGreaterThan(152);
  });
});

describe("the three's top terminal", () => {
  it("comes down and out as far as Geist's at the Black", () => {
    // Geist Black's terminal reaches down to 510 and out to 9 from its
    // ink's left at 530; cut at a fixed height it stopped above 550, 23 in.
    const { contours } = draw("three", 194);
    const left = contoursBounds(contours).xMin;
    const at530 = filled(contours, 530);
    expect(at530.length).toBe(2);
    expect(Math.abs(at530[0][0] - left - 9)).toBeLessThan(6);
    expect(filled(contours, 512).length).toBe(2);
  });
});

describe("the six's and nine's terminals", () => {
  it("are cut where Geist's are", () => {
    // Geist Black's six's hood ends at 519, 440 in from its ink's left;
    // cut at a fixed height it ended at 553. Geist's nine is not its six
    // turned: its tail ends at 140 at the Regular and 177 at the Black, 80
    // in, where the turned six's ended at 159 and 158.
    const six = draw("six", 194).contours;
    const hood = filled(six, contoursBounds(six).xMin + 440, "x");
    expect(Math.abs(hood[hood.length - 1][0] - 519)).toBeLessThan(6);
    for (const [weight, tail] of [
      [87, 140],
      [194, 177],
    ]) {
      const nine = draw("nine", weight).contours;
      const column = filled(nine, contoursBounds(nine).xMin + 80, "x");
      expect(Math.abs(column[0][1] - tail), `9 at ${weight}`).toBeLessThan(6);
    }
  });
});

describe("the sides of the letters Geist closes as fast as its n", () => {
  it("stand as far off as Geist's at the Regular and the Black", () => {
    // Geist's sides, left and right. Closed half as fast as the n, they
    // stood 8 to 16 units loose at the Black (the B 51 off its bowl, the U
    // 63 off either side), and the l's tailed foot stood 16 off.
    const geist: Record<string, [[number, number], [number, number]]> = {
      a: [
        [44, 19],
        [32, 9],
      ],
      c: [
        [44, 34],
        [32, 22],
      ],
      l: [
        [80, 24],
        [56, 14],
      ],
      r: [
        [80, 44],
        [56, 32],
      ],
      B: [
        [92, 62],
        [62, 43],
      ],
      K: [
        [92, 15],
        [62, 10],
      ],
      L: [
        [92, 47],
        [62, 28],
      ],
      R: [
        [92, 62],
        [62, 43],
      ],
      U: [
        [77, 77],
        [47, 47],
      ],
    };
    for (const [name, sides] of Object.entries(geist)) {
      for (const [index, weight] of [87, 194].entries()) {
        const glyph = draw(name, weight);
        const ink = contoursBounds(glyph.contours);
        const [left, right] = sides[index];
        expect(Math.abs(ink.xMin - left), `${name} left at ${weight}`).toBeLessThan(7);
        expect(
          Math.abs(glyph.advanceWidth - ink.xMax - right),
          `${name} right at ${weight}`,
        ).toBeLessThan(7);
      }
    }
  });
});

describe("the hyphen, the quotes, the asterisk and the at sign at the Black", () => {
  it("are as deep, as wide and as light as Geist's", () => {
    // Geist Black's hyphen is 152 deep (132 here before), its quote 140
    // across (123), its asterisk 352 (374), and its at sign's ring 110
    // across its side (148) in an at sign 920 wide (938).
    const hyphen = box("hyphen", 194);
    expect(Math.abs(hyphen.yMax - hyphen.yMin - 152)).toBeLessThan(5);
    const quote = box("quotesingle", 194);
    expect(Math.abs(quote.xMax - quote.xMin - 140)).toBeLessThan(5);
    const star = box("asterisk", 194);
    expect(Math.abs(star.xMax - star.xMin - 352)).toBeLessThan(6);
    const at = draw("at", 194).contours;
    const ink = contoursBounds(at);
    expect(Math.abs(ink.xMax - ink.xMin - 920)).toBeLessThan(8);
    const side = filled(at, 320)[0];
    expect(Math.abs(side[1] - side[0] - 110)).toBeLessThan(8);
  });
});

describe("the at sign's hook", () => {
  it("turns into the ring low down, as Geist's does", () => {
    // 650 in from its ink's left Geist's hook bottoms out at 85 on the
    // Regular; landed at the ring's widest, ours turned at 150 and more.
    const { contours } = draw("at", 87);
    const column = filled(contours, contoursBounds(contours).xMin + 650, "x");
    expect(column[0][0]).toBeLessThan(100);
  });
});

describe("the sides of the S, the question, the ampersand, the g and the y", () => {
  it("stand as far off as Geist's at the Regular and the Black", () => {
    // Fitted, the S and the g closed to 40 and 17 at the Black (Geist 50
    // and 32), and the y to 14 (20); the question and ampersand, listed,
    // closed only half as fast as Geist's and stood 8 loose.
    const geist: Record<string, [[number, number], [number, number]]> = {
      S: [
        [55, 55],
        [50, 50],
      ],
      question: [
        [44, 44],
        [32, 32],
      ],
      ampersand: [
        [40, 20],
        [30, 10],
      ],
      g: [
        [44, 80],
        [32, 56],
      ],
      y: [
        [22, 22],
        [20, 20],
      ],
    };
    for (const [name, sides] of Object.entries(geist)) {
      for (const [index, weight] of [87, 194].entries()) {
        const glyph = draw(name, weight);
        const ink = contoursBounds(glyph.contours);
        const [left, right] = sides[index];
        expect(Math.abs(ink.xMin - left), `${name} left at ${weight}`).toBeLessThan(7);
        expect(
          Math.abs(glyph.advanceWidth - ink.xMax - right),
          `${name} right at ${weight}`,
        ).toBeLessThan(7);
      }
    }
  });
});

describe("the x-height at the heavy weights", () => {
  it("rises as Geist's does", () => {
    // The tops of Geist's round and arched letters: 542 at the Regular, 546
    // at the SemiBold, 550 at UltraBlack and 552 at the Black; here they
    // stood at 542 throughout.
    for (const [weight, top] of [
      [87, 542],
      [130, 546],
      [172, 550],
      [194, 552],
    ]) {
      for (const name of ["n", "x", "o"]) {
        const ink = box(name, weight);
        // The n's arch and the o overshoot the line by 12; the x stands on it.
        const line = name === "x" ? top - 12 : top;
        expect(Math.abs(ink.yMax - line), `${name} at ${weight}`).toBeLessThan(2.5);
      }
    }
  });
});

describe("the full stop", () => {
  it("is as tall against its width as Geist's", () => {
    // Geist's is 65 tall on 59 at the Thin, square at the Regular and 180
    // on 196 at the Black; square at every weight, ours stood 197 at the
    // Black and 59 at the Thin.
    for (const [weight, tall] of [
      [30, 65],
      [87, 113],
      [194, 180],
    ]) {
      const ink = box("period", weight);
      expect(Math.abs(ink.yMax - ink.yMin - tall), `. at ${weight}`).toBeLessThan(5);
    }
  });
});

describe("the G's spur", () => {
  it("drops straight to the line, lighter than the stem, with a notch beside it", () => {
    // Geist's spur is 65 across at the Regular and 117 at the Black, and
    // its bowl leaves a notch 50 across beside it 50 over the line; ours
    // ran up into a stem's-weight spur with no notch at all.
    for (const [weight, spur] of [
      [87, 65],
      [194, 117],
    ]) {
      const { contours } = draw("G", weight);
      const low = filled(contours, 20);
      const last = low[low.length - 1];
      expect(Math.abs(last[1] - last[0] - spur), `G at ${weight}`).toBeLessThan(6);
      expect(filled(contours, 50).length, `G at ${weight}`).toBe(2);
    }
  });
});

describe("the G's bar", () => {
  it("is as deep and starts where Geist's does", () => {
    // Geist Black's bar runs from 246 to 376 and starts 350 in from its ink's
    // left; ours ran 244 to 393 and started at 337.
    const { contours } = draw("G", 194);
    const left = contoursBounds(contours).xMin;
    const column = filled(contours, left + 450, "x");
    expect(Math.abs(column[1][0] - 246)).toBeLessThan(4);
    expect(Math.abs(column[1][1] - 376)).toBeLessThan(4);
    expect(Math.abs(filled(contours, 340)[1][0] - left - 350)).toBeLessThan(4);
  });
});

describe("the l's foot", () => {
  it("turns out as Geist's does, its tail lighter than its stem", () => {
    // Geist Black's l: a tail 137 deep on a stem of 194, its outside corner
    // reaching 43 in from the stem's left 40 over the line, and the tail
    // running 79 past the stem. Ours ran a stem-deep tail round a corner
    // that cut 72 in at that height.
    const { contours } = draw("l", 194);
    const left = contoursBounds(contours).xMin;
    expect(Math.abs(filled(contours, 40)[0][0] - left - 43)).toBeLessThan(7);
    const tail = filled(contours, left + 250, "x");
    expect(Math.abs(tail[0][1] - 137)).toBeLessThan(6);
  });
});

describe("the one's cove", () => {
  it("carves as far into the head as Geist's, over a flag as light", () => {
    // Geist Regular's cove leaves its ink starting 154 in from the ink's
    // left 640 up, its Black's flag is 136 deep. Turned out of the stem on
    // its pen, the Regular's started at 125 and the Black's flag was 196.
    const regular = draw("one", 87).contours;
    const left = contoursBounds(regular).xMin;
    expect(Math.abs(filled(regular, 640)[0][0] - left - 154)).toBeLessThan(6);
    const black = draw("one", 194).contours;
    const flag = filled(black, contoursBounds(black).xMin + 60, "x");
    expect(Math.abs(flag[0][1] - flag[0][0] - 136)).toBeLessThan(6);
  });
});

describe("the two's diagonal", () => {
  it("falls across the letter where Geist's does, from the Thin to the Black", () => {
    // Geist's stroke 300 up runs from 227 to 297 in from its foot's left at
    // the Thin, 168 to 340 at the Regular and 107 to 418 at the Black. As an
    // S landed upright it ran 296-353, 124-395 and 51-428.
    const geist: Record<number, [number, number]> = {
      30: [227, 297],
      87: [168, 340],
      194: [107, 418],
    };
    for (const [weight, [from, to]] of Object.entries(geist)) {
      const two = draw("two", Number(weight)).contours;
      const foot = filled(two, 20)[0][0];
      const [left, right] = filled(two, 300)[0];
      expect(Math.abs(left - foot - from)).toBeLessThan(20);
      expect(Math.abs(right - foot - to)).toBeLessThan(10);
    }
  });
});

describe("the question mark's neck", () => {
  it("leans into its bowl and stops over the dot where Geist's does", () => {
    // Geist's neck 350 up runs 291-331 at the Thin, 282-407 at the Regular
    // and 231-458 at the UltraBlack. On a tight turn out of a full-depth
    // hook it ran 247-280, 252-405 and 255-505.
    const geist: Record<number, [number, number]> = {
      30: [291, 331],
      87: [282, 407],
      172: [231, 458],
    };
    for (const [weight, [from, to]] of Object.entries(geist)) {
      const [left, right] = filled(draw("question", Number(weight)).contours, 350)[0];
      expect(Math.abs(left - from)).toBeLessThan(10);
      expect(Math.abs(right - to)).toBeLessThan(15);
    }
    // And the white over the dot as Geist's: its neck stops 232 up at the
    // UltraBlack and 240 at the Black, where it stood 245 and 257.
    for (const [weight, foot] of [
      [172, 232],
      [194, 240],
    ]) {
      const up = filled(draw("question", weight).contours, 300, "x");
      expect(Math.abs(up[1][0] - foot)).toBeLessThan(6);
    }
  });
});

describe("the five's stem and flag", () => {
  it("stand where Geist's do, as deep and as light", () => {
    // Geist's stem 600 up starts 112 in at the Thin, 107 at the Regular and
    // 96 at the Black, where the Sans's stood at 125, 112 and 103.
    for (const [weight, left] of [
      [30, 112],
      [87, 107],
      [194, 96],
    ]) {
      expect(Math.abs(filled(draw("five", weight).contours, 600)[0][0] - left)).toBeLessThan(4);
    }
    // Its flag comes down to 597 at the SemiBold and 553 at the Black (592
    // and 561), and the Thin's stem stops 327 up (310).
    for (const [weight, under] of [
      [130, 597],
      [194, 553],
    ]) {
      const up = filled(draw("five", weight).contours, 450, "x");
      expect(Math.abs(up[up.length - 1][0] - under)).toBeLessThan(4);
    }
    const thin = filled(draw("five", 30).contours, 100, "x");
    expect(Math.abs(thin[1][0] - 327)).toBeLessThan(4);
  });
});

describe("the six's and nine's bowls", () => {
  it("are rounder where the hood and tail leave them, as Geist's are", () => {
    // 100 up Geist's six's bowl starts 94 in at the Regular and the
    // UltraBlack; as one superellipse it started at 81 and 78. Turned, its
    // nine's reaches 479 at the UltraBlack 680 up, where it reached 498.
    for (const weight of [87, 172]) {
      expect(Math.abs(filled(draw("six", weight).contours, 100)[0][0] - 94)).toBeLessThan(12);
    }
    const nine = filled(draw("nine", 172).contours, 680)[0];
    expect(Math.abs(nine[1] - 479)).toBeLessThan(12);
  });
});

describe("the six's hood", () => {
  it("rises and rounds over as Geist's does at the heavy weights", () => {
    // At the UltraBlack Geist's hood reaches 478 700 up and its left side
    // stands 67 in 500 up, where at the face's fullness it reached 455 and
    // stood at 74.
    const six = draw("six", 172).contours;
    expect(Math.abs(filled(six, 700)[0][1] - 478)).toBeLessThan(16);
    expect(Math.abs(filled(six, 500)[0][0] - 67)).toBeLessThan(5);
  });
});

describe("the sides Geist holds, and the ones it closes faster", () => {
  it("stand where Geist's do from the Thin to the Black", () => {
    // Left and right at the Thin, the Regular and the Black. Geist holds its
    // signs 40 off at every weight (they closed to 34 and opened to 45), closes
    // its hyphen as fast as its n (it stood 40 off at the Black), gives a
    // capital less extra room as it grows (the H stood 66 off at the Black),
    // hardly closes its O (36), and sets the right of its E 7 closer at its
    // Thin (it stood 61 off).
    const geist: Record<string, Array<[number, number, number]>> = {
      plus: [
        [30, 40, 40],
        [194, 40, 40],
      ],
      hyphen: [[194, 32, 32]],
      H: [[194, 62, 62]],
      O: [[194, 40, 40]],
      E: [
        [30, 96, 50],
        [87, 92, 57],
      ],
    };
    for (const [name, rows] of Object.entries(geist)) {
      for (const [weight, left, right] of rows) {
        const drawn = draw(name, weight);
        const ink = contoursBounds(drawn.contours);
        expect(Math.abs(ink.xMin - left), `${name} left at ${weight}`).toBeLessThan(3);
        expect(
          Math.abs(drawn.advanceWidth - ink.xMax - right),
          `${name} right at ${weight}`,
        ).toBeLessThan(3);
      }
    }
  });
});

describe("the s at the Thin and the Black", () => {
  it("is as wide as Geist's", () => {
    // Geist's s is 408 wide at the Thin and 539 at the Black; it stood 398
    // and 554.
    for (const [weight, wide] of [
      [30, 408],
      [194, 539],
    ]) {
      const ink = box("s", weight);
      expect(Math.abs(ink.xMax - ink.xMin - wide), `s at ${weight}`).toBeLessThan(5);
    }
  });
});

describe("the tilde and the w", () => {
  it("are as wide as Geist's", () => {
    // Geist's tilde is 443 across at the Regular and its w 797 at the
    // SemiBold; the tilde's ink stood 455 across, its cut ends past its
    // reach, and the w 786.
    const tilde = box("asciitilde", 87);
    expect(Math.abs(tilde.xMax - tilde.xMin - 443)).toBeLessThan(4);
    const w = box("w", 130);
    expect(Math.abs(w.xMax - w.xMin - 797)).toBeLessThan(4);
  });
});

describe("the Q's tail", () => {
  it("is as light as Geist's and stands where it does", () => {
    // 50 under the line Geist's tail runs 556-593 at the Thin and 566-703 at
    // the UltraBlack; on the pen it ran 586-623 and 504-705.
    for (const [weight, from, to] of [
      [30, 556, 593],
      [172, 566, 703],
    ]) {
      const [left, right] = filled(draw("Q", weight).contours, -50)[0];
      expect(Math.abs(left - from), `Q at ${weight}`).toBeLessThan(6);
      expect(Math.abs(right - to), `Q at ${weight}`).toBeLessThan(8);
    }
  });
});

describe("the D's crowns", () => {
  it("run as far along the lines as Geist's before they turn", () => {
    // 690 up Geist's D runs to 429 at the Thin and 448 at the Regular; on a
    // round half as long as its height it turned at 385 and 427.
    for (const [weight, reach, within] of [
      [30, 429, 16],
      [87, 448, 8],
    ]) {
      const run = filled(draw("D", weight).contours, 690)[0];
      expect(Math.abs(run[1] - reach), `D at ${weight}`).toBeLessThan(within);
    }
  });
});

describe("the P's bowl", () => {
  it("rounds over from its top as early as Geist's", () => {
    // 660 up Geist's P runs to 523 at the Regular and 550 at the
    // UltraBlack; on a shorter round it ran on to 539 and 563.
    for (const [weight, reach] of [
      [87, 523],
      [172, 550],
    ]) {
      const run = filled(draw("P", weight).contours, 660)[0];
      expect(Math.abs(run[1] - reach), `P at ${weight}`).toBeLessThan(6);
    }
  });
});

describe("the comma's tail", () => {
  it("leaves the dot and leans as Geist's does", () => {
    // 40 under the line Geist's tail runs 83-138 at the Regular and 91-191
    // at the UltraBlack; out of the middle of the dot's foot it ran 71-124
    // and 70-158.
    for (const [weight, from, to] of [
      [87, 83, 138],
      [172, 91, 191],
    ]) {
      const [left, right] = filled(draw("comma", weight).contours, -40)[0];
      expect(Math.abs(left - from), `, at ${weight}`).toBeLessThan(6);
      expect(Math.abs(right - to), `, at ${weight}`).toBeLessThan(6);
    }
  });
});

describe("the seven's stroke", () => {
  it("lands where Geist's does", () => {
    // 100 up Geist's seven runs from 200 at the Thin, 185 at the Regular and
    // 161 at the Black; landing at one place for every weight it ran from
    // 197, 199 and 187.
    for (const [weight, from] of [
      [30, 200],
      [87, 185],
      [194, 161],
    ]) {
      const left = filled(draw("seven", weight).contours, 100)[0][0];
      expect(Math.abs(left - from), `7 at ${weight}`).toBeLessThan(10);
    }
  });
});

describe("the four's stem", () => {
  it("stands where Geist's does", () => {
    // 100 up Geist's four's stem runs 391-477 at the Regular and 368-564 at
    // the Black; it stood at 398-485 and 376-570.
    for (const [weight, from, to] of [
      [87, 391, 477],
      [194, 368, 564],
    ]) {
      const [left, right] = filled(draw("four", weight).contours, 100)[0];
      expect(Math.abs(left - from), `4 at ${weight}`).toBeLessThan(4);
      expect(Math.abs(right - to), `4 at ${weight}`).toBeLessThan(4);
    }
  });
});

describe("the t's foot", () => {
  it("turns as tight as Geist's", () => {
    // 150 in, Geist Regular's t's stem comes down to 57 before it turns out
    // along its foot; on a rounder turn it stopped at 78.
    const t = filled(draw("t", 87).contours, 150, "x");
    expect(Math.abs(t[0][0] - 57)).toBeLessThan(6);
  });
});

describe("the f's bar", () => {
  it("is as heavy and as high as Geist's", () => {
    // 300 in Geist's f's bar runs 456-530 at the Regular and 413-538 at the
    // UltraBlack; it ran 449-530 and 392-521.
    for (const [weight, from, to] of [
      [87, 456, 530],
      [172, 413, 538],
    ]) {
      const bar = filled(draw("f", weight).contours, 300, "x")[0];
      expect(Math.abs(bar[0] - from), `f at ${weight}`).toBeLessThan(6);
      expect(Math.abs(bar[1] - to), `f at ${weight}`).toBeLessThan(4);
    }
  });
});

describe("the x's top", () => {
  it("is as narrow as Geist's", () => {
    // 520 up Geist Regular's x runs from 65 to 522; its top as wide as its
    // foot ran from 55 to 531.
    const run = filled(draw("x", 87).contours, 520);
    expect(Math.abs(run[0][0] - 65)).toBeLessThan(6);
    expect(Math.abs(run[run.length - 1][1] - 522)).toBeLessThan(6);
  });
});

describe("the k's arm", () => {
  it("leaves the stem where Geist's does", () => {
    // 250 up Geist Thin's arm runs from 173 to 212 and its leg from 275 to
    // 310; low on the stem, they ran 194-235 and 292-329.
    const run = filled(draw("k", 30).contours, 250);
    expect(Math.abs(run[1][0] - 173)).toBeLessThan(6);
    expect(Math.abs(run[2][0] - 275)).toBeLessThan(6);
  });
});

describe("the K's leg", () => {
  it("stands where Geist's does at the UltraBlack", () => {
    // 200 up Geist UltraBlack's K's leg runs from 364 to 558; off an arm
    // leaving the stem higher it ran from 343 to 543.
    const run = filled(draw("K", 172).contours, 200);
    expect(Math.abs(run[run.length - 1][0] - 364)).toBeLessThan(6);
    expect(Math.abs(run[run.length - 1][1] - 558)).toBeLessThan(6);
  });
});

describe("the Thin W's feet", () => {
  it("stand where Geist Thin's do", () => {
    // 20 up Geist Thin's W's feet run 236-294 and 621-679; they stood at
    // 225-276 and 646-697.
    const run = filled(draw("W", 30).contours, 20);
    expect(Math.abs(run[0][0] - 236)).toBeLessThan(8);
    expect(Math.abs(run[run.length - 1][1] - 679)).toBeLessThan(8);
  });
});

describe("the Thin M and Z, and the R's waist", () => {
  it("stand where Geist's do", () => {
    // 550 up Geist Thin's M's diagonals start 182 and 635 in; they stood at
    // 174 and 649. Geist Thin's Z is 463 wide; it stood 470 and now 458.
    const m = filled(draw("M", 30).contours, 550);
    expect(Math.abs(m[1][0] - 182)).toBeLessThan(5);
    expect(Math.abs(m[2][0] - 635)).toBeLessThan(5);
    const z = box("Z", 30);
    expect(Math.abs(z.xMax - z.xMin - 463)).toBeLessThan(6);
    // 300 up Geist Regular's R's waist runs from its stem to its bowl in one;
    // set higher, the counter showed between them.
    expect(filled(draw("R", 87).contours, 300)).toHaveLength(1);
  });
});

describe("the Thin's round and diagonal sides", () => {
  it("stand where Geist Thin's do", () => {
    // Geist Thin sets its v 24 off its left and its Black its e 32; opened
    // with the rest the v stood 27, and closing only half as fast the e 37.
    const v = draw("v", 30);
    expect(Math.abs(contoursBounds(v.contours).xMin - 24)).toBeLessThan(2);
    const e = draw("e", 194);
    expect(Math.abs(contoursBounds(e.contours).xMin - 32)).toBeLessThan(3);
  });
});

describe("the three's notch", () => {
  it("runs further in where the bowls meet", () => {
    // 380 up Geist Regular's three's bowls meet 422 in; on the face's
    // fullness Draw's met in a shallow dip at 470.
    const run = filled(draw("three", 87).contours, 380);
    expect(run[run.length - 1][1]).toBeLessThan(466);
  });
});

describe("the B's waist", () => {
  it("is notched further in where the bowls meet", () => {
    // 365 up Geist Regular's B's bowls meet 474 in; on the face's fullness
    // Draw's met at 532.
    const run = filled(draw("B", 87).contours, 365);
    expect(run[run.length - 1][1]).toBeLessThan(528);
  });
});

describe("the w's strokes", () => {
  it("are as light as Geist's", () => {
    // 360 up Geist UltraBlack's w's outer strokes run 73-235 and 625-787;
    // on the pen they ran 67-243 and 616-791.
    const run = filled(draw("w", 172).contours, 360);
    expect(Math.abs(run[0][0] - 73)).toBeLessThan(4);
    expect(Math.abs(run[0][1] - 235)).toBeLessThan(6);
  });
});

describe("the v's vertex", () => {
  it("is as narrow as Geist's at the Black", () => {
    // 10 up Geist Black's v runs from 215 to 442; its feet as far apart as
    // the face's left it running 202-456.
    const [left, right] = filled(draw("v", 194).contours, 10)[0];
    expect(Math.abs(left - 215)).toBeLessThan(5);
    expect(Math.abs(right - 442)).toBeLessThan(5);
  });
});

describe("the y's left arm", () => {
  it("is as light as Geist's at the SemiBold", () => {
    // 300 up Geist SemiBold's y's left arm runs 125 across; on the pen it
    // ran about 138.
    const [left, right] = filled(draw("y", 130).contours, 300)[0];
    expect(Math.abs(right - left - 125)).toBeLessThan(6);
  });
});

describe("the heavy A's head and W's feet", () => {
  it("are as narrow as Geist's at the UltraBlack", () => {
    // 690 up Geist UltraBlack's A's head is 217 across, where Draw's stood
    // about 242; 20 up its W's feet are 192 and 193 across, where Draw's
    // stood about 230.
    const a = filled(draw("A", 172).contours, 690)[0];
    expect(Math.abs(a[1] - a[0] - 217)).toBeLessThan(12);
    const w = filled(draw("W", 172).contours, 20);
    expect(Math.abs(w[0][1] - w[0][0] - 192)).toBeLessThan(15);
  });
});

describe("the light P's bowl and F's bar", () => {
  it("close and stand where Geist's do", () => {
    // 300 in Geist Thin's P's bowl closes at 305-335 and Regular's at
    // 276-360; they closed at 316-345 and 290-371. 330 in Geist Thin's F's
    // bar runs 339-369; it ran 333-362.
    for (const [name, weight, from, to] of [
      ["P", 30, 305, 335],
      ["P", 87, 276, 360],
      ["F", 30, 339, 369],
    ] as const) {
      const [bar] = filled(draw(name, weight).contours, name === "P" ? 300 : 330, "x");
      expect(Math.abs(bar[0] - from), `${name} at ${weight}`).toBeLessThan(4);
      expect(Math.abs(bar[1] - to), `${name} at ${weight}`).toBeLessThan(4);
    }
  });
});

describe("the heavy horizontals", () => {
  it("thin as fast as Geist's from the Regular and level off", () => {
    // Geist's o's crown is 104 on a stem of 128 and 144 on 194, its H's bar
    // 113 and 157, and its e's crown 134 at the Black; they were 116 and 137,
    // 118 and 150, and 140.
    for (const [name, weight, at, crown] of [
      ["o", 128, 290, 104],
      ["o", 194, 290, 144],
      ["H", 128, 330, 113],
      ["H", 194, 330, 157],
    ] as const) {
      const runs = filled(draw(name, weight).contours, at, "x");
      const [from, to] = name === "o" ? runs[runs.length - 1] : runs[0];
      expect(Math.abs(to - from - crown), `${name} at ${weight}`).toBeLessThan(4);
    }
    const e = filled(draw("e", 194).contours, 300, "x");
    const [from, to] = e[e.length - 1];
    expect(Math.abs(to - from - 134), "e at 194").toBeLessThan(5);
  });
});

describe("the e's shoulders", () => {
  it("round over as Geist's do", () => {
    // 450 up Geist's e runs 97-468 at the Regular and 90-546 at the Black;
    // drawn round its bar's top it ran 82-480 and 74-563.
    for (const [weight, from, to] of [
      [87, 97, 468],
      [194, 90, 546],
    ]) {
      const row = filled(draw("e", weight).contours, 450);
      expect(Math.abs(row[0][0] - from), `e at ${weight}`).toBeLessThan(6);
      expect(Math.abs(row[row.length - 1][1] - to), `e at ${weight}`).toBeLessThan(6);
    }
  });
});

describe("the five's bowl", () => {
  it("is as round as Geist's", () => {
    // 100 up Geist Regular's five's bowl comes in from the right to 419 and
    // Thin's to 477; as the face's superellipse it came to 429 and 475.
    for (const [weight, inside, ink] of [
      [87, 419, 1],
      [30, 477, 1],
    ]) {
      const row = filled(draw("five", weight).contours, 100);
      expect(Math.abs(row[ink][0] - inside), `5 at ${weight}`).toBeLessThan(6);
    }
  });
});

describe("the Thin e's tail", () => {
  it("sweeps as low and as full as Geist's", () => {
    // 480 in Geist Thin's e's tail runs 118-144; it ran 150-158, cut high
    // off a leaner round.
    const [tail] = filled(draw("e", 30).contours, 480, "x");
    expect(Math.abs(tail[0] - 118)).toBeLessThan(10);
    expect(Math.abs(tail[1] - 144)).toBeLessThan(6);
  });
});

describe("the slash and the z's diagonal", () => {
  it("are as light as Geist's at the Regular", () => {
    // 200 up Geist Regular's slash runs 80 across and its z's diagonal 101;
    // on the pen they ran 91 and 112.
    for (const [name, across] of [
      ["slash", 80],
      ["z", 101],
    ] as const) {
      const row = filled(draw(name, 87).contours, 200);
      const [from, to] = row[row.length - 1];
      expect(Math.abs(to - from - across), name).toBeLessThan(4);
    }
  });
});

describe("the parentheses", () => {
  it("taper to their ends, as Geist's do", () => {
    // 90 under the line Geist Regular's ( runs 172-248, and the Black's
    // 162-335; at one weight all along it ran 150-249 and 129-333.
    for (const [weight, from, to] of [
      [87, 172, 248],
      [194, 162, 335],
    ]) {
      const [run] = filled(draw("parenleft", weight).contours, -90);
      expect(Math.abs(run[0] - from), `( at ${weight}`).toBeLessThan(8);
      expect(Math.abs(run[1] - to), `( at ${weight}`).toBeLessThan(6);
    }
  });
});

describe("the SemiBold percent", () => {
  it("is as light as Geist's and within its lines", () => {
    // 600 up Geist SemiBold's slash runs 88 across and its ink stays between
    // -8 and 718; it ran 102 and reached -12 and 722.
    const { contours } = draw("percent", 130);
    const row = filled(contours, 600);
    const [from, to] = row[row.length - 1];
    expect(Math.abs(to - from - 88)).toBeLessThan(5);
    const ink = contoursBounds(contours);
    expect(ink.yMin).toBeGreaterThan(-10);
    expect(ink.yMax).toBeLessThan(720);
  });
});

describe("the brackets", () => {
  it("are as light as Geist's and as long", () => {
    // 300 up Geist SemiBold's ] stem runs 173-295 and 60 in its bars run
    // down to -8 and from 648; on the pen they ran 157-287, -2 and 643.
    const { contours } = draw("bracketright", 130);
    const [stem] = filled(contours, 300);
    expect(Math.abs(stem[0] - 173)).toBeLessThan(4);
    expect(Math.abs(stem[1] - 295)).toBeLessThan(4);
    const bars = filled(contours, 60, "x");
    expect(Math.abs(bars[0][1] - -8)).toBeLessThan(4);
    expect(Math.abs(bars[bars.length - 1][0] - 648)).toBeLessThan(4);
  });
});

describe("the grave", () => {
  it("is a wedge, as Geist's is", () => {
    // Geist Regular's grave runs 133-203 at 600 and 63-152 at 700; drawn as
    // one stroke it ran 121-203 and 60-142.
    const { contours } = draw("grave", 87);
    for (const [y, from, to] of [
      [600, 133, 203],
      [700, 63, 152],
    ]) {
      const [run] = filled(contours, y);
      expect(Math.abs(run[0] - from), `at ${y}`).toBeLessThan(4);
      expect(Math.abs(run[1] - to), `at ${y}`).toBeLessThan(4);
    }
  });
});

describe("the accents over a heavy letter", () => {
  it("stand as close as Geist's", () => {
    // 300 in, Geist Black's é and è have their accents' feet at 585; set 55
    // over the letter at every weight they stood at 607.
    for (const name of ["eacute", "egrave"]) {
      const runs = filled(draw(name, 194).contours, 300, "x");
      expect(Math.abs(runs[runs.length - 1][0] - 585), name).toBeLessThan(4);
    }
  });
});

describe("the f's stem", () => {
  it("stands where Geist's does at the Regular", () => {
    // 100 up Geist Regular's f's stem runs 132-216; it ran 138-225.
    const [stem] = filled(draw("f", 87).contours, 100);
    expect(Math.abs(stem[0] - 132)).toBeLessThan(4);
    expect(Math.abs(stem[1] - 216)).toBeLessThan(5);
  });
});

describe("the dollar's S", () => {
  it("is as short as Geist's", () => {
    // 400 in, the top of Geist Regular's dollar's S reaches 697; drawn at
    // the S's own height it reached 713.
    const runs = filled(draw("dollar", 87).contours, 400, "x");
    expect(Math.abs(runs[runs.length - 1][1] - 697)).toBeLessThan(6);
  });
});

describe("the SemiBold a's bowl", () => {
  it("is as light along its top as Geist's", () => {
    // 250 in, Geist SemiBold's a's bowl runs 218-306 under its counter; on
    // the pen's contrast it ran 198-308.
    const runs = filled(draw("a", 130).contours, 250, "x");
    expect(Math.abs(runs[1][0] - 218)).toBeLessThan(12);
    expect(Math.abs(runs[1][1] - 306)).toBeLessThan(5);
  });
});

describe("the Thin r's arm", () => {
  it("leaves the stem as low as Geist's", () => {
    // 160 in, Geist Thin's r's arm runs 456-495; it ran 486-515.
    const [arm] = filled(draw("r", 30).contours, 160, "x").slice(-1);
    expect(Math.abs(arm[0] - 456)).toBeLessThan(8);
    expect(Math.abs(arm[1] - 495)).toBeLessThan(8);
  });
});

describe("the n's shoulder", () => {
  it("leaves the stem in a notch, as Geist's does", () => {
    // 180 in, just clear of Geist Regular's stem, its arch runs 397-476; on
    // the plain arch, springing from the stem's middle, it ran 412-521.
    for (const name of ["n", "h", "m"]) {
      const [arch] = filled(draw(name, 87).contours, 180, "x").slice(-1);
      expect(Math.abs(arch[1] - 476), name).toBeLessThan(10);
    }
  });
});

describe("the u's trough", () => {
  it("rises into the stem in a notch, as Geist's does", () => {
    // 40 up, Geist Regular's u has white between its trough and its stem
    // (386 to 415); the plain trough ran solid into the stem.
    const runs = filled(draw("u", 87).contours, 40);
    expect(runs.length).toBe(2);
    expect(Math.abs(runs[0][1] - 386)).toBeLessThan(8);
  });
});

describe("the b's bowl", () => {
  it("meets the stem in notches, as Geist's does", () => {
    // 180 in, Geist Regular's b's bowl runs 50-167 and 364-478 either side
    // of its counter; as one ring on the pen it ran 28-168 and 363-503.
    const runs = filled(draw("b", 87).contours, 180, "x");
    expect(Math.abs(runs[0][0] - 50)).toBeLessThan(6);
    expect(Math.abs(runs[runs.length - 1][1] - 478)).toBeLessThan(6);
  });
});

describe("the Thin's capitals and figures", () => {
  it("stand on Geist Thin's heavier stems", () => {
    // 300 up Geist Thin's H's stem runs 96-128 and 200 up its one's 199-231,
    // where its l's is 30 across; on the lowercase's pen they were 30 too.
    for (const [name, y] of [
      ["H", 300],
      ["one", 200],
    ] as const) {
      const [stem] = filled(draw(name, 30).contours, y);
      expect(Math.abs(stem[1] - stem[0] - 32), name).toBeLessThan(1);
    }
  });
});

describe("the Thin H's bar", () => {
  it("stands where Geist Thin's does", () => {
    // 330 in Geist Thin's H's bar runs 349-379; it ran 342-373.
    const [bar] = filled(draw("H", 30).contours, 330, "x");
    expect(Math.abs(bar[0] - 349)).toBeLessThan(3);
  });
});

describe("the Thin s's foot", () => {
  it("is cut as low as Geist Thin's", () => {
    // 160 up Geist Thin's s has ink only on the right, its foot cut under
    // it; cut at 175 the Sans's reached 160 on the left too.
    expect(filled(draw("s", 30).contours, 160)).toHaveLength(1);
  });
});

describe("the g's bowl", () => {
  it("meets the stem in a notch, as Geist's does", () => {
    // 480 up Geist Regular's g has white between its bowl and its stem
    // (414 to 434); as one ring on the pen the bowl ran solid into it.
    const runs = filled(draw("g", 87).contours, 480);
    expect(runs.length).toBe(2);
    expect(Math.abs(runs[0][1] - 414)).toBeLessThan(8);
  });
});

describe("the heavy t's and f's left sides", () => {
  it("close as Geist's do at the Black", () => {
    // Geist Black's t sets its ink 31 in from its left and its f 36; closed
    // at the n's rate they stood 8 and 7 further in.
    for (const [name, from] of [
      ["t", 31],
      ["f", 36],
    ] as const) {
      expect(Math.abs(box(name, 194).xMin - from), name).toBeLessThan(3);
    }
  });
});
