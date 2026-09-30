import { beforeAll, describe, expect, it } from "vitest";

import {
  coverOf,
  filled,
  intersect,
  linesUnlike,
  pieces,
  ready,
  subtract,
  unite,
  withoutStutter,
} from "./boolean";
import { contourArea, contoursBounds } from "./geometry";
import type { Contour } from "./types";

const rect = (x: number, y: number, w: number, h: number): Contour => ({
  closed: true,
  nodes: [
    { point: { x, y }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x: x + w, y }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x: x + w, y: y + h }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x, y: y + h }, handleIn: null, handleOut: null, type: "corner" },
  ],
});

/** Ink, counting a hole as the ink it takes away. */
const ink = (contours: Contour[]): number =>
  contours.reduce((total, contour) => total + contourArea(contour), 0);

beforeAll(async () => {
  await ready();
});

/*
 * A shape that crosses itself is not one shape, and unite says so.
 *
 * The sweep makes them: a stroke whose spine runs back over ink it has already
 * laid comes out as a single outline with a fold in it, and the traced `e` --
 * bowl and crossbar in one stroke -- is the letter that does it. Filled
 * non-zero such an outline draws correctly, which is why it went unnoticed;
 * but it has no counter as far as anything reading an outline is concerned,
 * and handed to a second boolean it answers nonsense.
 */
describe("unite, given one shape that crosses itself", () => {
  /*
   * The outline of a band forty wide whose centre-line goes round a square and
   * then carries on past where it started -- written the way a sweep writes
   * one, down the left side and back up the right, so the fold is the real
   * thing and not two lines drawn to cross. It encloses a hundred and sixty
   * square, which is the counter that used to go missing.
   */
  const lapped: Contour = {
    closed: true,
    nodes: [
      // Down the left of the travel, from the start round to the far end.
      { x: 0, y: 20 },
      { x: 180, y: 20 },
      { x: 180, y: 180 },
      { x: 20, y: 180 },
      { x: 20, y: -60 },
      // Across the end, and back up the right of the travel.
      { x: -20, y: -60 },
      { x: -20, y: 220 },
      { x: 220, y: 220 },
      { x: 220, y: -20 },
      { x: 0, y: -20 },
    ].map((point) => ({ point, handleIn: null, handleOut: null, type: "corner" as const })),
  };

  it("resolves the fold into a shape with its counter", () => {
    const one = unite([lapped]);
    const holes = one.filter((contour) => contourArea(contour) < 0);
    expect(holes.length).toBe(1);
    expect(Math.abs(contourArea(holes[0]))).toBeCloseTo(160 * 160, 3);
    expect(pieces(one)).toBe(1);
  });

  /*
   * And the ink is the ink, which the fold's own arithmetic gets wrong.
   *
   * Where the band laps itself -- twenty by forty, at the corner it came back
   * to -- a self-crossing outline counts the same ground twice, so its signed
   * area reads eight hundred more than the shape covers. That is what made a
   * traced `e` report a hundred per cent of its letter's ink while missing a
   * corner of it.
   */
  it("and comes to the ink it covers, not the ink it counts twice", () => {
    expect(Math.abs(contourArea(lapped))).toBeCloseTo(34400, 3);
    expect(Math.abs(ink(unite([lapped])))).toBeCloseTo(34400 - 20 * 40, 3);
  });

  it("leaves a shape that does not cross itself exactly as it was", () => {
    const plain = rect(0, 0, 100, 100);
    expect(unite([plain])).toEqual([plain]);
  });
});

