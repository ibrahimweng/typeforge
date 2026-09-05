/**
 * What is under the pointer.
 *
 * Pure geometry, and the reason it is worth pinning is that the answers are
 * invisible. A hit test that is a few pixels out does not fail, it grabs the
 * wrong thing -- and the person who clicked sees a point move that they were
 * not pointing at and assumes they missed. There is no error to read and
 * nothing on screen to compare against, so the only way this is ever checked is
 * here.
 *
 * The one claim running through the file is agreement. `Hover` says it is
 * resolved "with the same tests, in the same order, that decide what a click
 * grabs", because a highlight that disagreed with the click would show one
 * target and hand you another. Several of these tests exist to hold that order
 * still.
 *
 * Two things are deliberately not tested, because no test can tell whether they
 * are there. `inside` casts its ray to the right, and casting it left would
 * answer identically -- any line crosses a closed ring an even number of times,
 * so the parity on one side is the parity on the other. And `knifeWouldCut`
 * refuses a stroke under a font unit long, which `slice` was going to refuse
 * anyway; it is an early-out on something asked on every pointer move, not a
 * rule about cutting. Listed here so their absence reads as a decision.
 */

import { beforeEach, describe, expect, it } from "vitest";

import type { GlyphView } from "@/components/glyph-render";
import { emptyTypeface, type Contour, type Glyph, type GlyphNode, type Vec2 } from "@/font/types";
import { store } from "@/state/useStore";
import {
  CLOSING_RADIUS,
  HIT_RADIUS,
  clamp,
  guideAt,
  hitTestAnchor,
  hitTestHandle,
  hitTestNode,
  hoverKey,
  inside,
  knifeWouldCut,
  onClosingPoint,
  onLastPoint,
  openOutline,
  parseNodeKey,
  segmentUnder,
  toScreen,
} from "./glyph-pointer";

/*
 * Half a pixel per font unit, the origin a long way from the canvas corner.
 *
 * Deliberately not 1:1 and not at the origin: a scale of one hides every
 * missing multiplication and an origin of zero hides every missing offset, so
 * a test written against either passes on code that has both faults.
 */
const VIEW: GlyphView = { scale: 0.5, originX: 100, originY: 400 };

/** Where a font-unit point lands on the canvas, worked out the long way. */
const at = (x: number, y: number): Vec2 => ({
  x: VIEW.originX + x * VIEW.scale,
  y: VIEW.originY - y * VIEW.scale,
});

function node(x: number, y: number, handles: Partial<GlyphNode> = {}): GlyphNode {
  return { point: { x, y }, handleIn: null, handleOut: null, type: "corner", ...handles };
}

/** A closed rectangle, which is four straight segments and no curves to argue about. */
function box(x: number, y: number, width: number, height: number): Contour {
  return {
    closed: true,
    nodes: [node(x, y), node(x + width, y), node(x + width, y + height), node(x, y + height)],
  };
}

/*
 * `dirty` is kept out of the overrides rather than merely defaulted: spreading
 * a `Partial<Glyph>` can put `undefined` back over a field the type says is a
 * boolean, and a helper that quietly makes an invalid letter is a helper whose
 * failures land in whichever test used it next.
 */
function glyph(contours: Contour[], over: Omit<Partial<Glyph>, "dirty"> = {}): Glyph {
  return {
    name: "a",
    unicodes: [],
    advanceWidth: 500,
    contours,
    components: [],
    anchors: [],
    params: {},
    dirty: false,
    ...over,
  };
}

describe("from font units to the canvas", () => {
  it("puts the origin where the view says, with y the other way up", () => {
    expect(toScreen(VIEW, { x: 0, y: 0 })).toEqual({ x: 100, y: 400 });
    expect(toScreen(VIEW, { x: 200, y: 0 })).toEqual({ x: 200, y: 400 });
    // Up the page is up the letter, which is down the canvas.
    expect(toScreen(VIEW, { x: 0, y: 200 })).toEqual({ x: 100, y: 300 });
    expect(toScreen(VIEW, { x: 0, y: -200 })).toEqual({ x: 100, y: 500 });
  });
});

