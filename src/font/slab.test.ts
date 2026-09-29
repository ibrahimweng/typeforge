import { describe, expect, it } from "vitest";

import { contoursBounds } from "./geometry";
import { blankGlyph } from "./library";
import { addSlabs, findTerminals, weighSlabs } from "./slab";
import { resolveAdvanceWidth, resolveGlyphContours } from "./transform";
import { type Contour, DEFAULT_PARAMS, emptyTypeface, type GlyphParams, type Vec2 } from "./types";

/** Wound clockwise, as a filled outer contour is in a font. */
function polygon(points: Vec2[]): Contour {
  return {
    closed: true,
    nodes: points.map((point) => ({ point, handleIn: null, handleOut: null, type: "corner" })),
  };
}

/** An upright stem: up the left side, across the top, down the right. */
function stem(x: number, y: number, width: number, height: number): Contour {
  return polygon([
    { x, y },
    { x, y: y + height },
    { x: x + width, y: y + height },
    { x: x + width, y },
  ]);
}

const WIDE = 10_000;

describe("findTerminals", () => {
  it("finds both ends of a stem", () => {
    const terminals = findTerminals([stem(100, 0, 200, 1000)], WIDE);
    expect(terminals).toHaveLength(2);
    const heights = terminals
      .map((terminal) => Math.round(terminal.centre.y))
      .sort((a, b) => a - b);
    expect(heights).toEqual([0, 1000]);
  });

  it("measures the end across the stroke", () => {
    const [terminal] = findTerminals([stem(100, 0, 200, 1000)], WIDE);
    expect(terminal.width).toBeCloseTo(200, 6);
  });

  it("points back into the stroke rather than out of it", () => {
    const terminals = findTerminals([stem(100, 0, 200, 1000)], WIDE);
    const foot = terminals.find((terminal) => terminal.centre.y === 0)!;
    const top = terminals.find((terminal) => terminal.centre.y === 1000)!;
    expect(foot.inward.y).toBeCloseTo(1, 6);
    expect(top.inward.y).toBeCloseTo(-1, 6);
  });

  /**
   * The distinction that makes this reliable on real letters.
   *
   * The tall inner edge of an E, between the top arm and the middle one, has
   * perpendicular neighbours pointing opposite ways exactly as a stroke end
   * does. It is told apart by which way the outline turns: a terminal bulges
   * away from the letter, a notch cuts into it. On DejaVu's E this is the
   * difference between finding three arm ends and finding four.
   */
  it("ignores a notch cut into the letter", () => {
    // A C-shape: two arms with a deep notch between them.
    const cShape = polygon([
      { x: 0, y: 0 },
      { x: 0, y: 900 },
      { x: 700, y: 900 },
      { x: 700, y: 700 },
      { x: 200, y: 700 }, // inner corner
      { x: 200, y: 200 }, // the notch edge runs down here
      { x: 700, y: 200 },
      { x: 700, y: 0 },
    ]);
    const terminals = findTerminals([cShape], WIDE);
    const widths = terminals.map((terminal) => Math.round(terminal.width));
    // The two arm ends are 200 deep; the 500-unit notch edge is not an end.
    expect(widths).not.toContain(500);
    expect(terminals.length).toBeGreaterThan(0);
  });

  it("leaves a round letter alone, having no flat end to sit on", () => {
    const k = 0.5522847498 * 400;
    const circle: Contour = {
      closed: true,
      nodes: [
        {
          point: { x: 100, y: 500 },
          handleIn: { x: 100, y: 500 - k },
          handleOut: { x: 100, y: 500 + k },
          type: "smooth",
        },
        {
          point: { x: 500, y: 900 },
          handleIn: { x: 500 - k, y: 900 },
          handleOut: { x: 500 + k, y: 900 },
          type: "smooth",
        },
        {
          point: { x: 900, y: 500 },
          handleIn: { x: 900, y: 500 + k },
          handleOut: { x: 900, y: 500 - k },
          type: "smooth",
        },
        {
          point: { x: 500, y: 100 },
          handleIn: { x: 500 + k, y: 100 },
          handleOut: { x: 500 - k, y: 100 },
          type: "smooth",
        },
      ],
    };
    expect(findTerminals([circle], WIDE)).toHaveLength(0);
  });

  it("treats a horizontal bar as a stroke with two ends, not four", () => {
    // A bar lying on its side is still a stroke: its ends are the short edges
    // at either end, which is what gets slabbed on the arm of an E or a T.
    const terminals = findTerminals([stem(0, 0, 1000, 200)], 10_000);
    expect(terminals).toHaveLength(2);
    for (const terminal of terminals) expect(terminal.width).toBeCloseTo(200, 6);
    const xs = terminals.map((terminal) => Math.round(terminal.centre.x)).sort((a, b) => a - b);
    expect(xs).toEqual([0, 1000]);
  });

  it("respects the backstop on how wide an end may be", () => {
    // The ends are 200 across, so a cap below that rules them out.
    expect(findTerminals([stem(0, 0, 1000, 200)], 100)).toHaveLength(0);
  });
});