describe("subtract", () => {
  it("cuts a hole through the middle", () => {
    const cut = subtract([rect(0, 0, 100, 100)], [rect(40, 40, 20, 20)]);
    expect(cut.length).toBe(2);
    expect(Math.abs(ink(cut))).toBeCloseTo(100 * 100 - 20 * 20, 3);
    // One piece, with a hole in it rather than a second piece.
    expect(pieces(cut)).toBe(1);
  });

  it("cuts a letter in two when the slot goes all the way through", () => {
    // A band the full width of the shape, which is what a slot cut too wide is.
    const cut = subtract([rect(0, 0, 100, 100)], [rect(-10, 45, 120, 10)]);
    expect(pieces(cut)).toBe(2);
    expect(Math.abs(ink(cut))).toBeCloseTo(100 * 90, 3);
  });

  it("takes the whole shape when the tool covers it", () => {
    expect(subtract([rect(0, 0, 100, 100)], [rect(-10, -10, 120, 120)])).toEqual([]);
  });

  it("leaves a shape alone when the tool misses it", () => {
    const cut = subtract([rect(0, 0, 100, 100)], [rect(500, 500, 20, 20)]);
    expect(Math.abs(ink(cut))).toBeCloseTo(100 * 100, 3);
    const bounds = contoursBounds(cut);
    expect(bounds.xMax).toBeCloseTo(100, 3);
  });

  it("cuts every piece of a tool made of several", () => {
    // A comb: three teeth into the same edge.
    const teeth = [rect(-5, 10, 20, 10), rect(-5, 40, 20, 10), rect(-5, 70, 20, 10)];
    const cut = subtract([rect(0, 0, 100, 100)], teeth);
    expect(Math.abs(ink(cut))).toBeCloseTo(100 * 100 - 3 * (15 * 10), 3);
  });

  it("takes the same ink away whether the shape was fused first or not", () => {
    // Worth stating, because it is the reason fusing first is not about
    // correctness: subtraction distributes over a union.
    const stem = rect(40, 0, 20, 100);
    const serif = rect(20, 0, 60, 12);
    const slot = rect(30, 4, 40, 4);

    const cut = [...subtract([stem], [slot]), ...subtract([serif], [slot])];
    const apart = unite(cut, "winding");
    const together = subtract(unite([stem, serif], "winding"), [slot]);
    /*
     * To a hundredth of a unit of area rather than to a thousandth, because a
     * union grows every shape it is handed outward by a hair before joining
     * them -- see `nudgeApart` -- so an area comes back bigger by about its own
     * perimeter times that hair. The two sides here are fused a different
     * number of times, so they collect a different number of hairs.
     */
    expect(Math.abs(ink(apart))).toBeCloseTo(Math.abs(ink(together)), 1);
  });
});

describe("intersect", () => {
  it("keeps only what both shapes cover", () => {
    const both = intersect([rect(0, 0, 100, 100)], [rect(50, 50, 100, 100)]);
    expect(Math.abs(ink(both))).toBeCloseTo(50 * 50, 3);
  });

  it("is empty when they do not meet", () => {
    expect(intersect([rect(0, 0, 10, 10)], [rect(90, 90, 10, 10)])).toEqual([]);
  });
});

describe("pieces", () => {
  it("only means anything once the shape has been fused", () => {
    // Why every cut runs on a fused outline. A stem with a serif laid over it
    // is one letter drawn as two overlapping pieces, and counted before they
    // are fused it reads as two -- which would make the check for a letter cut
    // in half report every serifed letter in the font.
    const overlapping = [rect(40, 0, 20, 100), rect(20, 0, 60, 12)];
    expect(pieces(overlapping)).toBe(2);
    expect(pieces(unite(overlapping))).toBe(1);
  });

  it("counts shapes, not contours", () => {
    // A ring is one piece: an outer contour and a hole.
    expect(pieces(subtract([rect(0, 0, 100, 100)], [rect(25, 25, 50, 50)]))).toBe(1);
    expect(pieces([rect(0, 0, 10, 10), rect(50, 50, 10, 10)])).toBe(2);
    expect(pieces([])).toBe(0);
  });

  it("does not count a crumb with no width in it", () => {
    /*
     * A boolean leaves hairs behind. Two edges lying along the same line come
     * back with a loop between them a hundredth of a unit wide, and counted as
     * a piece that is a letter reported broken that is whole -- a Didone W
     * fused to itself and produced one of thirteen square units, which was
     * enough to warn that a cut had severed a letter nobody had cut.
     *
     * A full stop is small too, and is a piece. What separates them is not
     * size but whether there is any room inside: the hair is a hundredth of a
     * unit thick and the full stop is forty.
     */
    // Standing outside the shape, where nesting has to call it a piece or a
    // hole and there is nothing enclosing it to make it a hole.
    const hair = rect(120, 10, 80, 0.01);
    expect(pieces([rect(0, 0, 100, 100), hair])).toBe(1);
    expect(pieces([rect(0, 0, 100, 100), rect(120, 0, 40, 40)])).toBe(2);
  });
});