describe("the point under the pointer", () => {
  const one = glyph([box(100, 100, 200, 200)]);

  it("finds the point it is on", () => {
    expect(hitTestNode(one, VIEW, at(100, 100))).toEqual({ contour: 0, node: 0 });
    expect(hitTestNode(one, VIEW, at(300, 300))).toEqual({ contour: 0, node: 2 });
  });

  /*
   * The reach is in screen pixels, not font units, and that is the whole point
   * of it: the target a hand has to hit is the same size however far the view
   * is zoomed in. Measured on the diagonal, since the test is a radius.
   */
  it("reaches exactly as far as it says, in pixels rather than font units", () => {
    const centre = at(100, 100);
    const edge = HIT_RADIUS / Math.SQRT2;
    expect(hitTestNode(one, VIEW, { x: centre.x + edge, y: centre.y + edge })).not.toBeNull();
    expect(hitTestNode(one, VIEW, { x: centre.x + HIT_RADIUS + 0.5, y: centre.y })).toBeNull();

    // Zoomed in four times, the same seven pixels is a quarter of the letter.
    const close = { ...VIEW, scale: 2 };
    const there = { x: close.originX + 100 * close.scale, y: close.originY - 100 * close.scale };
    expect(hitTestNode(one, close, { x: there.x + HIT_RADIUS, y: there.y })).not.toBeNull();
    expect(hitTestNode(one, close, { x: there.x + HIT_RADIUS + 0.5, y: there.y })).toBeNull();
  });

  it("finds nothing on an empty letter, and nothing out in the margin", () => {
    expect(hitTestNode(glyph([]), VIEW, at(0, 0))).toBeNull();
    expect(hitTestNode(one, VIEW, at(600, 600))).toBeNull();
  });

  it("looks in every contour, not only the first", () => {
    const two = glyph([box(0, 0, 50, 50), box(400, 400, 50, 50)]);
    expect(hitTestNode(two, VIEW, at(400, 400))).toEqual({ contour: 1, node: 0 });
  });
});

describe("the handle under the pointer", () => {
  const pulled = glyph([
    {
      closed: false,
      nodes: [
        node(100, 100, { handleOut: { x: 160, y: 100 } }),
        node(300, 100, { handleIn: { x: 240, y: 100 } }),
      ],
    },
  ]);

  it("finds either side, and says which", () => {
    expect(hitTestHandle(pulled, VIEW, at(160, 100))).toEqual({
      ref: { contour: 0, node: 0 },
      side: "out",
    });
    expect(hitTestHandle(pulled, VIEW, at(240, 100))).toEqual({
      ref: { contour: 0, node: 1 },
      side: "in",
    });
  });

  it("passes over a node that has no handle on that side", () => {
    expect(hitTestHandle(pulled, VIEW, at(100, 100))).toBeNull();
  });

  /*
   * A node's own handles can sit on top of each other -- a smooth point pulled
   * to nothing has both at the point itself -- and the outgoing one is what a
   * drag continues, so it answers first.
   */
  it("answers with the outgoing handle when both are in reach", () => {
    const both = glyph([
      {
        closed: false,
        nodes: [node(100, 100, { handleIn: { x: 99, y: 100 }, handleOut: { x: 101, y: 100 } })],
      },
    ]);
    expect(hitTestHandle(both, VIEW, at(100, 100))?.side).toBe("out");
  });
});

describe("the anchor under the pointer", () => {
  const marked = glyph([], { anchors: [{ name: "top", x: 250, y: 700 }] });

  it("finds it by name", () => {
    expect(hitTestAnchor(marked, VIEW, at(250, 700))).toBe("top");
    expect(hitTestAnchor(marked, VIEW, at(250, 400))).toBeNull();
  });

  /*
   * Two pixels more than a node gets. An anchor is drawn as a cross rather than
   * a square and reads as bigger than it is, and unlike a node there is never a
   * second one beside it to take the click by mistake.
   */
  it("is a slightly bigger target than a node", () => {
    const centre = at(250, 700);
    expect(hitTestAnchor(marked, VIEW, { x: centre.x + HIT_RADIUS + 2, y: centre.y })).toBe("top");
    expect(hitTestAnchor(marked, VIEW, { x: centre.x + HIT_RADIUS + 2.5, y: centre.y })).toBeNull();
  });
});

/**
 * The order the three tests are asked in, which two places have to agree on.
 *
 * `updateHover` in `glyph-gestures.ts` resolves anchor, then handle, then node,
 * and the pointer-down handler beside it takes them in the same order. The
 * `Hover` doc says why: if they disagreed the highlight would be a lie, showing
 * one target and handing you another. Held here by putting all three in one
 * place and asking which answers.
 */
