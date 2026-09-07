/**
 * What goes on the canvas, and in what order.
 *
 * The order is most of what this file decides, and all of it is invisible: a
 * canvas keeps no record of how it came to look the way it does, so drawing the
 * neighbours after the letter, or the highlight over the nodes, is not an error
 * anywhere -- it is a letter that looks slightly wrong to somebody who cannot
 * say why. The comments in `glyph-painting.ts` argue for each of these
 * orderings. These tests are those arguments, asked of the code.
 *
 * `paintGlyph` is a sequence of calls on a context, so the context here is a
 * fake that writes down what it was asked to do, and the drawing itself is
 * stood in for. That is the right level for this file: what a node looks like
 * is `glyph-canvas.ts`'s business, and what is drawn, in what order, and with
 * which arguments is this one's.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GlyphView } from "@/components/glyph-render";
import {
  emptyTypeface,
  type Contour,
  type Glyph,
  type GlyphNode,
  type Typeface,
} from "@/font/types";
import { store } from "@/state/useStore";
import type { Drag } from "./glyph-pointer";
import { paintGlyph, type Painting } from "./glyph-painting";

/*
 * Every `draw...` replaced by a note of the call, in one shared list so the
 * order across the two modules can be read as one sequence. Only the drawing is
 * stood in for: `withAlpha` and the rest are the real ones, so an argument
 * worked out here is worked out for real.
 */
const painted = vi.hoisted(() => ({ calls: [] as { drew: string; args: unknown[] }[] }));

function watching<T extends object>(real: T): T {
  const watched = { ...real } as Record<string, unknown>;
  for (const name of Object.keys(real)) {
    if (name.startsWith("draw")) {
      watched[name] = (...args: unknown[]) => {
        painted.calls.push({ drew: name, args });
      };
    }
  }
  return watched as T;
}

vi.mock("./glyph-canvas", async (importOriginal) => {
  return watching(await importOriginal<typeof import("./glyph-canvas")>());
});
vi.mock("./write-canvas", async (importOriginal) => {
  return watching(await importOriginal<typeof import("./write-canvas")>());
});

/** The names of what was drawn, in the order it went down. */
const order = (): string[] => painted.calls.map((one) => one.drew);
const drawnOnce = (name: string): unknown[] => {
  const found = painted.calls.filter((one) => one.drew === name);
  expect(found, `${name} was drawn ${found.length} times`).toHaveLength(1);
  return found[0].args;
};
const first = (name: string): number => order().indexOf(name);
const last = (name: string): number => order().lastIndexOf(name);

const VIEW: GlyphView = { scale: 0.5, originX: 100, originY: 400 };

const node = (x: number, y: number): GlyphNode => ({
  point: { x, y },
  handleIn: null,
  handleOut: null,
  type: "corner",
});

const stem = (): Contour => ({
  closed: true,
  nodes: [node(100, 0), node(200, 0), node(200, 700), node(100, 700)],
});