describe("unite", () => {
  it("is the same fuse the export has always used", () => {
    const merged = unite([rect(0, 0, 100, 100), rect(50, 50, 100, 100)]);
    expect(merged.length).toBe(1);
    expect(Math.abs(contourArea(merged[0]))).toBeCloseTo(17_500, -1);
  });

  it("keeps a piece that sits inside another piece, when told to read the winding", () => {
    // The foot of a stem, inside the serif laid across it. Counted by nesting
    // the foot is enclosed once and reads as a hole, so it is punched out of
    // its own serif and the letter loses ink it was drawn with.
    const foot = rect(40, 2, 20, 8);
    const serif = rect(20, 0, 60, 12);

    // A hundredth of a unit of area, for the hair the union grows each shape by.
    expect(Math.abs(ink(unite([serif, foot])))).toBeCloseTo(60 * 12 - 20 * 8, 1);
    expect(Math.abs(ink(unite([serif, foot], "winding")))).toBeCloseTo(60 * 12, 1);
  });

  it("still keeps a real counter as a hole when reading the winding", () => {
    const ring = rect(0, 0, 100, 100);
    const hole = { ...rect(25, 25, 50, 50), nodes: [...rect(25, 25, 50, 50).nodes].reverse() };
    const merged = unite([ring, hole, rect(90, 40, 40, 20)], "winding");
    const areas = merged.map(contourArea);
    expect(areas.some((area) => area > 0)).toBe(true);
    expect(areas.some((area) => area < 0)).toBe(true);
  });
});

describe("how hard unite works at joining", () => {
  /*
   * Handed several shapes at once the union sometimes gives up, and gives up
   * differently depending on what it was given: sometimes nothing at all comes
   * back, sometimes every shape comes back unjoined. Folded in one at a time
   * it succeeds, because every step is one shape against one shape -- but that
   * is a boolean per shape, and the whole alphabet comes through here on every
   * frame.
   *
   * So who is asking decides how much to pay. The export wants a set that does
   * not overlap and is happy with shapes that abut, because a font file is.
   * The cut layer is about to ask the letter how many pieces it is in and take
   * one of them away, so it needs the letter to arrive as one.
   */
  it("gives a caller that needs one solid one solid", () => {
    /*
     * An E: a stem, three arms, and a serif across the foot and the head. Six
     * shapes that all overlap something, four of them cut level with y=0 --
     * and handed all six at once the union comes back with two of them still
     * apart. It is not that they fail to meet: the foot serif overlaps the
     * stem by most of its own area. Several edges lying along one line is
     * simply a case the library does not survive.
     */
    const serifedE = [
      rect(20, 0, 20, 100),
      rect(0, 0, 60, 10),
      rect(20, 88, 60, 12),
      rect(20, 44, 50, 12),
      rect(20, 0, 60, 12),
      rect(0, 90, 60, 10),
    ];
    /*
     * Both answers, because this E is not merely left unjoined: what comes
     * back has lost most of the ink that went in, and that is caught whoever
     * is asking. It used to be two pieces under `enough` and one under
     * `whole`, and the difference between the two is still what the parameter
     * is for -- it decides how hard to work at a union that came back whole
     * but in several solids, which is the ordinary case and not this one.
     */
    expect(pieces(unite(serifedE, "winding"))).toBe(1);
    expect(pieces(unite(serifedE, "winding", "whole"))).toBe(1);
  });

  it("leaves shapes that really are apart alone, however hard it is asked", () => {
    // Working harder is not licence to invent a join. An i is two pieces under
    // either answer, or every dotted letter in the font would report as one
    // and the check for a severed letter would never fire.
    const dotted = [rect(40, 0, 20, 100), rect(40, 120, 20, 20)];
    expect(pieces(unite(dotted, "winding", "whole"))).toBe(2);
    expect(pieces(unite(dotted, "winding"))).toBe(2);
  });
});

const corner = (x: number, y: number) => ({
  point: { x, y },
  handleIn: null,
  handleOut: null,
  type: "corner" as const,
});

/** A circle of four quarter arcs, anticlockwise unless turned. */
const circle = (cx: number, cy: number, r: number, clockwise = false): Contour => {
  const k = r * 0.5522847498;
  const nodes = [
    {
      point: { x: cx + r, y: cy },
      handleIn: { x: cx + r, y: cy - k },
      handleOut: { x: cx + r, y: cy + k },
    },
    {
      point: { x: cx, y: cy + r },
      handleIn: { x: cx + k, y: cy + r },
      handleOut: { x: cx - k, y: cy + r },
    },
    {
      point: { x: cx - r, y: cy },
      handleIn: { x: cx - r, y: cy + k },
      handleOut: { x: cx - r, y: cy - k },
    },
    {
      point: { x: cx, y: cy - r },
      handleIn: { x: cx - k, y: cy - r },
      handleOut: { x: cx + k, y: cy - r },
    },
  ].map((node) => ({ ...node, type: "smooth" as const }));
  if (!clockwise) return { closed: true, nodes };
  return {
    closed: true,
    nodes: [...nodes]
      .reverse()
      .map((node) => ({ ...node, handleIn: node.handleOut, handleOut: node.handleIn })),
  };
};

