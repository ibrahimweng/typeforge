/**
 * The marks themselves: where each one lands, what shape it is, and what
 * colour it is read in.
 *
 * `glyph-painting.ts` decides what to draw and in what order, and is checked
 * beside this. What is left here is each mark on its own -- and all of it is
 * arithmetic on a context, so the context is a fake that writes down every call
 * and every property set on it. A transcript is what a canvas does not keep,
 * and it is the only way any of this is checkable at all: nothing here throws
 * when it is wrong, it just draws a square a few pixels from where it belongs.
 *
 * One test is about the whole file rather than any function in it. Every colour
 * on this canvas is a custom property read off an element, and it has to be
 * read off the canvas: the ground is set on an ancestor of the canvas and not
 * on the document, so a token read from the root is the other ground's value.
 * That is not visible in any one function's output -- both are just colours --
 * so it is asked of all of them at once.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { applyView, type GlyphView } from "@/components/glyph-render";
import { emptyTypeface, type Contour, type Glyph, type GlyphNode, type Vec2 } from "@/font/types";
import { CLOSING_RADIUS, HIT_RADIUS, type Drag } from "./glyph-pointer";
import { store } from "@/state/useStore";
import {
  NODE_SIZE,
  drawAnchors,
  drawContours,
  drawFreehandPreview,
  drawKnifePreview,
  drawLasso,
  drawMarks,
  drawMarquee,
  drawMetrics,
  drawNodes,
  drawPathOutline,
  drawPenReach,
  drawSegmentUnder,
  drawShapePreview,
  withAlpha,
} from "./glyph-canvas";

const VIEW: GlyphView = { scale: 0.5, originX: 100, originY: 400 };
const SIZE = { width: 800, height: 600 };

/** Where a font-unit point lands on the canvas, worked out the long way. */
const at = (x: number, y: number): Vec2 => ({
  x: VIEW.originX + x * VIEW.scale,
  y: VIEW.originY - y * VIEW.scale,
});

interface Note {
  did: string;
  args: unknown[];
}

/**
 * A context that draws nothing and writes down everything.
 *
 * Property sets are recorded as calls too -- `fillStyle` and `lineWidth` are as
 * much a part of a mark as `arc` is, and a colour set and never used is exactly
 * the kind of thing that is invisible on a real canvas.
 */
function recorder(): { context: CanvasRenderingContext2D; notes: Note[]; canvas: object } {
  const notes: Note[] = [];
  laid.length = 0;
  const canvas = { nodeName: "CANVAS" };
  const context = new Proxy(
    { canvas },
    {
      get(target: Record<string, unknown>, key: string) {
        if (key === "canvas") return target.canvas;
        if (key === "measureText") return () => ({ width: 0 });
        return (...args: unknown[]) => {
          notes.push({ did: key, args });
          return undefined;
        };
      },
      set(_target, key: string, value: unknown) {
        notes.push({ did: `set ${key}`, args: [value] });
        return true;
      },
    },
  );
  return { context: context as unknown as CanvasRenderingContext2D, notes, canvas };
}

const did = (notes: Note[], name: string): Note[] => notes.filter((one) => one.did === name);
const didOnce = (notes: Note[], name: string): unknown[] => {
  const found = did(notes, name);
  expect(found, `${name} happened ${found.length} times`).toHaveLength(1);
  return found[0].args;
};
/** Every colour this drawing set, from either of the two colour properties. */
const colours = (notes: Note[]): string[] =>
  notes
    .filter((one) => one.did === "set fillStyle" || one.did === "set strokeStyle")
    .map((one) => String(one.args[0]));

const node = (x: number, y: number, over: Partial<GlyphNode> = {}): GlyphNode => ({
  point: { x, y },
  handleIn: null,
  handleOut: null,
  type: "corner",
  ...over,
});

const box = (): Contour => ({
  closed: true,
  nodes: [node(100, 0), node(200, 0), node(200, 700), node(100, 700)],
});