describe("what a click grabs when three things are under it", () => {
  const crowded = glyph(
    [
      {
        closed: false,
        nodes: [node(250, 700, { handleOut: { x: 250, y: 700 } })],
      },
    ],
    { anchors: [{ name: "top", x: 250, y: 700 }] },
  );

  it("prefers the anchor to the handle, and the handle to the node", () => {
    const point = at(250, 700);
    expect(hitTestAnchor(crowded, VIEW, point)).toBe("top");
    expect(hitTestHandle(crowded, VIEW, point)).not.toBeNull();
    expect(hitTestNode(crowded, VIEW, point)).not.toBeNull();

    // The order the two callers apply, written out: the anchor wins, and each
    // later test is only asked when the ones before it found nothing.
    const anchorHit = hitTestAnchor(crowded, VIEW, point);
    const handleHit = anchorHit ? null : hitTestHandle(crowded, VIEW, point);
    const nodeHit = anchorHit || handleHit ? null : hitTestNode(crowded, VIEW, point);
    expect([anchorHit, handleHit, nodeHit]).toEqual(["top", null, null]);
  });
});

describe("naming a hover so two of them can be compared", () => {
  it("gives each kind its own name, and nothing its own", () => {
    expect(hoverKey(null)).toBe("");
    expect(hoverKey({ kind: "anchor", name: "top" })).toBe("anchor:top");
    expect(hoverKey({ kind: "node", ref: { contour: 1, node: 2 } })).toBe("node:1:2");
    expect(hoverKey({ kind: "handle", ref: { contour: 1, node: 2 }, side: "in" })).toBe(
      "handle:1:2:in",
    );
  });

  /*
   * The two sides have to differ, since the whole reason for the key is to tell
   * whether the hover changed. A key that called them the same would leave the
   * highlight on the handle the pointer just left.
   */
  it("tells one side of a node from the other", () => {
    const ref = { contour: 0, node: 0 };
    expect(hoverKey({ kind: "handle", ref, side: "in" })).not.toBe(
      hoverKey({ kind: "handle", ref, side: "out" }),
    );
    expect(hoverKey({ kind: "handle", ref, side: "in" })).not.toBe(hoverKey({ kind: "node", ref }));
  });

  it("round trips a node key", () => {
    expect(parseNodeKey(hoverKey({ kind: "node", ref: { contour: 3, node: 4 } }).slice(5))).toEqual(
      {
        contour: 3,
        node: 4,
      },
    );
  });
});

describe("the guide under the pointer", () => {
  const guides = [
    { axis: "y" as const, at: 500 },
    { axis: "x" as const, at: 250 },
  ];

  it("finds a horizontal guide by height and a vertical one by width", () => {
    expect(guideAt(guides, VIEW, { x: 300, y: at(0, 500).y })).toBe(0);
    expect(guideAt(guides, VIEW, { x: at(250, 0).x, y: 300 })).toBe(1);
    expect(guideAt(guides, VIEW, { x: 300, y: 200 })).toBeNull();
  });

  /*
   * Four pixels, tighter than the band a node answers to and deliberately so: a
   * guide runs the whole width of the canvas, so a generous band would take
   * clicks meant for a point anywhere along it.
   */
  it("answers to a tighter band than a node does", () => {
    const line = at(0, 500).y;
    expect(guideAt(guides, VIEW, { x: 300, y: line + 4 })).toBe(0);
    expect(guideAt(guides, VIEW, { x: 300, y: line + 4.5 })).toBeNull();
    expect(4).toBeLessThan(HIT_RADIUS);
  });

  /*
   * Backwards through the list, so the guide drawn on top is the one caught --
   * which is the one somebody has just put there, and the one they are
   * reaching for when two are stacked.
   */
  it("takes the last one laid down when two are in the same place", () => {
    const stacked = [
      { axis: "y" as const, at: 500 },
      { axis: "y" as const, at: 501 },
    ];
    expect(guideAt(stacked, VIEW, { x: 300, y: at(0, 500).y })).toBe(1);
  });
});