describe("addSlabs", () => {
  it("puts a bar on each end of a stem", () => {
    const result = addSlabs([stem(100, 0, 200, 1000)], {
      projection: 60,
      thickness: 40,
      maxWidth: WIDE,
    });
    // The stem, plus a slab at each end.
    expect(result).toHaveLength(3);
  });

  it("reaches past the stroke on both sides", () => {
    const result = addSlabs([stem(100, 0, 200, 1000)], {
      projection: 60,
      thickness: 40,
      maxWidth: WIDE,
    });
    const bounds = contoursBounds(result);
    expect(bounds.xMin).toBeCloseTo(40, 6);
    expect(bounds.xMax).toBeCloseTo(360, 6);
  });

  /**
   * The slab sits flush with the end of the stroke and reaches back into it,
   * so adding serifs does not make the letters taller than the font says they
   * are.
   */
  it("does not make the letter any taller", () => {
    const bare = contoursBounds([stem(100, 0, 200, 1000)]);
    const slabbed = contoursBounds(
      addSlabs([stem(100, 0, 200, 1000)], { projection: 60, thickness: 40, maxWidth: WIDE }),
    );
    expect(slabbed.yMin).toBeCloseTo(bare.yMin, 6);
    expect(slabbed.yMax).toBeCloseTo(bare.yMax, 6);
  });

  it("lays the bar over the stroke rather than merging into it", () => {
    const original = stem(100, 0, 200, 1000);
    const result = addSlabs([original], { projection: 60, thickness: 40, maxWidth: WIDE });
    // The stroke is handed back untouched; the bars are extra.
    expect(result[0]).toBe(original);
  });

  it("has nothing to add when the size is zero", () => {
    const contours = [stem(100, 0, 200, 1000)];
    expect(addSlabs(contours, { projection: 0, thickness: 0, maxWidth: WIDE })).toBe(contours);
  });

  it("has nothing to add to a letter with no flat stroke ends", () => {
    const contours: Contour[] = [];
    expect(addSlabs(contours, { projection: 60, thickness: 40, maxWidth: WIDE })).toBe(contours);
  });
});

describe("what is not a stroke end", () => {
  /**
   * Regression: slabs stood up inside Geist's B, b and 4.
   *
   * The convexity test reads the turn against the contour's own winding, and a
   * counter is wound against the letter, so the flat inside edges of a hole
   * read as stroke ends -- the back of B's bowl was one 232 units across, and
   * a bar was laid across the middle of the letter. A stroke never ends on the
   * edge of a hole.
   */
  it("finds no ends on the edge of a counter", () => {
    // A ring whose hole is as wide as its walls, so nothing but being a hole
    // tells its edges from the end of a stroke. The outside edges are ruled
    // out by the width backstop.
    const ring = [stem(0, 0, 600, 600), stem(200, 200, 200, 200)];
    expect(findTerminals(ring, 300)).toHaveLength(0);
  });

  /**
   * Regression: a second serif piled on the first.
   *
   * On Lora nearly every flat end the shape test found was the tip of a serif
   * or of a beak -- short, square, flanked by parallel sides, and less than
   * half a stem across. Each got a slab, crosswise, on top of the serif that
   * was already there: the crosses along the arms of E and the doubled feet.
   */
  it("leaves the tips of an existing serif alone", () => {
    // An I with slab serifs already on it: a 200-wide stem, and serifs 360
    // wide and 60 thick at head and foot.
    const serifed = polygon([
      { x: 20, y: 0 },
      { x: 20, y: 60 },
      { x: 100, y: 60 },
      { x: 100, y: 940 },
      { x: 20, y: 940 },
      { x: 20, y: 1000 },
      { x: 380, y: 1000 },
      { x: 380, y: 940 },
      { x: 300, y: 940 },
      { x: 300, y: 60 },
      { x: 380, y: 60 },
      { x: 380, y: 0 },
    ]);
    expect(findTerminals([serifed], WIDE)).toHaveLength(0);
    const contours = [serifed];
    expect(addSlabs(contours, { projection: 60, thickness: 33, maxWidth: WIDE })).toBe(contours);
  });
});