/** The same contours made bigger, as the same drawing on a bigger em. */
const scaled = (contours: Contour[], by: number): Contour[] =>
  contours.map((contour) => ({
    ...contour,
    nodes: contour.nodes.map((node) => ({
      ...node,
      point: { x: node.point.x * by, y: node.point.y * by },
      handleIn: node.handleIn && { x: node.handleIn.x * by, y: node.handleIn.y * by },
      handleOut: node.handleOut && { x: node.handleOut.x * by, y: node.handleOut.y * by },
    })),
  }));

/*
 * The folds a boolean leaves where it hesitated, taken out -- all of them,
 * however many there are, and not just as many as there were passes left once
 * each pass had shortened the outline by one.
 */
describe("withoutStutter", () => {
  it("hands back an outline with nothing to take out as it was", () => {
    const square = rect(0, 0, 100, 100);
    expect(withoutStutter(square)).toBe(square);
  });

  it("merges every run of nodes in one place, however long the runs", () => {
    // Every corner of a square three times over: eight nodes too many.
    const tripled: Contour = {
      closed: true,
      nodes: rect(0, 0, 100, 100).nodes.flatMap((node) => [node, node, node]),
    };
    const clean = withoutStutter(tripled);
    expect(clean?.nodes.map((node) => node.point)).toEqual(
      rect(0, 0, 100, 100).nodes.map((node) => node.point),
    );
  });

  it("takes out every spike along an edge, and the steps each one leaves", () => {
    // A square whose bottom edge runs out and back along ten spikes. Each is
    // two nodes too many: the tip, and the node it comes back to.
    const spikes = Array.from({ length: 10 }, (_, at) => 50 * (at + 1));
    const combed: Contour = {
      closed: true,
      nodes: [
        corner(0, 0),
        ...spikes.flatMap((x) => [corner(x, 0), corner(x, -50), corner(x, 0)]),
        corner(600, 0),
        corner(600, 600),
        corner(0, 600),
      ],
    };
    const clean = withoutStutter(combed);
    expect(clean?.nodes.map((node) => node.point)).toEqual([
      { x: 0, y: 0 },
      ...spikes.map((x) => ({ x, y: 0 })),
      { x: 600, y: 0 },
      { x: 600, y: 600 },
      { x: 0, y: 600 },
    ]);
    expect(contourArea(clean as Contour)).toBeCloseTo(600 * 600, 6);
  });

  it("takes out a spike that only shows once the one beyond it has gone", () => {
    // Out along the top edge and back in two steps: the far tip goes first,
    // which leaves the near one a spike of its own.
    const nested: Contour = {
      closed: true,
      nodes: [
        corner(0, 0),
        corner(100, 0),
        corner(100, 100),
        corner(50, 100),
        corner(50, 150),
        corner(50, 200),
        corner(50, 150),
        corner(50, 100),
        corner(0, 100),
      ],
    };
    const clean = withoutStutter(nested);
    expect(clean?.nodes.map((node) => node.point)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 50, y: 100 },
      { x: 0, y: 100 },
    ]);
  });

  it("leaves nothing that draws of an outline that was nothing but folds", () => {
    // Out and back along one line, with the ends doubled.
    const fold: Contour = {
      closed: true,
      nodes: [corner(0, 0), corner(100, 0), corner(100, 0), corner(0, 0), corner(0, 0)],
    };
    const clean = withoutStutter(fold);
    // Either gone, or two nodes enclosing nothing, which the speck filter
    // after it takes away.
    if (clean) {
      expect(clean.nodes).toHaveLength(2);
      expect(contourArea(clean)).toBe(0);
    }
  });
});

/*
 * Whether a union covers what it was handed, measured on lines across it --
 * and measured the same way at any em. The slack for drawing curves as lines
 * is a share of the drawing's size, so a letter on a 2048 unit em is judged as
 * the same letter on a 1000 unit one is, rather than twice as strictly.
 */