function letter(contours: Contour[] = [], over: Partial<Glyph> = {}): Glyph {
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

/**
 * A `Path2D`, which Node does not have.
 *
 * `drawContours` builds one to fill through the view's transform, so without a
 * stand-in the drawings that fill an outline cannot run here at all. It records
 * what it was given, because a filled shape puts all of its geometry in here
 * and none of it on the context -- so a preview drawn from the wrong box would
 * otherwise be a transcript identical to one drawn from the right box.
 */
const laid: Note[] = [];
class NotePath {
  moveTo(...args: number[]): void {
    laid.push({ did: "path moveTo", args });
  }
  lineTo(...args: number[]): void {
    laid.push({ did: "path lineTo", args });
  }
  bezierCurveTo(...args: number[]): void {
    laid.push({ did: "path bezierCurveTo", args });
  }
  closePath(): void {
    laid.push({ did: "path closePath", args: [] });
  }
}
vi.stubGlobal("Path2D", NotePath);

afterEach(() => {
  vi.unstubAllGlobals();
  // Put the path back: `unstubAllGlobals` takes it with the rest.
  vi.stubGlobal("Path2D", NotePath);
});

describe("putting an alpha on a colour", () => {
  it("turns a hex colour into an rgba one", () => {
    expect(withAlpha("#0c8ce9", 0.5)).toBe("rgba(12, 140, 233, 0.5)");
    expect(withAlpha("#000000", 1)).toBe("rgba(0, 0, 0, 1)");
  });

  /*
   * Three digits mean each doubled, which is the shorthand every stylesheet
   * uses. Read as-is, `#eee` would be `#ee` and change the colour rather than
   * its alpha.
   */
  it("understands the three-digit shorthand", () => {
    expect(withAlpha("#eee", 0.5)).toBe(withAlpha("#eeeeee", 0.5));
    expect(withAlpha("#f00", 1)).toBe("rgba(255, 0, 0, 1)");
  });

  /*
   * A token is as likely to be an `oklch(...)` as a hex, and there is no
   * arithmetic to do on one from here. `color-mix` says the same thing to the
   * browser and works for any colour syntax there will ever be.
   */
  it("mixes anything that is not a hex colour, rather than mangling it", () => {
    expect(withAlpha("oklch(0.48 0.22 300)", 0.4)).toBe(
      "color-mix(in oklab, oklch(0.48 0.22 300) 40%, transparent)",
    );
    expect(withAlpha("var(--accent)", 0.75)).toBe(
      "color-mix(in oklab, var(--accent) 75%, transparent)",
    );
  });
});

describe("the lines a letter is measured against", () => {
  const typeface = emptyTypeface();

  it("draws each metric at its own height, and names it", () => {
    const { context, notes } = recorder();
    drawMetrics(context, typeface, null, VIEW, SIZE);
    const labels = did(notes, "fillText").map((one) => one.args[0]);
    expect(labels).toEqual(["baseline", "x-height", "cap height", "ascender", "descender"]);

    // The baseline is the one whose height is zero, so it lands on the origin.
    const across = did(notes, "moveTo").map((one) => one.args[1]);
    expect(across[0]).toBe(Math.round(VIEW.originY) + 0.5);
  });

  /*
   * A line off the top or bottom of the canvas is not drawn at all rather than
   * drawn where it cannot be seen: the label goes with it, and a label pinned
   * to the edge of the canvas would name a line that is not there.
   */
  it("leaves out a line that has been scrolled off the canvas", () => {
    const { context, notes } = recorder();
    drawMetrics(context, typeface, null, { ...VIEW, originY: -5000 }, SIZE);
    expect(did(notes, "fillText")).toHaveLength(0);
  });

  it("brackets the letter with its origin and its advance", () => {
    const { context, notes } = recorder();
    drawMetrics(context, typeface, letter(), VIEW, SIZE);
    const verticals = did(notes, "moveTo")
      .filter((one) => one.args[1] === 0)
      .map((one) => one.args[0]);
    expect(verticals).toEqual([
      Math.round(VIEW.originX) + 0.5,
      Math.round(VIEW.originX + 500 * VIEW.scale) + 0.5,
    ]);
  });

  /**
   * A guide is told apart from a metric line, and says where it is.
   *
   * The two mean opposite things: a metric line is a fact about the font and
   * cannot be moved, a guide is a decision somebody made and can be dragged or
   * thrown away. A guide whose position you cannot read is a guide you cannot
   * put back.
   */
  it("draws a guide dashed, and writes its height beside it", () => {
    const { context, notes } = recorder();
    drawMetrics(context, typeface, null, VIEW, SIZE, [{ axis: "y", at: 500 }]);
    expect(did(notes, "setLineDash").some((one) => (one.args[0] as number[]).length > 0)).toBe(
      true,
    );
    expect(did(notes, "fillText").map((one) => one.args[0])).toContain("500");
  });

  it("runs a horizontal guide across and a vertical one down", () => {
    const flat = recorder();
    drawMetrics(flat.context, typeface, null, VIEW, SIZE, [{ axis: "y", at: 500 }]);
    const upright = recorder();
    drawMetrics(upright.context, typeface, null, VIEW, SIZE, [{ axis: "x", at: 250 }]);

    const ends = (notes: Note[]) => did(notes, "lineTo").map((one) => one.args);
    // The horizontal one ends at the far side; the vertical one at the bottom.
    expect(ends(flat.notes)).toContainEqual([SIZE.width, Math.round(VIEW.originY - 250) + 0.5]);
    expect(ends(upright.notes)).toContainEqual([Math.round(VIEW.originX + 125) + 0.5, SIZE.height]);
  });
});

describe("the points of an outline", () => {
  it("draws a corner square and a smooth point round", () => {
    const corner = recorder();
    drawNodes(corner.context, [{ closed: false, nodes: [node(100, 100)] }], VIEW, new Set(), null);
    expect(did(corner.notes, "fillRect")).toHaveLength(1);
    expect(did(corner.notes, "arc")).toHaveLength(0);

    const smooth = recorder();
    drawNodes(
      smooth.context,
      [{ closed: false, nodes: [node(100, 100, { type: "smooth" })] }],
      VIEW,
      new Set(),
      null,
    );
    expect(did(smooth.notes, "fillRect")).toHaveLength(0);
    expect(did(smooth.notes, "arc")).toHaveLength(1);
  });

  it("puts the point where the view says it goes", () => {
    const { context, notes } = recorder();
    drawNodes(context, [{ closed: false, nodes: [node(200, 300)] }], VIEW, new Set(), null);
    const [x, y, width, height] = didOnce(notes, "fillRect") as number[];
    const where = at(200, 300);
    const half = NODE_SIZE + 0.5;
    expect({ x: x + half, y: y + half }).toEqual(where);
    expect({ width, height }).toEqual({ width: half * 2, height: half * 2 });
  });

  it("marks a picked point in a different colour from an unpicked one", () => {
    const one = [{ closed: false, nodes: [node(100, 100)] }];
    const plain = recorder();
    drawNodes(plain.context, one, VIEW, new Set(), null);
    const picked = recorder();
    drawNodes(picked.context, one, VIEW, new Set(["0:0"]), null);
    expect(colours(picked.notes)).not.toEqual(colours(plain.notes));
  });

  /*
   * The arm from a point to its handle, so the handle reads as belonging to
   * that point rather than floating beside it.
   */
  it("joins each handle to the point it belongs to", () => {
    const { context, notes } = recorder();
    drawNodes(
      context,
      [{ closed: false, nodes: [node(100, 100, { handleOut: { x: 200, y: 100 } })] }],
      VIEW,
      new Set(),
      null,
    );
    const arms = did(notes, "lineTo").map((one) => one.args);
    expect(arms).toContainEqual([at(200, 100).x, at(200, 100).y]);
    // And a dot on the handle itself, which is the second arc after the point.
    expect(did(notes, "arc").length).toBeGreaterThan(0);
  });

  /*
   * The ring goes on what a click would grab, and the three kinds of hover are
   * told apart: a node, a handle, and which side of the node the handle is.
   */
  it("rings the node under the pointer and not its neighbour", () => {
    const two = [{ closed: false, nodes: [node(100, 100), node(300, 100)] }];
    const { context, notes } = recorder();
    drawNodes(context, two, VIEW, new Set(), { kind: "node", ref: { contour: 0, node: 1 } });
    const rings = did(notes, "arc").filter((one) => one.args[2] === NODE_SIZE + 4);
    expect(rings).toHaveLength(1);
    expect(rings[0].args.slice(0, 2)).toEqual([at(300, 100).x, at(300, 100).y]);
  });

  it("rings the handle under the pointer, on the side it is on", () => {
    const both = [
      {
        closed: false,
        nodes: [node(100, 100, { handleIn: { x: 40, y: 100 }, handleOut: { x: 160, y: 100 } })],
      },
    ];
    const out = recorder();
    drawNodes(out.context, both, VIEW, new Set(), {
      kind: "handle",
      ref: { contour: 0, node: 0 },
      side: "out",
    });
    const rings = did(out.notes, "arc").filter((one) => one.args[2] === NODE_SIZE + 2.5);
    expect(rings).toHaveLength(1);
    expect(rings[0].args.slice(0, 2)).toEqual([at(160, 100).x, at(160, 100).y]);
  });

  it("rings nothing when the pointer is over nothing", () => {
    const { context, notes } = recorder();
    drawNodes(context, [box()], VIEW, new Set(), null);
    expect(did(notes, "arc").filter((one) => one.args[2] === NODE_SIZE + 4)).toHaveLength(0);
  });
});

/**
 * An anchor is not part of the letter, it is where another glyph attaches to
 * it -- so it is deliberately not the same shape as an outline point.
 */
describe("anchors", () => {
  it("draws a cross and a ring, and writes the name beside it", () => {
    const { context, notes } = recorder();
    drawAnchors(context, [{ name: "top", x: 250, y: 700 }], VIEW, null);
    const where = at(250, 700);
    expect(did(notes, "moveTo").map((one) => one.args)).toEqual([
      [where.x - 6, where.y],
      [where.x, where.y - 6],
    ]);
    expect(didOnce(notes, "fillText")[0]).toBe("top");
  });

  it("does nothing at all for a letter with no anchors", () => {
    const { context, notes } = recorder();
    drawAnchors(context, [], VIEW, null);
    expect(notes).toHaveLength(0);
  });

  it("rings the one under the pointer, by name", () => {
    const two = [
      { name: "top", x: 250, y: 700 },
      { name: "bottom", x: 250, y: 0 },
    ];
    const { context, notes } = recorder();
    drawAnchors(context, two, VIEW, { kind: "anchor", name: "bottom" });
    const rings = did(notes, "arc").filter((one) => one.args[2] === 8);
    expect(rings).toHaveLength(1);
    expect(rings[0].args.slice(0, 2)).toEqual([at(250, 0).x, at(250, 0).y]);
  });
});

describe("the marks a gesture leaves while it is running", () => {
  /*
   * A band dragged up and to the left is the same band as one dragged down and
   * to the right. Drawn from the raw corners it would come out with a negative
   * width, which fills nothing.
   */
  it("draws the band the same whichever way it was dragged", () => {
    const corners: [Vec2, Vec2][] = [
      [
        { x: 10, y: 20 },
        { x: 110, y: 220 },
      ],
      [
        { x: 110, y: 220 },
        { x: 10, y: 20 },
      ],
      [
        { x: 110, y: 20 },
        { x: 10, y: 220 },
      ],
    ];
    for (const [from, to] of corners) {
      const { context, notes } = recorder();
      drawMarquee(context, { kind: "marquee", from, to, additive: false }, 0);
      expect(didOnce(notes, "fillRect")).toEqual([10, 20, 100, 200]);
    }
  });

  /*
   * Closed while it is still being drawn, because that is what will be tested
   * when the button comes up. An open ring would be a picture of something the
   * tool does not do.
   */
  it("closes the lasso's ring while it is still being drawn", () => {
    const { context, notes } = recorder();
    drawLasso(
      context,
      {
        kind: "lasso",
        trail: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 50, y: 50 },
        ],
        additive: false,
      },
      0,
    );
    expect(did(notes, "closePath")).toHaveLength(1);
    expect(did(notes, "lineTo")).toHaveLength(2);
  });

  it("draws neither a lasso nor a pencil trail from a single point", () => {
    const one = [{ x: 0, y: 0 }];

    const lasso = recorder();
    drawLasso(lasso.context, { kind: "lasso", trail: one, additive: false }, 0);
    expect(lasso.notes, "lasso").toHaveLength(0);

    const pencil = recorder();
    drawFreehandPreview(pencil.context, { kind: "freehand", trail: one }, VIEW);
    expect(pencil.notes, "freehand").toHaveLength(0);
  });

  /*
   * The pencil's trail is kept in font units so a stroke that was panned or
   * zoomed halfway through is still the stroke that was drawn, so it has to be
   * put back on the canvas to be shown.
   */
  it("puts the pencil's trail back on the canvas from font units", () => {
    const { context, notes } = recorder();
    drawFreehandPreview(
      context,
      {
        kind: "freehand",
        trail: [
          { x: 100, y: 100 },
          { x: 300, y: 500 },
        ],
      },
      VIEW,
    );
    expect(didOnce(notes, "moveTo")).toEqual([at(100, 100).x, at(100, 100).y]);
    expect(didOnce(notes, "lineTo")).toEqual([at(300, 500).x, at(300, 500).y]);
  });

  /** A cut is a line and not a shape, so the knife is dashed and never filled. */
  it("draws the knife as a dashed line and fills nothing", () => {
    const { context, notes } = recorder();
    drawKnifePreview(context, { kind: "knife", from: { x: 0, y: 0 }, to: { x: 100, y: 100 } });
    expect(did(notes, "setLineDash").some((one) => (one.args[0] as number[]).length > 0)).toBe(
      true,
    );
    expect(did(notes, "fill")).toHaveLength(0);
    expect(did(notes, "fillRect")).toHaveLength(0);
  });

  /*
   * Drawn from the box the shape will be built from rather than from the raw
   * drag, so what is on screen while the pointer is down is the shape that
   * lands when it comes up. A preview of the raw drag would jump on release.
   */
  it("previews the shape that would land, squared off when shift is held", () => {
    // A drag three times as wide as it is tall, so squaring it is unmissable.
    const drag = {
      kind: "shape",
      kind2: "rectangle",
      from: { x: 100, y: 100 },
      to: { x: 400, y: 200 },
    } as const;

    const spread = (): { width: number; height: number } => {
      const xs = laid.flatMap((one) => one.args.filter((_, index) => index % 2 === 0) as number[]);
      const ys = laid.flatMap((one) => one.args.filter((_, index) => index % 2 === 1) as number[]);
      return {
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      };
    };

    const loose = recorder();
    drawShapePreview(loose.context, drag as Drag & { kind: "shape" }, VIEW, {
      square: false,
      fromCentre: false,
    });
    const asDragged = spread();
    expect(did(loose.notes, "fill")).toHaveLength(1);
    expect(asDragged.width).toBeCloseTo(asDragged.height * 3, 0);

    const square = recorder();
    drawShapePreview(square.context, drag as Drag & { kind: "shape" }, VIEW, {
      square: true,
      fromCentre: false,
    });
    const squared = spread();
    expect(did(square.notes, "fill")).toHaveLength(1);
    expect(squared.width).toBeCloseTo(squared.height);
  });
});