describe("the segment under the pointer", () => {
  const one = glyph([box(100, 100, 400, 200)]);

  it("finds which contour and which segment of it", () => {
    const found = segmentUnder(one, VIEW, at(300, 100));
    expect(found).toMatchObject({ contour: 0, index: 0 });
    expect(found?.t).toBeGreaterThan(0);
    expect(found?.t).toBeLessThan(1);
  });

  it("finds nothing out in the middle of the counter", () => {
    expect(segmentUnder(one, VIEW, at(300, 200))).toBeNull();
  });

  /**
   * The one that put the point on the wrong contour.
   *
   * `segmentAt` is careful within a contour -- sixty samples a segment, keeping
   * the closest -- and that care was thrown away at the door: the first contour
   * with anything at all in reach answered, and every contour after it went
   * unasked. The doc above it said "keeps the nearest" while the code kept the
   * first.
   *
   * Contours overlap all the time while a letter is being built, an oval laid
   * over a stem before they are merged being the ordinary case rather than the
   * awkward one. Here the pointer is two font units from the second contour's
   * edge and twelve from the first's, and the first used to answer -- so the
   * point went in six times further away than the edge being pointed at, and
   * the scissors cut there.
   */
  it("keeps the nearest edge and not the first one it finds", () => {
    const overlapping = glyph([box(0, 100, 400, 100), box(0, 110, 400, 100)]);
    // Both top edges are within reach: 7px at half scale is fourteen font units.
    expect(HIT_RADIUS / VIEW.scale).toBe(14);
    expect(segmentUnder(overlapping, VIEW, at(200, 212))?.contour).toBe(1);
    expect(segmentUnder(overlapping, VIEW, at(200, 198))?.contour).toBe(0);
  });

  /*
   * A tie goes to the contour drawn first, which is the one underneath. Not
   * because it is better, but because it has to go somewhere and the same click
   * twice must give the same answer.
   */
  it("settles a tie the same way every time", () => {
    const twins = glyph([box(0, 100, 400, 100), box(0, 100, 400, 100)]);
    expect(segmentUnder(twins, VIEW, at(200, 200))?.contour).toBe(0);
  });

  /*
   * The reach is seven pixels divided by the scale, so zooming out makes it
   * more font units and pulls in edges that are nowhere near on screen. That is
   * the right behaviour -- the target stays the same size under the hand -- and
   * it is also what makes the nearest-versus-first difference reachable.
   */
  it("reaches further into the letter the further the view is zoomed out", () => {
    const far = { ...VIEW, scale: 0.05 };
    const point = { x: far.originX + 200 * far.scale, y: far.originY - 240 * far.scale };
    expect(segmentUnder(one, far, point)).not.toBeNull();
    expect(segmentUnder(one, VIEW, at(200, 240))).toBeNull();
  });
});

describe("whether the knife would cut anything", () => {
  const stem = glyph([box(100, 0, 100, 700)]);
  const across = (fromY: number, toY: number) => ({ from: at(50, fromY), to: at(250, toY) });

  it("says yes to a line drawn across the stem", () => {
    expect(knifeWouldCut(stem, VIEW, across(300, 300))).toBe(true);
  });

  /*
   * Down beside a stem rather than across it does nothing at all -- and did it
   * silently, so the only way to find out was to let go and watch nothing
   * happen. The cursor asks this on every move so it can say beforehand.
   */
  it("says no to a line drawn down beside it", () => {
    expect(knifeWouldCut(stem, VIEW, { from: at(50, 100), to: at(50, 600) })).toBe(false);
  });

  it("says no to a stroke too short to be a stroke", () => {
    expect(knifeWouldCut(stem, VIEW, { from: at(150, 300), to: at(150.5, 300) })).toBe(false);
  });

  it("says no when there is no letter to cut", () => {
    expect(knifeWouldCut(null, VIEW, across(300, 300))).toBe(false);
  });
});

/**
 * Whether a point is inside a ring the hand drew.
 *
 * A ray cast to the right, counting crossings. The ring is whatever was drawn
 * and need not be convex or even tidy, which is the reason the lasso exists at
 * all: a box cannot take the points on one side of a curve without the other.
 */