describe("slabs on arms", () => {
  /** An E: a stem with three arms, all 200 thick, drawn as one outline. */
  const e = polygon([
    { x: 0, y: 0 },
    { x: 0, y: 1000 },
    { x: 700, y: 1000 },
    { x: 700, y: 800 },
    { x: 200, y: 800 },
    { x: 200, y: 600 },
    { x: 600, y: 600 },
    { x: 600, y: 400 },
    { x: 200, y: 400 },
    { x: 200, y: 200 },
    { x: 700, y: 200 },
    { x: 700, y: 0 },
  ]);
  const options = { projection: 60, thickness: 33, maxWidth: WIDE };

  /**
   * Regression: posts through the ends of Geist's E.
   *
   * An arm's end was given the same bar as a stem's, reaching across the
   * stroke both ways -- which on an arm is up and down, so the top arm grew a
   * post above the cap height and the bottom one below the baseline. A slab
   * serif's E has beaks: hanging into the letter from the top arm, standing up
   * from the bottom one, flush with the outside.
   */
  it("gives the top and bottom arms a beak into the letter", () => {
    const result = addSlabs([e], options);
    const bounds = contoursBounds(result);
    expect(bounds.yMin).toBeCloseTo(0, 6);
    expect(bounds.yMax).toBeCloseTo(1000, 6);
    const beaks = result.slice(1).map((slab) => contoursBounds([slab]));
    expect(beaks).toHaveLength(2);
    const top = beaks.find((beak) => beak.yMax > 900)!;
    const bottom = beaks.find((beak) => beak.yMin < 100)!;
    // Down from the top arm and up from the bottom one, by the projection.
    expect(top.yMin).toBeCloseTo(800 - 60, 6);
    expect(bottom.yMax).toBeCloseTo(200 + 60, 6);
  });

  it("gives the middle arm nothing, having no outside to be flush with", () => {
    const result = addSlabs([e], options);
    for (const slab of result.slice(1)) {
      const box = contoursBounds([slab]);
      expect(box.yMax <= 400 || box.yMin >= 600).toBe(true);
    }
  });

  /**
   * Regression: a slab reaching into the next stroke.
   *
   * The foot of Geist's k stands right beside the foot of its leg, and the slab
   * ran across the white between them into the leg. A slab now takes at most
   * a share of the white beside it, so two feet close together keep a gap.
   */
  it("stops short of a stroke close beside it", () => {
    const left = stem(0, 0, 200, 1000);
    const right = stem(260, 0, 200, 1000);
    const result = addSlabs([left, right], options);
    const slabs = result.slice(2).map((slab) => contoursBounds([slab]));
    expect(slabs).toHaveLength(4);
    const fromLeft = slabs.filter((box) => box.xMin < 100);
    const fromRight = slabs.filter((box) => box.xMin >= 100);
    for (const box of fromLeft) expect(box.xMax).toBeLessThan(260);
    for (const box of fromRight) expect(box.xMin).toBeGreaterThan(200);
    // And still the full projection on the open side.
    for (const box of fromLeft) expect(box.xMin).toBeCloseTo(-60, 6);
  });
});