describe("the pen's reach to the pointer", () => {
  const half = (): Glyph =>
    letter([{ closed: false, nodes: [node(100, 100), node(300, 100), node(300, 300)] }]);

  it("draws nothing at all when nothing is being drawn", () => {
    const { context, notes } = recorder();
    expect(store.getSnapshot().drawing).toBe(false);
    drawPenReach(context, half(), VIEW, { x: 500, y: 500 });
    expect(notes).toHaveLength(0);
  });

  it("draws nothing when there is no letter", () => {
    const { context, notes } = recorder();
    drawPenReach(context, null, VIEW, { x: 500, y: 500 });
    expect(notes).toHaveLength(0);
  });

  describe("with the pen part way through an outline", () => {
    const started = (): void => {
      store.startBlank();
      store.startDrawing();
    };

    it("runs a dashed line from the last point to the pointer", () => {
      started();
      const { context, notes } = recorder();
      const pointer = { x: 500, y: 500 };
      drawPenReach(context, half(), VIEW, pointer);
      expect(didOnce(notes, "moveTo")).toEqual([at(300, 300).x, at(300, 300).y]);
      expect(did(notes, "lineTo")[0].args).toEqual([pointer.x, pointer.y]);
      expect(did(notes, "setLineDash").some((one) => (one.args[0] as number[]).length > 0)).toBe(
        true,
      );
    });

    /**
     * The closing mark is the same size as the click that closes, and it fills.
     *
     * It used to grow by two pixels inside a seven-pixel window, which is a
     * signal you can only read if you already know to look for it. The target
     * and the mark being the same size is the part that was actually wrong.
     */
    it("grows the ring to the closing reach, and fills it, once a click would close", () => {
      started();
      const first = at(100, 100);

      const far = recorder();
      drawPenReach(far.context, half(), VIEW, { x: first.x + CLOSING_RADIUS + 5, y: first.y });
      const quiet = did(far.notes, "arc");
      expect(quiet).toHaveLength(1);
      expect(quiet[0].args[2]).toBe(HIT_RADIUS - 1);
      expect(did(far.notes, "fill")).toHaveLength(0);

      const near = recorder();
      drawPenReach(near.context, half(), VIEW, { x: first.x + CLOSING_RADIUS - 1, y: first.y });
      expect(didOnce(near.notes, "arc")[2]).toBe(CLOSING_RADIUS);
      expect(did(near.notes, "fill")).toHaveLength(1);
    });

    /*
     * Under three points there is nothing to close, so there is no ring to
     * offer -- two points closed is a line drawn twice with no area to fill.
     */
    it("offers no closing ring under three points", () => {
      started();
      const two = letter([{ closed: false, nodes: [node(100, 100), node(300, 100)] }]);
      const { context, notes } = recorder();
      drawPenReach(context, two, VIEW, at(100, 100));
      expect(did(notes, "arc")).toHaveLength(0);
    });
  });
});