describe("inside a lasso", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];

  it("says yes within and no without", () => {
    expect(inside(square, { x: 50, y: 50 })).toBe(true);
    expect(inside(square, { x: 150, y: 50 })).toBe(false);
    expect(inside(square, { x: -50, y: 50 })).toBe(false);
    expect(inside(square, { x: 50, y: 150 })).toBe(false);
    expect(inside(square, { x: 50, y: -50 })).toBe(false);
  });

  /*
   * A ray passing exactly through a vertex, counted once rather than twice or
   * not at all. A lasso drawn by hand has hundreds of points and one of them
   * lands level with something eventually.
   */
  it("counts a ray through a vertex once", () => {
    const diamond = [
      { x: 50, y: 0 },
      { x: 100, y: 50 },
      { x: 50, y: 100 },
      { x: 0, y: 50 },
    ];
    expect(inside(diamond, { x: 50, y: 50 })).toBe(true);
    expect(inside(diamond, { x: 150, y: 50 })).toBe(false);
    expect(inside(diamond, { x: -50, y: 50 })).toBe(false);
  });

  /**
   * The half-open rule on y, which decides the two edges lying along the ray.
   *
   * A vertex exactly level with the ray counts for the edge below it and not
   * the one above, so a ring's bottom edge is inside it and its top edge is
   * not -- one and not both, and the same way every time.
   *
   * Which is not a curiosity. A node's y is a round number in a font, letters
   * are full of runs of them sitting on the baseline or the x-height, and a
   * lasso dragged across such a run has its edge exactly level with a dozen
   * points at once. Without the rule they would be counted twice or not at all,
   * and which of those you got would decide the selection. The diamond above
   * cannot show this, having no horizontal edge to lie along the ray.
   */
  it("takes the bottom edge of a ring and not the top", () => {
    for (const x of [1, 25, 50, 75, 99]) {
      expect(inside(square, { x, y: 0 }), `x=${x} on the bottom edge`).toBe(true);
      expect(inside(square, { x, y: 100 }), `x=${x} on the top edge`).toBe(false);
    }
  });

  /*
   * A ring that doubles back on itself. The odd-crossing rule answers for these
   * without being told they are unusual, which is the argument for using it
   * rather than a convex test.
   */
  it("answers for a ring that folds over itself", () => {
    const horseshoe = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 70, y: 100 },
      { x: 70, y: 30 },
      { x: 30, y: 30 },
      { x: 30, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(inside(horseshoe, { x: 50, y: 15 })).toBe(true);
    // Up between the arms, which is outside the ring even though it is between
    // its leftmost and rightmost points.
    expect(inside(horseshoe, { x: 50, y: 70 })).toBe(false);
    expect(inside(horseshoe, { x: 85, y: 70 })).toBe(true);
  });

  it("says no to a ring with no area", () => {
    expect(inside([], { x: 0, y: 0 })).toBe(false);
    expect(inside([{ x: 0, y: 0 }], { x: 0, y: 0 })).toBe(false);
    expect(
      inside(
        [
          { x: 0, y: 0 },
          { x: 100, y: 100 },
        ],
        { x: 50, y: 50 },
      ),
    ).toBe(false);
  });
});

/**
 * The pen's three questions, which all begin by asking whether it is drawing.
 *
 * `openOutline` reads the store rather than the glyph it is handed, and that is
 * the point of it: an outline finished and left open is a legitimate thing to
 * have, and asking only whether the last contour is closed made a pen click
 * anywhere on the canvas reach back and extend it. Ten abandoned attempts
 * joined into one contour wandering across the letter.
 */