function letter(name: string, contours: Contour[] = [], over: Partial<Glyph> = {}): Glyph {
  return {
    name,
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

function typefaceOf(glyphs: Glyph[]): Typeface {
  const typeface = emptyTypeface();
  typeface.glyphs = glyphs;
  typeface.glyphIndex = new Map(glyphs.map((one, index) => [one.name, index]));
  return typeface;
}

/**
 * A context that draws nothing and remembers everything asked of it.
 *
 * Only `canvas` is real enough to matter: the colour tokens are read off it,
 * and `readToken` hands back its fallback outside a browser, so every colour
 * worked out here is the fallback -- which is what makes the alpha the only
 * part of a fill worth asserting on.
 */
function fakeContext(): CanvasRenderingContext2D {
  const context = new Proxy(
    { canvas: {} as HTMLCanvasElement },
    {
      get(target: Record<string, unknown>, key: string) {
        if (key in target) return target[key];
        if (key === "measureText") return () => ({ width: 0 });
        return () => undefined;
      },
      set(target: Record<string, unknown>, key: string, value: unknown) {
        target[key] = value;
        return true;
      },
    },
  );
  return context as unknown as CanvasRenderingContext2D;
}

function paint(over: Partial<Painting> = {}): void {
  painted.calls.length = 0;
  const glyph = over.glyph === undefined ? letter("a", [stem()]) : over.glyph;
  paintGlyph(fakeContext(), {
    typeface: typefaceOf(glyph ? [glyph] : []),
    glyph,
    state: store.getSnapshot(),
    view: VIEW,
    size: { width: 800, height: 600 },
    neighbours: { before: [], after: [] },
    hover: null,
    at: null,
    drag: null,
    catching: null,
    modifiers: { square: false, fromCentre: false },
    box: null,
    grip: null,
    ...over,
  });
}

beforeEach(() => {
  store.startBlank();
  store.setTool("select");
  store.setSelectedNodes([]);
  store.setHighlightPath(null);
});

describe("what a letter is made of on the canvas", () => {
  it("draws the metrics under everything, and the letter over them", () => {
    paint();
    expect(first("drawMetrics")).toBe(0);
    expect(first("drawContours")).toBeGreaterThan(first("drawMetrics"));
  });

  /*
   * The metrics and the guides are the one thing worth drawing with no letter
   * to draw: somebody setting their lines up before there is anything to put
   * between them is looking at an empty canvas on purpose.
   */
  it("still draws the metrics when there is no letter at all", () => {
    paint({ glyph: null });
    expect(order()).toEqual(["drawMetrics"]);
  });

  it("draws the nodes over the letter, and the anchors over those", () => {
    paint({ glyph: letter("a", [stem()], { anchors: [{ name: "top", x: 250, y: 700 }] }) });
    expect(last("drawContours")).toBeLessThan(first("drawNodes"));
    expect(first("drawNodes")).toBeLessThan(first("drawAnchors"));
  });

  it("draws the ring marks only when they are asked for", () => {
    paint();
    expect(order()).not.toContain("drawMarks");
    store.setMarks(true);
    paint();
    expect(order()).toContain("drawMarks");
  });
});

/**
 * The neighbours, which are there to be measured against and not edited.
 *
 * A sidebearing cannot be judged on a letter by itself, so the letters either
 * side are drawn at their real advances. Flat, and underneath: anything that
 * made them look editable would be a promise this view does not keep, since
 * clicking one selects nothing.
 */
describe("the letters standing either side", () => {
  const before = [{ glyph: letter("n", [stem()]), x: -600 }];
  const after = [{ glyph: letter("o", [stem()]), x: 600 }];

  it("draws them before the letter, so they can never sit on top of it", () => {
    paint({ neighbours: { before, after } });
    const fills = painted.calls.filter((one) => one.drew === "drawContours");
    expect(fills).toHaveLength(3);
    // The last of the three is the letter being edited, at its own origin.
    expect((fills[2].args[2] as GlyphView).originX).toBe(VIEW.originX);
  });

  it("shifts each by its own advance rather than drawing them on top", () => {
    paint({ neighbours: { before, after } });
    const origins = painted.calls
      .filter((one) => one.drew === "drawContours")
      .map((one) => (one.args[2] as GlyphView).originX);
    expect(origins).toEqual([
      VIEW.originX + -600 * VIEW.scale,
      VIEW.originX + 600 * VIEW.scale,
      VIEW.originX,
    ]);
  });

  /*
   * Muted, and more muted than the letter itself. The exact colour is a token
   * this test cannot see, but the alpha is worked out here and is the whole of
   * what makes them recede.
   */
  it("draws them fainter than the letter being edited", () => {
    paint({ neighbours: { before, after } });
    const alphas = painted.calls
      .filter((one) => one.drew === "drawContours")
      .map((one) =>
        Number(/([\d.]+)\)$/.exec(String((one.args[3] as { fill: string }).fill))?.[1]),
      );
    expect(alphas[0]).toBe(alphas[1]);
    expect(alphas[0]).toBeLessThan(alphas[2]);
  });

  it("gives them no nodes, no handles and no anchors of their own", () => {
    paint({ neighbours: { before, after } });
    expect(painted.calls.filter((one) => one.drew === "drawNodes")).toHaveLength(1);
    expect(painted.calls.filter((one) => one.drew === "drawAnchors")).toHaveLength(1);
  });
});

describe("a letter built out of other letters", () => {
  const acute = letter("acute", [
    { closed: true, nodes: [node(0, 600), node(60, 700), node(0, 700)] },
  ]);

  function composite(): { glyph: Glyph; typeface: Typeface } {
    const glyph = letter("aacute", [stem()], {
      components: [{ glyphName: "acute", transform: { a: 1, b: 0, c: 0, d: 1, dx: 120, dy: 0 } }],
    } as Partial<Glyph>);
    return { glyph, typeface: typefaceOf([glyph, acute]) };
  }

  /*
   * What the components contribute is drawn but not offered for editing: those
   * outlines belong to another glyph, and changing them there is what makes
   * building letters from parts worth doing.
   */
  it("draws what the parts contribute, apart from the letter's own outline", () => {
    const { glyph, typeface } = composite();
    paint({ glyph, typeface });
    const fills = painted.calls.filter((one) => one.drew === "drawContours");
    expect(fills).toHaveLength(2);
    // The parts first, then the letter's own -- one contour each.
    expect(fills[0].args[1] as Contour[]).toHaveLength(1);
    expect(fills[1].args[1] as Contour[]).toBe(glyph.contours);
  });

  it("draws nothing extra for a letter with no parts", () => {
    paint();
    expect(painted.calls.filter((one) => one.drew === "drawContours")).toHaveLength(1);
  });

  /**
   * The one that washed out the accented alphabet.
   *
   * Where the family settings change a letter's shape, the result is drawn
   * behind the outline being edited so the effect stays visible, and the
   * outline above drops to half opacity to let it through. Whether they change
   * anything used to be inferred from whether resolving handed back the very
   * array it had composed -- true of a letter drawn from its own outlines, and
   * never true of one built from parts, because composing makes a new array
   * every time.
   *
   * So every composite read as reshaped with nothing set: a ghost of itself
   * behind it, and the letter at half opacity above. Most of the accented
   * alphabet, on a font nobody had touched a slider on.
   */
  it("does not call a composite reshaped when no parameter has moved", () => {
    const { glyph, typeface } = composite();
    paint({ glyph, typeface });
    const fills = painted.calls.filter((one) => one.drew === "drawContours");
    const alpha = (which: number) =>
      Number(/([\d.]+)\)$/.exec(String((fills[which].args[3] as { fill: string }).fill))?.[1]);

    // Two layers, not three: the parts, then the letter. No ghost.
    expect(fills).toHaveLength(2);
    // And the letter drawn at full strength rather than let through.
    expect(alpha(1)).toBe(0.92);
  });

  /*
   * And when a parameter really has moved, the ghost is right to be there --
   * on a composite as much as on any other letter.
   */
  it("draws the reshaped letter behind when a parameter has moved", () => {
    const { glyph, typeface } = composite();
    glyph.params = { weight: 40 };
    paint({ glyph, typeface });
    const fills = painted.calls.filter((one) => one.drew === "drawContours");
    expect(fills).toHaveLength(3);
    const alpha = Number(
      /([\d.]+)\)$/.exec(String((fills[2].args[3] as { fill: string }).fill))?.[1],
    );
    expect(alpha).toBe(0.5);
  });
});