describe("tracing one contour and one segment of it", () => {
  it("traces the whole contour, and closes it only when it is closed", () => {
    const shut = recorder();
    drawPathOutline(shut.context, box(), VIEW);
    expect(did(shut.notes, "bezierCurveTo")).toHaveLength(4);
    expect(did(shut.notes, "closePath")).toHaveLength(1);

    const open = recorder();
    drawPathOutline(open.context, { ...box(), closed: false }, VIEW);
    expect(did(open.notes, "bezierCurveTo")).toHaveLength(3);
    expect(did(open.notes, "closePath")).toHaveLength(0);
  });

  it("traces nothing for a contour that is not there, or has one point", () => {
    for (const contour of [undefined, { closed: false, nodes: [node(0, 0)] }]) {
      const { context, notes } = recorder();
      drawPathOutline(context, contour, VIEW);
      expect(notes).toHaveLength(0);
    }
  });

  /*
   * Cased, because half of this line runs along the edge of the letter: a
   * single stroke is half over the fill and half over the ground, and on a
   * white letter against a dark canvas half of it disappears whichever colour
   * it is. Two strokes of one path, the wider one underneath.
   */
  it("draws the segment under the pointer twice, the casing first and wider", () => {
    const { context, notes } = recorder();
    drawSegmentUnder(context, box(), 0, VIEW);
    const widths = did(notes, "set lineWidth").map((one) => one.args[0] as number);
    expect(did(notes, "stroke")).toHaveLength(2);
    expect(widths[0]).toBeGreaterThan(widths[1]);
  });

  it("draws no segment for a contour that is not there", () => {
    const { context, notes } = recorder();
    drawSegmentUnder(context, undefined, 0, VIEW);
    expect(notes).toHaveLength(0);
  });
});