describe("the outline the pen is part way through", () => {
  const half = (): Contour => ({
    closed: false,
    nodes: [node(100, 100), node(300, 100), node(300, 300)],
  });

  /*
   * The flag put down between tests, through the store's own verb.
   *
   * `startBlank` does not clear it -- it is about the document and this is
   * about the hand -- so a test that turned drawing on would leave it on for
   * every test after it, and the ones asserting "nothing is being drawn" would
   * pass or fail by their position in the file. `finishOutline` is the verb the
   * Escape key uses, and it needs a real letter with a real open contour to act
   * on, so there is one.
   */
  beforeEach(() => {
    const typeface = emptyTypeface();
    typeface.glyphs = [glyph([half()])];
    typeface.glyphIndex = new Map([["a", 0]]);
    store.startBlank();
    Object.assign(store.getSnapshot().typeface!, typeface);
    store.startDrawing();
    store.finishOutline("a");
    expect(store.getSnapshot().drawing).toBe(false);
  });

  it("has nothing part way through while nothing is being drawn", () => {
    expect(store.getSnapshot().drawing).toBe(false);
    expect(openOutline(glyph([half()]))).toBeNull();
  });

  it("is the last contour, once the pen has begun", () => {
    store.startDrawing();
    const one = glyph([box(0, 0, 50, 50), half()]);
    expect(openOutline(one)).toBe(one.contours[1]);
  });

  /*
   * The last, and not merely an open one. `addPoint` appends to the last
   * contour and starts a new one when it is closed, so the last is the one the
   * next click extends -- and abandoned attempts are open contours sitting
   * earlier in the list, which is the ordinary state of a letter somebody has
   * been drawing for a while. Answering with one of those would show the
   * closing ring on an outline the pen is not on.
   */
  it("is the last one even when earlier ones were left open too", () => {
    store.startDrawing();
    const abandoned: Contour = { closed: false, nodes: [node(0, 0), node(20, 20), node(0, 40)] };
    const one = glyph([abandoned, half()]);
    expect(openOutline(one)).toBe(one.contours[1]);
  });

  it("is nothing when the last contour is closed or empty", () => {
    store.startDrawing();
    expect(openOutline(glyph([box(0, 0, 50, 50)]))).toBeNull();
    expect(openOutline(glyph([{ closed: false, nodes: [] }]))).toBeNull();
    expect(openOutline(glyph([]))).toBeNull();
  });

  describe("the point that would close it", () => {
    beforeEach(() => store.startDrawing());

    /*
     * Twice the reach a node gets, and deliberately. Closing is an intention
     * already declared -- one open outline, one point that closes it, and no
     * other point within reach means anything -- so the cost of being generous
     * is nothing and the cost of being strict is a stray point every time a
     * hand is a few pixels out.
     */
    it("is a more generous target than a node, by exactly double", () => {
      expect(CLOSING_RADIUS).toBe(HIT_RADIUS * 2);
      const one = glyph([half()]);
      const first = at(100, 100);
      expect(onClosingPoint(one, VIEW, { x: first.x + CLOSING_RADIUS, y: first.y })).toBe(true);
      expect(onClosingPoint(one, VIEW, { x: first.x + CLOSING_RADIUS + 0.5, y: first.y })).toBe(
        false,
      );
    });

    it("is the first point of the outline and no other", () => {
      const one = glyph([half()]);
      expect(onClosingPoint(one, VIEW, at(100, 100))).toBe(true);
      expect(onClosingPoint(one, VIEW, at(300, 300))).toBe(false);
    });

    /*
     * Two points closed is a line drawn twice, with no area to fill, so under
     * three there is nothing to close and the click has to mean something else.
     */
    it("is nowhere at all under three points", () => {
      const two = glyph([{ closed: false, nodes: [node(100, 100), node(300, 100)] }]);
      expect(onClosingPoint(two, VIEW, at(100, 100))).toBe(false);
    });

    /*
     * And nowhere once the pen has been put down, on the very same outline.
     *
     * The shape has not changed -- three points, still open, its first point
     * still under the pointer -- and the answer has, because what is being
     * asked is whether a hand is part way through drawing rather than whether a
     * contour happens to be open. An outline finished and left open is a
     * legitimate thing to have, and a pen click landing near it later must
     * start something new rather than reach back and close it.
     */
    it("is nowhere on the same outline once the pen has been put down", () => {
      const one = glyph([half()]);
      expect(onClosingPoint(one, VIEW, at(100, 100))).toBe(true);
      expect(store.finishOutline("a")).toBe(true);
      expect(store.getSnapshot().drawing).toBe(false);
      expect(onClosingPoint(one, VIEW, at(100, 100))).toBe(false);
    });
  });

  describe("the point the pen last placed", () => {
    beforeEach(() => store.startDrawing());

    const pulled = (): Contour => ({
      closed: false,
      nodes: [node(100, 100), node(300, 100, { handleOut: { x: 360, y: 100 } })],
    });

    it("is the last one, at the ordinary reach", () => {
      const one = glyph([pulled()]);
      expect(onLastPoint(one, VIEW, at(300, 100))).toBe(true);
      const there = at(300, 100);
      expect(onLastPoint(one, VIEW, { x: there.x + HIT_RADIUS + 0.5, y: there.y })).toBe(false);
      expect(onLastPoint(one, VIEW, at(100, 100))).toBe(false);
    });

    /**
     * The handle check is the whole of the difference from a plain node hit.
     *
     * A click here retracts the outgoing handle so the next segment leaves
     * straight. On a point with no handle there is nothing to retract, and
     * reporting it as a thing about to happen puts "Click again to end the
     * curve" over a click that would do nothing at all.
     */
    it("is nowhere on a point with no handle to take off", () => {
      const straight = glyph([{ closed: false, nodes: [node(100, 100), node(300, 100)] }]);
      expect(hitTestNode(straight, VIEW, at(300, 100))).not.toBeNull();
      expect(onLastPoint(straight, VIEW, at(300, 100))).toBe(false);
    });
  });
});

describe("holding a number between two others", () => {
  it("passes through what is already between them", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it("pulls back what is outside them", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });
});