describe("what the tools show", () => {
  /*
   * Adding a point to an existing curve is a click in the middle of nowhere
   * unless the thing about to be cut is shown: there is no node there to aim
   * at, so without this a person has to click and look at what happened.
   */
  it("lights the segment a point would go on, before the nodes go over it", () => {
    store.setTool("addPoint");
    paint({ at: { x: VIEW.originX + 150 * VIEW.scale, y: VIEW.originY } });
    expect(order()).toContain("drawSegmentUnder");
    expect(first("drawSegmentUnder")).toBeLessThan(first("drawNodes"));
  });

  it("lights nothing for a tool that does not edit what is there", () => {
    store.setTool("select");
    paint({ at: { x: VIEW.originX + 150 * VIEW.scale, y: VIEW.originY } });
    expect(order()).not.toContain("drawSegmentUnder");
  });

  it("lights nothing when the pointer is off the canvas", () => {
    store.setTool("addPoint");
    paint({ at: null });
    expect(order()).not.toContain("drawSegmentUnder");
  });

  /*
   * The pen draws to wherever the pointer is, so a segment can be seen before
   * it is placed. Every other tool drew a live preview and this one did not:
   * the only way to see where a segment would land was to place it and undo.
   */
  it("draws the pen's reach to the pointer, but not during a drag", () => {
    store.setTool("pen");
    const pointer = { x: 300, y: 300 };
    paint({ at: pointer });
    expect(order()).toContain("drawPenReach");

    paint({ at: pointer, drag: { kind: "knife", from: pointer, to: pointer } as Drag });
    expect(order()).not.toContain("drawPenReach");
  });

  it("draws each drag's own preview and no other", () => {
    const from = { x: 100, y: 100 };
    const to = { x: 200, y: 200 };
    for (const [drag, expected] of [
      [{ kind: "marquee", from, to, additive: false }, "drawMarquee"],
      [{ kind: "shape", kind2: "rectangle", from, to }, "drawShapePreview"],
      [{ kind: "knife", from, to }, "drawKnifePreview"],
      [{ kind: "freehand", trail: [from, to] }, "drawFreehandPreview"],
      [{ kind: "lasso", trail: [from, to], additive: false }, "drawLasso"],
    ] as const) {
      paint({ drag: drag as Drag });
      const previews = order().filter((one) =>
        [
          "drawMarquee",
          "drawShapePreview",
          "drawKnifePreview",
          "drawFreehandPreview",
          "drawLasso",
        ].includes(one),
      );
      expect(previews, expected).toEqual([expected]);
    }
  });

  /*
   * A shape reads its modifiers from the drag rather than from the moment it is
   * let go of, and this is where they are handed on.
   */
  it("hands a shape the modifiers held during the drag", () => {
    const held = { square: true, fromCentre: true };
    paint({
      drag: { kind: "shape", kind2: "rectangle", from: { x: 0, y: 0 }, to: { x: 9, y: 9 } } as Drag,
      modifiers: held,
    });
    expect(drawnOnce("drawShapePreview")[3]).toBe(held);
  });
});