describe("the faults, ringed where they are", () => {
  /*
   * A curve that turns without a point on it. The two handles carry the arc
   * past its own top, so the highest place on the outline is not a node -- and
   * a letter whose extremes are not points is one that will not hint.
   */
  const noExtreme = (): Contour => ({
    closed: true,
    nodes: [
      node(0, 0, { handleOut: { x: 0, y: 200 }, handleIn: { x: 0, y: -200 } }),
      node(300, 0, { handleIn: { x: 300, y: 200 }, handleOut: { x: 300, y: -200 } }),
    ],
  });

  it("rings a curve that turns with no point on it", () => {
    const { context, notes } = recorder();
    drawMarks(context, [noExtreme()], VIEW);
    expect(did(notes, "arc").length).toBeGreaterThan(0);
  });

  it("says nothing at all about a shape with no faults in it", () => {
    const { context, notes } = recorder();
    drawMarks(context, [box()], VIEW);
    expect(did(notes, "arc")).toHaveLength(0);
    expect(did(notes, "stroke")).toHaveLength(0);
  });

  /*
   * Nothing about a shape that is not finished. An open contour is half a
   * drawing and is missing most of its extremes by definition, so marks on one
   * are rings that all say "you have not finished" -- noise, and worse than
   * silence, because somebody who learns to ignore them stops seeing the real
   * ones.
   */
  /*
   * Two shapes, deliberately unlike each other: a hollow ring where an extreme
   * is missing, and a ring with a tick through it where a point is a hair off
   * smooth. A kink must never read as a missing extreme, so only the wider
   * rings carry a line through them.
   */
  const kinked = (): Contour => ({
    closed: true,
    nodes: [
      node(0, 0, { handleOut: { x: 100, y: 2 }, handleIn: { x: -100, y: 0 } }),
      node(300, 0),
      node(150, 300),
    ],
  });

  it("tells a kink from a missing extreme by its shape", () => {
    const { context, notes } = recorder();
    drawMarks(context, [kinked()], VIEW);
    const kinks = did(notes, "arc").filter((one) => one.args[2] === 7).length;
    const ticks = did(notes, "lineTo").length;
    expect(kinks).toBeGreaterThan(0);
    expect(ticks).toBe(kinks);
  });

  /*
   * And nothing at all about a drawing still being made -- of either kind. An
   * open contour is half a drawing and is missing most of its extremes by
   * definition, and a kink in one is a point that has not been placed yet.
   * Asked of both shapes, since each is suppressed by its own guard.
   */
  it("says nothing about a drawing still being made", () => {
    for (const shape of [noExtreme(), kinked()]) {
      const { context, notes } = recorder();
      drawMarks(context, [{ ...shape, closed: false }], VIEW);
      expect(did(notes, "arc")).toHaveLength(0);
      expect(did(notes, "stroke")).toHaveLength(0);
    }
  });
});

