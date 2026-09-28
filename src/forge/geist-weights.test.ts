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
import { contourArea, contourContainsPoint, contoursBounds, inkRunsAt } from "@/font/geometry";
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
    // Geist Black's a: 582 of ink, 9 to spare on the right; the Regular's 19.
    const black = draw("a", 172);
    const box = contoursBounds(black.contours);
    expect(box.xMax - box.xMin).toBeCloseTo(582, -1.5);
    expect(black.advanceWidth - box.xMax).toBeLessThan(25);
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
    // Geist's e is upright on the right from its bar up into the bowl: the
    // bar's end neither stands out past the bowl nor is stepped under it.
    for (const weight of [30, 87, 172, 260]) {
      const { contours } = draw("e", weight);
      const right = contoursBounds(contours).xMax;
      let top = 250;
      while (filled(contours, top).length < 2 && top < 450) top += 1;
      const above = filled(contours, top + 40);
      expect(right - above[above.length - 1][1], `e at ${weight}`).toBeLessThan(6);
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
    expect(Math.abs(draw("percent", 172).advanceWidth - 864)).toBeLessThan(30);
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