describe("which ends a slab serif gives a slab", () => {
  it("leaves the tips of a serif alone even when they are nearly a stem thick", () => {
    // Lora's M: its serif tips measure well over half its thin stems, so the
    // thinness test alone let them through, and a slab stood beside each tip
    // as a hollow bracket. A serif tip has the stem it carries right behind it.
    const serifed = polygon([
      { x: 0, y: 0 },
      { x: 0, y: 70 },
      { x: 100, y: 70 },
      { x: 100, y: 930 },
      { x: 0, y: 930 },
      { x: 0, y: 1000 },
      { x: 300, y: 1000 },
      { x: 300, y: 930 },
      { x: 200, y: 930 },
      { x: 200, y: 70 },
      { x: 300, y: 70 },
      { x: 300, y: 0 },
    ]);
    expect(findTerminals([serifed], WIDE)).toHaveLength(0);
  });

  it("judges an end against the typeface's stems, not only the letter's own", () => {
    // Lora's S is all curve and rules thinner than its stems, so the tips of
    // its beaks passed for stroke ends and each got a slab on its beak.
    const thin = stem(100, 0, 55, 700);
    expect(findTerminals([thin], WIDE)).toHaveLength(2);
    expect(findTerminals([thin], WIDE, 87)).toHaveLength(0);
  });

  it("leaves a beak alone that flares from a thinner arm", () => {
    // The top arm of Lora's 5: a hairline ending in a beak nearly twice as
    // tall, and a bar stood up on the edge down the beak.
    const arm = polygon([
      { x: 100, y: 650 },
      { x: 100, y: 700 },
      { x: 430, y: 700 },
      { x: 430, y: 740 },
      { x: 460, y: 740 },
      { x: 460, y: 650 },
    ]);
    const letter = [stem(0, 0, 90, 600), arm];
    const ends = findTerminals(letter, WIDE, 90);
    expect(ends.map((end) => Math.round(end.centre.x))).toEqual([45, 45]);
  });

  /*
   * Regression: the spur of Geist's G stands on the bottom of its bowl, and
   * the foot laid across it reached out over the bowl on that side and
   * jutted out of it.
   */
  it("reaches out only on the side of a stroke end that is not joined to ink", () => {
    const spur = stem(300, 0, 100, 400);
    const bowl = stem(0, 0, 300, 100);
    const slabs = addSlabs([spur, bowl], { projection: 80, thickness: 60, maxWidth: WIDE }).slice(
      2,
    );
    const foot = slabs
      .map((slab) => contoursBounds([slab]))
      .find((box) => box.yMin < 1 && box.xMin > 200)!;
    expect(foot.xMin).toBeCloseTo(300, 0);
    expect(foot.xMax).toBeCloseTo(480, 0);
  });

  it("puts no slab on a slanted end", () => {
    // The tail of Geist's & ends on a cut a few degrees off level, and a slab
    // laid along it stuck out like a stick.
    const turn = (8 * Math.PI) / 180;
    const at = (x: number, y: number) => ({
      x: x * Math.cos(turn) - y * Math.sin(turn),
      y: x * Math.sin(turn) + y * Math.cos(turn),
    });
    const tilted = polygon([at(0, 0), at(100, 0), at(100, 1000), at(0, 1000)]);
    expect(findTerminals([tilted], WIDE)).toHaveLength(0);
  });

  it("gives a diagonal cut off level a slab, square to the letter", () => {
    // The arm and leg of a k, the feet of an A, the tops of v and y.
    const diagonal = polygon([
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 420, y: 700 },
      { x: 300, y: 700 },
    ]);
    const terminals = findTerminals([diagonal], WIDE);
    expect(terminals).toHaveLength(2);
    for (const terminal of terminals) {
      expect(Math.abs(terminal.inward.x)).toBeLessThan(1e-9);
      expect(Math.abs(terminal.inward.y)).toBeCloseTo(1, 9);
    }
  });
});

describe("weighing slabs", () => {
  /*
   * A slab end flush with the letter's own edge finishes where the weight
   * left that edge; made lighter, still no shorter than any slab is kept.
   * Without the floor, a slab as wide as a thin stem went to a sliver.
   */
  it("keeps a flush slab end no shorter than a lighter slab is kept", () => {
    const letter = [stem(0, 0, 100, 700)];
    const slab = stem(0, 0, 100, 60);
    const lighter = [stem(40, 0, 20, 700)];
    const [weighed] = weighSlabs([slab], letter, -40, 1000, lighter);
    const box = contoursBounds([weighed]);
    expect(box.xMax - box.xMin).toBeGreaterThanOrEqual(100 / 3 - 0.5);
  });
});