/**
 * Every colour on this canvas, read off the canvas.
 *
 * `readToken` reads a custom property from whatever element it is handed, and
 * the ground -- black type on white, or white on black -- is set on an ancestor
 * of the canvas rather than on the document. So a token read from the document
 * root is the other ground's value, and there is nothing about the result that
 * says so: it is a colour either way, and it looks like a colour.
 *
 * `drawPenReach` did exactly that for the pen's rubber band, so on the light
 * ground it drew the chrome purple over a near-white canvas -- the pale wash
 * `styles.css` darkens `--inspect` to avoid -- while the closing ring four
 * lines below it and the segment highlight beside it were properly dark. Three
 * marks the comments call deliberately one colour, and the odd one out was the
 * one you could not see.
 *
 * Asked of every drawing at once, because no single one of them can show it.
 */
describe("where the colours are read from", () => {
  function underTwoGrounds(draw: (context: CanvasRenderingContext2D) => void): string[] {
    const { context, notes, canvas } = recorder();
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", { documentElement: { nodeName: "HTML" } });
    vi.stubGlobal("getComputedStyle", (from: object) => ({
      getPropertyValue: () => (from === canvas ? "the canvas ground" : "THE ROOT GROUND"),
    }));
    try {
      draw(context);
    } finally {
      vi.unstubAllGlobals();
      vi.stubGlobal("Path2D", NotePath);
    }
    return colours(notes);
  }

  const anchors = [{ name: "top", x: 250, y: 700 }];
  const trail = [
    { x: 0, y: 0 },
    { x: 50, y: 50 },
  ];

  const everything: Array<[string, (context: CanvasRenderingContext2D) => void]> = [
    [
      "drawMetrics",
      (c) => drawMetrics(c, emptyTypeface(), letter(), VIEW, SIZE, [{ axis: "y", at: 500 }]),
    ],
    [
      "drawNodes",
      (c) =>
        drawNodes(c, [box()], VIEW, new Set(["0:0"]), {
          kind: "node",
          ref: { contour: 0, node: 0 },
        }),
    ],
    ["drawAnchors", (c) => drawAnchors(c, anchors, VIEW, { kind: "anchor", name: "top" })],
    [
      "drawMarquee",
      (c) => drawMarquee(c, { kind: "marquee", from: trail[0], to: trail[1], additive: false }, 0),
    ],
    ["drawLasso", (c) => drawLasso(c, { kind: "lasso", trail, additive: false }, 0)],
    [
      "drawKnifePreview",
      (c) => drawKnifePreview(c, { kind: "knife", from: trail[0], to: trail[1] }),
    ],
    ["drawFreehandPreview", (c) => drawFreehandPreview(c, { kind: "freehand", trail }, VIEW)],
    [
      "drawShapePreview",
      (c) =>
        drawShapePreview(
          c,
          { kind: "shape", kind2: "rectangle", from: trail[0], to: { x: 300, y: 300 } } as Drag & {
            kind: "shape";
          },
          VIEW,
          { square: false, fromCentre: false },
        ),
    ],
    ["drawPathOutline", (c) => drawPathOutline(c, box(), VIEW)],
    ["drawSegmentUnder", (c) => drawSegmentUnder(c, box(), 0, VIEW)],
    ["drawMarks", (c) => drawMarks(c, [box()], VIEW)],
    [
      "drawPenReach",
      (c) =>
        drawPenReach(
          c,
          letter([{ closed: false, nodes: [node(100, 100), node(300, 100), node(300, 300)] }]),
          VIEW,
          { x: 500, y: 500 },
        ),
    ],
  ];

  it("reads every one of them off the canvas and none off the document", () => {
    store.startBlank();
    store.startDrawing();
    for (const [name, draw] of everything) {
      const used = underTwoGrounds(draw);
      expect(used.length, `${name} set no colour at all`).toBeGreaterThan(0);
      for (const colour of used) {
        expect(colour, `${name} read a colour off the document`).not.toContain("THE ROOT GROUND");
      }
    }
  });

  /*
   * And the fallbacks agree with each other. A token has one colour, so two
   * readings of it must fall back to one colour too -- the pen's rubber band
   * fell back to a blue where the two marks beside it fall back to a purple,
   * which would have made three marks two colours the moment the property went
   * missing.
   */
  it("falls back to one colour per token, wherever it is read", () => {
    store.startBlank();
    store.startDrawing();
    const glyph = letter([
      { closed: false, nodes: [node(100, 100), node(300, 100), node(300, 300)] },
    ]);

    const reach = recorder();
    drawPenReach(reach.context, glyph, VIEW, { x: 500, y: 500 });
    const segment = recorder();
    drawSegmentUnder(segment.context, box(), 0, VIEW);

    // `--inspect` is the pen's colour, and both of these are the pen's marks.
    const inspect = colours(segment.notes).filter((one) => one.startsWith("#"));
    expect(colours(reach.notes)).toEqual(expect.arrayContaining(inspect.slice(-1)));
  });
});

describe("filling a letter", () => {
  it("fills the outlines it is given in the colour it is told", () => {
    const { context, notes } = recorder();
    drawContours(context, [box()], VIEW, { fill: "rgba(1, 2, 3, 0.5)" });
    expect(colours(notes)).toEqual(["rgba(1, 2, 3, 0.5)"]);
    expect(did(notes, "fill")).toHaveLength(1);
  });

  /*
   * Filled through the view's own transform rather than by moving every point,
   * which is what lets a `Path2D` be built once in font units.
   */
  it("draws through the view rather than moving the outline", () => {
    const { context, notes } = recorder();
    drawContours(context, [box()], VIEW, { fill: "#fff" });
    const applied = recorder();
    applyView(applied.context, VIEW);
    expect(did(notes, "setTransform")).toEqual(did(applied.notes, "setTransform"));
  });
});