/**
 * A written letter shows one set of points or the other, never both.
 *
 * The contours of a written letter are what the pen swept, so their points were
 * placed by the fitter and mean nothing to the person who wrote it. Shown while
 * a write tool is in hand they are two hundred dots over the three handles that
 * actually do something.
 */
describe("writing, where the points on screen are not the outline's", () => {
  it("shows the outline's points with an ordinary tool, and no pen handles", () => {
    store.setTool("select");
    paint();
    expect(order()).toContain("drawNodes");
    expect(drawnOnce("drawWritten")[3]).toMatchObject({ handles: false });
  });

  it("shows the pen's handles with a write tool, and none of the outline's", () => {
    for (const tool of ["skeleton", "nib", "skeletonFreehand"] as const) {
      store.setTool(tool);
      store.setMarks(true);
      paint({ glyph: letter("a", [stem()], { anchors: [{ name: "top", x: 250, y: 700 }] }) });
      expect(order(), tool).not.toContain("drawNodes");
      expect(order(), tool).not.toContain("drawMarks");
      expect(order(), tool).not.toContain("drawAnchors");
      expect(drawnOnce("drawWritten")[3]).toMatchObject({ handles: true });
    }
    store.setMarks(false);
  });

  /*
   * The lit stop is handed on so the ellipse that was picked can show it. There
   * is nothing else in the paint that says which one is chosen.
   */
  it("says which pen stop is lit", () => {
    store.setTool("nib");
    store.pickStop(0, 1);
    paint();
    expect(drawnOnce("drawWritten")[3]).toMatchObject({ selected: store.getSnapshot().stop });
  });
});

describe("the path the list is pointing at", () => {
  /*
   * Under the nodes so it never hides one, and as the outline rather than a
   * box: which of two nested contours an `o` row means is the whole question,
   * and a box round either covers both.
   */
  it("draws it over the letter but under the nodes", () => {
    store.setHighlightPath(0);
    paint();
    expect(order()).toContain("drawPathOutline");
    expect(last("drawContours")).toBeLessThan(first("drawPathOutline"));
    expect(first("drawPathOutline")).toBeLessThan(first("drawNodes"));
  });

  it("draws the one the list means, and nothing when it means none", () => {
    const two = letter("a", [
      stem(),
      { closed: true, nodes: [node(300, 0), node(400, 0), node(400, 700)] },
    ]);
    store.setHighlightPath(1);
    paint({ glyph: two });
    expect(drawnOnce("drawPathOutline")[1]).toBe(two.contours[1]);

    store.setHighlightPath(null);
    paint({ glyph: two });
    expect(order()).not.toContain("drawPathOutline");
  });

  /*
   * A row can outlive the contour it points at -- delete a path while the list
   * still has it lit -- and the index then names nothing. Handed on as it is,
   * because the drawing turns an absent contour away at its own door.
   */
  it("survives a row pointing at a contour that is no longer there", () => {
    store.setHighlightPath(4);
    expect(() => paint()).not.toThrow();
    expect(drawnOnce("drawPathOutline")[1]).toBeUndefined();
  });
});