describe("slabs on a letter, with the other controls", () => {
  /*
   * An I and a V-like letter for the stem to be measured from: the I is a
   * hundred wide, a hundred units in from its sides, and the diagonal is a
   * leg cut off level at the baseline.
   */
  function letter(contours: Contour[], advance = 300, name = "x", code = 120) {
    const typeface = emptyTypeface();
    const I = { ...blankGlyph("I", [73]), contours: [stem(100, 0, 100, 700)], params: {} };
    const glyph = { ...blankGlyph(name, [code]), advanceWidth: advance, contours, params: {} };
    typeface.glyphs = [I, glyph];
    typeface.glyphIndex = new Map([
      ["I", 0],
      ["x", 1],
    ]);
    return { typeface, glyph };
  }
  const at = (
    { typeface, glyph }: ReturnType<typeof letter>,
    params: Partial<GlyphParams>,
  ): { contours: Contour[]; advance: number } => {
    typeface.params = { ...DEFAULT_PARAMS, ...params };
    return {
      contours: resolveGlyphContours(glyph, typeface),
      advance: resolveAdvanceWidth(glyph, typeface),
    };
  };

  it("makes room for the slabs beside the letter rather than taking its side bearings", () => {
    const one = letter([stem(100, 0, 100, 700)]);
    const { contours, advance } = at(one, { slab: 80 });
    const box = contoursBounds(contours);
    // Past the stem by the slab on each side, and still a hundred in from
    // either side of the advance.
    expect(box.xMax - box.xMin).toBeGreaterThan(200);
    expect(box.xMin).toBeCloseTo(100, 0);
    expect(advance - box.xMax).toBeCloseTo(100, 0);
  });

  it("thins a slab on a diagonal with the letter, as it thins one on a stem", () => {
    // A leg leaning right, cut off level top and bottom.
    const leg = polygon([
      { x: 100, y: 0 },
      { x: 400, y: 700 },
      { x: 500, y: 700 },
      { x: 200, y: 0 },
    ]);
    const straight = at(letter([stem(100, 0, 100, 700)], 600), { slab: 60, weight: -40 });
    const slanted = at(letter([leg], 600), { slab: 60, weight: -40 });
    // The last contours are the slabs; each is its own rectangle.
    const thick = (contours: Contour[]) => {
      const box = contoursBounds([contours[contours.length - 1]]);
      return box.yMax - box.yMin;
    };
    expect(thick(slanted.contours)).toBeLessThan(thick(straight.contours) * 1.2);
    expect(thick(straight.contours)).toBeLessThan(40);
  });

  it("makes one slab of two that would end a crack apart", () => {
    // Two stems forty apart: each slab takes its share of the gap and would
    // leave a crack between them.
    const one = letter([stem(100, 0, 100, 700), stem(240, 0, 100, 700)], 500);
    const { contours } = at(one, { slab: 60 });
    const slabs = contours.slice(2).filter((contour) => contoursBounds([contour]).yMin < 1);
    expect(slabs).toHaveLength(2);
    const [left, right] = slabs
      .map((contour) => contoursBounds([contour]))
      .sort((a, b) => a.xMin - b.xMin);
    expect(right.xMin).toBeLessThanOrEqual(left.xMax);
  });

  /*
   * Regression: a slab kept off another piece is weighed lighter, and once
   * one was, every slab was weighed on its own, and two that end a crack
   * apart were no longer made one.
   */
  it("still makes one slab of two when one of them is weighed lighter", () => {
    // The two stems, and a square standing just past the right one's slab.
    const one = letter([stem(100, 0, 100, 700), stem(240, 0, 100, 700), stem(405, 0, 60, 60)], 600);
    const feet = (contours: Contour[]) =>
      contours
        .slice(3)
        .map((contour) => contoursBounds([contour]))
        .filter((box) => box.yMin < 1)
        .sort((a, b) => a.xMin - b.xMin);
    const rest = at(one, { slab: 60 }).contours;
    const { contours } = at(one, { slab: 60, weight: 10 });
    expect(contours).toHaveLength(rest.length);
    const [left, right] = feet(contours);
    const square = contoursBounds([contours[2]]);
    const drawnGap = contoursBounds([rest[2]]).xMin - feet(rest)[1].xMax;
    // The right foot gave up weight for the square...
    expect(square.xMin - right.xMax).toBeGreaterThan(drawnGap / 2 - 0.5);
    // ...and the two feet are still one.
    expect(right.xMin).toBeLessThanOrEqual(left.xMax);
  });

  it("puts no slab on a dot, nor on punctuation", () => {
    // An i: a stem and a square dot as wide as it.
    const i = letter([stem(100, 0, 100, 500), stem(100, 600, 100, 100)], 300, "i", 105);
    const { contours } = at(i, { slab: 60 });
    // Two slabs at most -- on the stem -- and none reaching the dot.
    const slabs = contours.slice(2);
    expect(slabs.length).toBeGreaterThan(0);
    for (const slab of slabs) expect(contoursBounds([slab]).yMax).toBeLessThanOrEqual(501);
    // An ! is a stroke and a dot; a slab serif gives it no slabs.
    const bang = letter([stem(100, 200, 100, 500), stem(100, 0, 100, 100)], 300, "exclam", 33);
    expect(at(bang, { slab: 60 }).contours).toHaveLength(2);
  });

  it("gives the top of a lowercase stem a flag to the left, and a capital a bar", () => {
    const top = (contours: Contour[]) =>
      contours
        .slice(1)
        .map((contour) => contoursBounds([contour]))
        .find((box) => box.yMax > 699)!;
    const l = at(letter([stem(100, 0, 100, 700)], 300, "l", 108), { slab: 60 });
    const I = at(letter([stem(100, 0, 100, 700)], 300, "I", 73), { slab: 60 });
    const stemOf = (contours: Contour[]) => contoursBounds([contours[0]]);
    // The l's flag reaches left of its stem and not right of it...
    expect(top(l.contours).xMin).toBeLessThan(stemOf(l.contours).xMin - 10);
    expect(top(l.contours).xMax).toBeCloseTo(stemOf(l.contours).xMax, 0);
    // ...and the I's bar reaches both ways.
    expect(top(I.contours).xMax).toBeGreaterThan(stemOf(I.contours).xMax + 10);
  });

  /*
   * Regression: the flag on the i and j of Geist, reaching out to the left
   * of the stem, was read at its middle, beside the stem, as standing on
   * nothing. At the heaviest weight it grew the whole weight up past the
   * top of the stem and met the dot.
   */
  it("keeps the flag on a dotted stem level with the stem, clear of the dot", () => {
    const i = letter([stem(80, 0, 84, 530), stem(78, 613, 88, 98)], 244, "i", 0x69);
    const heavy = at(i, { weight: 60 }).contours;
    const slabbed = at(i, { weight: 60, slab: 100 }).contours;
    const dot = (contours: Contour[]) => contoursBounds([contours[1]]).yMin;
    const flag = slabbed.slice(2).find((slab) => contoursBounds([slab]).yMin > 100)!;
    expect(contoursBounds([flag]).yMax).toBeCloseTo(contoursBounds([slabbed[0]]).yMax, 0);
    expect(dot(slabbed) - contoursBounds([flag]).yMax).toBeCloseTo(
      dot(heavy) - contoursBounds([heavy[0]]).yMax,
      0,
    );
  });

  /*
   * Regression: the beak on the end of the sample font's f hangs from the
   * hook level with its underside. Made heavier, the underside grew less
   * than the weight, for the white under it, and the beak grown the whole
   * weight hung below it, nearly closing on the crossbar.
   */
  it("ends a beak level with the underside of the arm it hangs from", () => {
    // A stem with an arm off its top to the right, and a bar as long close
    // under it: the weight leaves the beak no room to reach down.
    const f = letter(
      [
        polygon([
          { x: 100, y: 0 },
          { x: 100, y: 1000 },
          { x: 500, y: 1000 },
          { x: 500, y: 900 },
          { x: 200, y: 900 },
          { x: 200, y: 800 },
          { x: 500, y: 800 },
          { x: 500, y: 700 },
          { x: 200, y: 700 },
          { x: 200, y: 0 },
        ]),
      ],
      600,
      "F",
      0x46,
    );
    const { contours } = at(f, { weight: 40, slab: 100 });
    const arm = contours[0].nodes
      .map((node) => node.point)
      .filter((point) => point.x > 300 && point.y > 800);
    const underside = Math.min(...arm.map((point) => point.y));
    const beak = contours
      .slice(1)
      .map((slab) => contoursBounds([slab]))
      .find((box) => box.yMin > 800 && box.xMax > 400)!;
    expect(beak.yMin).toBeCloseTo(underside, 0);
  });

  it("leaves the top of a t plain, a stub on its crossbar", () => {
    // A stem a hundred wide rising a stem's width and a half past its bar.
    const t = letter(
      [
        polygon([
          { x: 100, y: 0 },
          { x: 100, y: 400 },
          { x: 0, y: 400 },
          { x: 0, y: 500 },
          { x: 100, y: 500 },
          { x: 100, y: 650 },
          { x: 200, y: 650 },
          { x: 200, y: 500 },
          { x: 300, y: 500 },
          { x: 300, y: 400 },
          { x: 200, y: 400 },
          { x: 200, y: 0 },
        ]),
      ],
      400,
      "t",
      116,
    );
    const { contours } = at(t, { slab: 60 });
    const tops = contours.slice(1).filter((contour) => contoursBounds([contour]).yMax > 600);
    expect(tops).toHaveLength(0);
  });
});