describe("the cover a union is judged by", () => {
  const o = [circle(350, 350, 350), circle(350, 350, 200, true)];
  const outers = [true, false];

  for (const em of [1000, 2048]) {
    const by = em / 1000;
    describe(`at ${em} units to the em`, () => {
      it("finds a good union the same as what it was given", () => {
        const given = scaled(o, by);
        expect(linesUnlike(coverOf(given, outers), unite(given))).toBe(0);
      });

      it("finds a filled counter unlike on every line through it", () => {
        const given = scaled(o, by);
        const solid = scaled([o[0]], by);
        // The counter is four sevenths of the height, so more than twenty
        // of the forty-eight lines cross it.
        expect(linesUnlike(coverOf(given, outers), solid)).toBeGreaterThanOrEqual(24);
      });

      it("allows a drawing its own share of slack, and no more", () => {
        // A stem 700 tall, and answers three and five units wider at 1000:
        // the three is within the four units a drawing that size is allowed,
        // the five is not -- and at 2048 the same answers are twice as far
        // out, against twice the slack.
        const stem = scaled([rect(0, 0, 10, 700)], by);
        const given = coverOf(stem, [true]);
        expect(linesUnlike(given, scaled([rect(0, 0, 13, 700)], by))).toBe(0);
        expect(linesUnlike(given, scaled([rect(0, 0, 15, 700)], by))).toBe(48);
      });
    });
  }

  it("scales the slack with the drawing", () => {
    const small = coverOf([rect(0, 0, 10, 900)], [true]);
    const big = coverOf(scaled([rect(0, 0, 10, 900)], 2.048), [true]);
    expect(small.slack).toBeCloseTo(4.5, 9);
    expect(big.slack / small.slack).toBeCloseTo(2.048, 9);
    expect(big.lines).toHaveLength(small.lines.length);
  });

  it("never allows a small piece less than the rounding a boolean does", () => {
    expect(coverOf([rect(0, 0, 40, 40)], [true]).slack).toBe(4);
  });
});

/*
 * The ground outlines cover under the non-zero rule, directions as written.
 * Unlike `unite`, nothing is told what it is: a loop going round twice is
 * covered once, and a contour inside another is a counter only if it runs the
 * other way.
 */
describe("filled", () => {
  it("answers nothing for nothing", () => {
    expect(filled([])).toEqual([]);
    expect(filled([{ closed: true, nodes: [corner(0, 0)] }])).toEqual([]);
  });

  it("covers ground an outline goes round twice once, and keeps it", () => {
    // A five-pointed star drawn in one stroke: it goes round its middle
    // twice, which an even-odd fill would leave as a hole.
    const radius = 100;
    const star: Contour = {
      closed: true,
      nodes: [0, 2, 4, 1, 3].map((at) => {
        const angle = Math.PI / 2 + (at * 2 * Math.PI) / 5;
        return corner(radius * Math.cos(angle), radius * Math.sin(angle));
      }),
    };
    // Counted by the fold's own arithmetic the middle comes in twice.
    const inner = (radius * Math.cos((2 * Math.PI) / 5)) / Math.cos(Math.PI / 5);
    const middle = 2.5 * inner * inner * Math.sin((2 * Math.PI) / 5);
    const answer = filled([star]);
    expect(pieces(answer)).toBe(1);
    expect(answer.every((contour) => contourArea(contour) * ink(answer) > 0)).toBe(true);
    expect(Math.abs(ink(answer))).toBeCloseTo(Math.abs(contourArea(star)) - middle, 3);
  });

  it("keeps a counter that runs the other way", () => {
    const answer = filled([circle(0, 0, 100), circle(0, 0, 50, true)]);
    expect(answer).toHaveLength(2);
    const outer = Math.abs(contourArea(circle(0, 0, 100)));
    const inner = Math.abs(contourArea(circle(0, 0, 50)));
    expect(Math.abs(ink(answer))).toBeCloseTo(outer - inner, 0);
  });

  it("fills in a contour inside another that runs the same way", () => {
    const answer = filled([circle(0, 0, 100), circle(0, 0, 50)]);
    expect(answer).toHaveLength(1);
    expect(Math.abs(ink(answer))).toBeCloseTo(Math.abs(contourArea(circle(0, 0, 100))), 0);
  });

  it("covers both lobes of a figure eight, which wind opposite ways", () => {
    const eight: Contour = {
      closed: true,
      nodes: [corner(0, 0), corner(100, 100), corner(100, 0), corner(0, 100)],
    };
    const answer = filled([eight]);
    expect(pieces(answer)).toBe(2);
    expect(
      answer.reduce((total, contour) => total + Math.abs(contourArea(contour)), 0),
    ).toBeCloseTo(2 * 2500, 3);
  });
});
