/**
 * Taking material away.
 *
 * Everything else in this half of the application adds ink: a spine is drawn,
 * a pen is swept along it, serifs and balls are laid over the ends. That is a
 * complete description of a great many typefaces and it cannot reach a great
 * many others -- the ones whose character comes from what has been removed. A
 * slot through a stem, a saw cut along an edge, a groove running down the
 * middle of every stroke, a counter that is a diamond rather than a hole: none
 * of those is a shape a pen can make, at any weight or any angle.
 *
 * So this is a second layer, and it runs after the first. The strokes are swept
 * exactly as they always were, fused into one shape, and then material is taken
 * out of that shape. Which means every control in the rest of the panel still
 * works: change the weight and the letter is redrawn thinner and the same slots
 * are cut through the thinner letter, because a slot is a description too.
 *
 * Sizes are in stem widths rather than font units, for the reason the serif
 * learned the hard way: a slot forty units wide is a groove on a display face
 * and a letter in two halves on a hairline. In stems it means the same thing
 * everywhere, and a whole family cut from one description stays cut the same
 * way at every weight.
 */

import { intersect, loaded, pieces, subtract, unite, type Roles } from "@/font/boolean";
import {
  contourArea,
  contourContainsPoint,
  contoursBounds,
  flattenContour,
  rayHitDistance,
  reverseContour,
  type Bounds,
} from "@/font/geometry";
import { contoursIntersect } from "@/font/outline";
import type { Contour, GlyphNode, Vec2 } from "@/font/types";
import { alongSpine, spineLength } from "./shapes";
import { eroded, outlined } from "./cast";
import { penReach, sweep } from "./sweep";
import type { Style } from "./style";
import type { Spine, SpineSegment, Stroke } from "./types";

/*
 * The description of a cut lives a layer down, because a font somebody opened
 * and a pile of drawings somebody made elsewhere are cut by the same one. It
 * is handed straight back out again, so everything that already reaches for it
 * here still finds it here.
 */
import {
  anyCut,
  CUT_NAMES,
  FROM_SKELETON,
  NO_CUTS,
  noCuts,
  type CutName,
  type Cuts,
  type Edge,
  type MotifShape,
} from "@/font/cuts";

export {
  anyCut,
  CUT_NAMES,
  FROM_SKELETON,
  NO_CUTS,
  noCuts,
  type CutName,
  type Cuts,
  type Edge,
  type MotifShape,
};

/**
 * Whether any of the cuts that are on can do anything to this ink.
 *
 * Which is not the same question, and the difference is a whole boolean. An
 * imported letter with only the breaks switched on is reached by nothing: a
 * break needs a skeleton and there is none. Fusing it anyway would leave the
 * drawing identical and its outline rewritten, which is work done to no end
 * and a letter that reports itself as having changed when it has not.
 */
export function reaches(cuts: Cuts | undefined, strokes: Stroke[]): boolean {
  if (cuts === undefined) return false;
  return CUT_NAMES.some(
    (name) => cuts[name].on && (strokes.length > 0 || !FROM_SKELETON.has(name)),
  );
}

// ---------------------------------------------------------------------------
// Doing it
// ---------------------------------------------------------------------------

/** A letter that has been through the cuts, and what they did to it. */
/**
 * Everything a cut needs to know about the face it is cutting.
 *
 * Not a `Style`. A cut is described in stem widths so that one description
 * holds at every weight, and in the font's own heights so that a band lines up
 * across a word -- and both of those are numbers, not a way of drawing. A
 * letter somebody imported, or a drawing off a pile of SVGs, has no pen and no
 * parts and can still be cut; all it has to do is say how thick its stems are
 * and where its lines run. `scaleOf` reads it off a face that has one, and
 * `measuredScale` measures it off outlines that do not.
 */
export interface CutScale {
  /** The stem width, which every size here is a multiple of. */
  stem: number;
  ascender: number;
  descender: number;
  xHeight: number;
  /** How far the face leans, in degrees, when it is one drawn here. */
  slant?: number;
}

/** The scale of a face that was drawn here, which knows its own pen. */
export function scaleOf(style: Style): CutScale {
  return {
    stem: style.pen.weight,
    ascender: style.metrics.ascender,
    descender: style.metrics.descender,
    xHeight: style.metrics.xHeight,
    slant: style.metrics.slant,
  };
}

export interface Cutting {
  contours: Contour[];
  /**
   * How many separate pieces the letter came out in, and how many it went in
   * as, when anything was cut at all.
   *
   * Reported rather than judged. A stencil face is letters in pieces and that
   * is the whole point of it; an `e` that has quietly fallen in half while the
   * rest of the font is fine is a fault. Nothing here can tell those apart,
   * and the person turning the slider can tell them apart instantly -- so the
   * count goes to the warnings and the decision stays where it belongs.
   */
  cut?: { pieces: number; was: number };
  /**
   * Where the chamfer cut corners off, when it did: each corner as it stood.
   * The spur grows its point out of the corner the chamfer cut, rather than
   * one out of each of the two it left.
   */
  chamfered?: Vec2[];
}

/**
 * The letter with the cuts taken out of it.
 *
 * Given the ink as it was swept and the strokes it was swept from, because two
 * of the six need the skeleton and not the outline: the groove is the skeleton
 * swept again, and the gaps are where the skeleton runs into itself.
 *
 * Returns the ink untouched when nothing is switched on, and when the boolean
 * library has not arrived yet. The second is the honest answer rather than a
 * wrong one: an uncut letter for a moment is a letter, and a letter cut with a
 * tool that is not there is not.
 *
 * `roles` says whether the ink can be believed about which of its contours are
 * counters. Anything swept here can: the sweep winds a counter against the ink
 * on purpose. A letter somebody drew elsewhere and brought in cannot, so its
 * shape is read instead -- see `Roles`. It only matters for the first fuse,
 * because everything after it comes back out of the boolean correctly wound.
 *
 * The order is not arbitrary. The counter motif goes first because it is the
 * only one that reads the letter's holes, and every cut after it makes more.
 * The chamfer goes last because it is the only one that reads the letter's
 * corners, and every cut before it makes more.
 */
export function cutInk(
  ink: Contour[],
  strokes: Stroke[],
  scale: CutScale,
  cuts: Cuts,
  roles: Roles = "winding",
  // What the cast did to the letter first, when it went first: see `Cast`.
  cast?: CastFirst,
): Cutting {
  if (!reaches(cuts, strokes) || ink.length === 0 || !loaded()) return { contours: ink };

  let shape = unite(ink, roles, "whole");
  const stem = Math.max(scale.stem, 1);
  // Counted here rather than anywhere else, because here it is free: the
  // letter has just been fused, and counting its pieces is reading the
  // contours it already has rather than doing the geometry again.
  const was = pieces(shape);
  const smallest = Math.min(
    Infinity,
    ...shape.map((contour) => contourArea(contour)).filter((area) => area > 0),
  );

  if (cuts.motif.on) shape = motifCut(shape, cuts.motif, stem);

  /*
   * Four of the six are one subtraction between them.
   *
   * A boolean is the expensive thing here by a long way -- the tools are a
   * handful of triangles and rectangles, and taking them out of a letter costs
   * more than working out where they go. Four of the cuts are plain
   * subtractions that do not read the letter after each other, so they are one
   * knife made of four sets of pieces and one cut, rather than four of each.
   *
   * The two that are left out cannot join in. The counter motif goes first
   * because it is the only one that reads the letter's holes, and every cut
   * after it makes more. The chamfer goes last because it is the only one that
   * reads the letter's corners, and every cut before it makes more.
   */
  const bounds = contoursBounds(shape);
  const knife: Contour[] = [];
  // The straight knives, whose edges can shave a sliver off a stroke they
  // cross at a slant: see `withoutSlivers`.
  const straight: Contour[] = [];
  if (cuts.slot.on) straight.push(...slotTool(bounds, cuts.slot, stem, scale));
  if (cuts.tooth.on) straight.push(...toothTool(bounds, cuts.tooth, stem, scale));
  const breaks = cuts.split.on
    ? splitTool(strokes, cuts.split, stem, scale.xHeight, cast)
    : { knives: [], lips: [] };
  straight.push(...breaks.knives);
  if (cuts.inline.on) knife.push(...inlineTool(shape, strokes, cuts.inline, stem));
  knife.push(...straight);
  /*
   * Fused here rather than left to the subtraction, when there is more than
   * one piece.
   *
   * The subtraction fuses a knife whose pieces touch, and on one arrangement
   * it gets that wrong: the groove of a round bowl runs down the stem it is
   * drawn against, a hair from the stem's own groove, and on a light Slab b
   * and g the knife came out of that fuse such that taking it away filled
   * the whole bowl in -- counter, groove and all. Fused the way the letter
   * itself is fused first, the same knife cuts what it should.
   */
  if (knife.length > 1) knife.splice(0, knife.length, ...unite(knife, "winding"));
  shape = take(shape, knife);
  /*
   * The lips after, and only if they leave the letter in no more pieces: a
   * lip is a sliver off the side of a stem, and one that breaks something
   * off, leaves a speck or ties a loop has cut where it should not. Not on a
   * leaning face either: the skeleton is drawn upright and leaned after, and
   * on a script the start of each arch was left as a chip the pen's own
   * pressure then broke off.
   */
  if (breaks.lips.length > 0 && Math.abs(scale.slant ?? 0) < 3) {
    const trimmed = take(shape, breaks.lips);
    const specks = (contours: Contour[]) =>
      contours.filter((contour) => Math.abs(contourArea(contour)) < stem * stem * 0.1).length;
    if (
      pieces(trimmed) <= pieces(shape) &&
      specks(trimmed) <= specks(shape) &&
      !trimmed.some((contour) => contoursIntersect([contour]))
    ) {
      shape = trimmed;
    }
  }
  shape = withoutSlivers(shape, straight, Math.min(stem * 0.07, hairlineOf(strokes, stem) * 0.3));

  const chamfered: Vec2[] = [];
  if (cuts.chamfer.on) shape = take(shape, chamferTool(shape, cuts.chamfer, stem, chamfered));
  /*
   * How thin the letter's own thinnest stroke is, where it was drawn here:
   * a splinter is thinner than anything the letter means to draw, and on a
   * contrast face that is a good deal less than a share of the stem.
   */
  const hairline = hairlineOf(strokes, stem);
  shape = withoutCrumbs(shape, stem, smallest, hairline);
  /*
   * And no outline left crossing itself. A chamfer laid across the corner
   * where an outline starts, or a tooth across one of a few points, can
   * leave a loop of a unit or two tied in it -- nothing on the page, and a
   * fault in the file; one more union resolves it.
   */
  if (shape.some((contour) => contoursIntersect([contour])))
    shape = unite(shape, "winding", "whole");
  shape = shape.map(withoutHairs);

  return {
    contours: shape,
    cut: { pieces: pieces(shape), was },
    ...(chamfered.length > 0 ? { chamfered } : {}),
  };
}

/**
 * Where the split cuts, and which pairs of strokes it parts, keyed by
 * `pairKey`: nothing when the split is off.
 *
 * For the weld, which fills the same joins the split opens and so has to know
 * which of them are open: a fillet grown across a break stood in the gap as a
 * hook either side of it.
 */
export function breaksIn(
  strokes: Stroke[],
  scale: CutScale,
  cuts: Cuts | undefined,
): { knives: Contour[]; parted: Set<string> } {
  if (!cuts?.split.on || strokes.length < 2 || !loaded()) {
    return { knives: [], parted: new Set() };
  }
  const { knives, parted } = splitPlan(strokes, cuts.split, Math.max(scale.stem, 1), scale.xHeight);
  return { knives, parted };
}

/**
 * How many separate pieces a cut letter falls into.
 *
 * Asked of the finished ink, so it is the same count whether the letter was
 * cut or not: one for most letters, two for an i or a j or a colon, and more
 * than it started with when a cut has gone through.
 */
export function piecesOf(ink: Contour[]): number {
  if (ink.length === 0) return 0;
  if (!loaded()) return pieces(ink);
  return pieces(unite(ink, "winding", "whole"));
}

/**
 * An outline without the hairs of no width a boolean can leave on it: a
 * straight run out from a point and straight back along itself, as the top
 * of an e's bar came back from a slanted slot. Nothing on the page and a
 * fault in the file, and the next boolean handed one can answer nonsense.
 * The point the run turns back at goes, until no run doubles back.
 */
function withoutHairs(contour: Contour): Contour {
  let nodes = contour.nodes;
  for (let pass = 0; pass < 8 && nodes.length > 3; pass++) {
    const count = nodes.length;
    const drop = new Set<number>();
    for (let index = 0; index < count; index++) {
      const before = nodes[(index - 1 + count) % count];
      const here = nodes[index];
      const after = nodes[(index + 1) % count];
      if (before.handleOut || here.handleIn || here.handleOut || after.handleIn) continue;
      const a = away(before.point, here.point);
      const b = away(here.point, after.point);
      if (!a || !b) continue;
      // Straight back: the two runs point opposite ways along one line.
      if (a.x * b.x + a.y * b.y < -0.9999) drop.add(index);
    }
    if (drop.size === 0 || count - drop.size < 3) break;
    nodes = nodes.filter((_, index) => !drop.has(index));
  }
  return nodes === contour.nodes ? contour : { ...contour, nodes };
}

/** The width of the thinnest stroke a letter draws, or the stem without strokes. */
function hairlineOf(strokes: Stroke[], stem: number): number {
  return Math.min(
    stem,
    ...strokes.map(
      (stroke) => stroke.pen.weight * (1 - Math.min(Math.max(stroke.pen.contrast, 0), 0.95)),
    ),
  );
}

/**
 * The letter less the slivers a knife shaved off it: ink thinner than twice
 * `reach` standing where a knife passed.
 *
 * A band laid across a stroke at a shallow angle leaves a wedge along the
 * stroke's edge that tapers to nothing -- the top of the crossbar of an A
 * under a slanted slot, the top of the arm of an r, the bar of an e -- a
 * whisker of ink that is part of a piece, so no sweep for crumbs finds it.
 * The letter is opened -- shrunk by the reach and grown back -- and what does
 * not come back is thinner than twice the reach. Of that, only what lies
 * against a knife goes, and only what is more than the rounding of a corner:
 * the rest of the letter is left exactly as it was.
 */
function withoutSlivers(shape: Contour[], knife: Contour[], reach: number): Contour[] {
  if (knife.length === 0 || reach < 1) return shape;
  const opened = outlined(eroded(shape, reach), reach);
  const residue = subtract(shape, opened, "winding").filter(
    (one) => contourArea(one) > reach * reach * 2,
  );
  if (residue.length === 0) return shape;
  const boxes = knife.map((one) => contoursBounds([one]));
  const near = residue.filter((one) => {
    const box = contoursBounds([one]);
    return boxes.some(
      (other) =>
        other.xMin - reach * 2 < box.xMax &&
        other.xMax + reach * 2 > box.xMin &&
        other.yMin - reach * 2 < box.yMax &&
        other.yMax + reach * 2 > box.yMin,
    );
  });
  if (near.length === 0) return shape;
  const trimmed = subtract(shape, near, "winding");
  // Never more than slivers: a letter that lost a fifth of itself was opened
  // wrongly, and is handed back as the knife left it.
  const inkOf = (contours: Contour[]) =>
    contours.reduce((total, contour) => total + contourArea(contour), 0);
  return inkOf(trimmed) > inkOf(shape) * 0.97 ? trimmed : shape;
}

/**
 * The letter with the chips a cut knocked off it swept away.
 *
 * A band set at the font's own heights passes a hair under the top of an r's
 * terminal or the spur of an s, and what it leaves above itself is a speck of
 * ink standing on its own a few units across; a saw leaves the same at the
 * end of an edge, and a break at a crowded join. None of them was drawn and
 * none of them reads as anything but dirt on the page -- the stencil letters
 * the cuts are for are in pieces, but in pieces a hand could have cut out.
 *
 * So a piece that has come out smaller than a fifth of a stem square is taken
 * away, with any hole in it. Never one as large as the smallest piece the
 * letter went in with, so the dot of an i, the full stop and a heavy face's
 * tittle are never mistaken for a chip.
 */
function withoutCrumbs(
  shape: Contour[],
  stem: number,
  smallest: number,
  hairline = stem,
): Contour[] {
  const floor = Math.min(stem * stem * 0.2, smallest * 0.5);
  const areas = shape.map((contour) => contourArea(contour));
  /*
   * And a sliver, however long: a band laid across a curve at a slant shaves
   * a long wedge off it that tapers to nothing at both ends -- the foot of an
   * o, the top of an a -- and with some length to it, it was large enough to
   * pass as a piece. A piece narrower all through than a hairline is a
   * splinter, not part of the letter -- measured across the narrowest way it
   * lies, so a hairline cut short is still a piece. Never the whole letter,
   * which a hairline face may be. And never as thick as the letter's own
   * hairline: on a Formal Script a hairline is well under a third of a stem,
   * and every slot through one was taken for a splinter -- the m, the s and
   * the g lost most of their strokes.
   */
  const solids = areas.filter((area) => area > 0).length;
  const thin = (contour: Contour, area: number): boolean =>
    solids >= 2 &&
    area < stem * stem * 1.5 &&
    breadth(flattenContour(contour, 12)) < Math.min(stem * 0.35, hairline * 0.6);
  const crumbs = shape.filter(
    (contour, index) => areas[index] > 0 && (areas[index] < floor || thin(contour, areas[index])),
  );
  if (crumbs.length === 0) return shape;
  return shape.filter((contour, index) => {
    if (crumbs.includes(contour)) return false;
    // A hole goes with the crumb it is in.
    if (areas[index] >= 0) return true;
    const inside = contour.nodes[0]?.point;
    return !inside || !crumbs.some((crumb) => contourContainsPoint(crumb, inside));
  });
}

/**
 * How wide a shape is the narrowest way across: the least distance between
 * two parallel lines that hold it, taken over its convex hull's edges.
 */
function breadth(points: Vec2[]): number {
  const hull = convexHull(points);
  if (hull.length < 3) return 0;
  let least = Infinity;
  for (let index = 0; index < hull.length; index++) {
    const a = hull[index];
    const b = hull[(index + 1) % hull.length];
    const run = distance(a, b);
    if (run < 1e-9) continue;
    let most = 0;
    for (const point of hull) {
      most = Math.max(
        most,
        Math.abs((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)) / run,
      );
    }
    least = Math.min(least, most);
  }
  return least;
}

/** The convex hull of some points, anticlockwise (Andrew's monotone chain). */
function convexHull(points: Vec2[]): Vec2[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return sorted;
  const cross = (o: Vec2, a: Vec2, b: Vec2) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec2[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0)
      lower.pop();
    lower.push(point);
  }
  const upper: Vec2[] = [];
  for (let index = sorted.length - 1; index >= 0; index--) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0)
      upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function take(shape: Contour[], tool: Contour[]): Contour[] {
  if (tool.length === 0) return shape;
  const cut = subtract(shape, tool, "winding");
  /*
   * A subtraction can take no more than the knife covers. When the boolean
   * library loses its way on a knife that grazes an edge it can hand back a
   * letter missing a whole stroke -- the stem of a hairline Sans a went with
   * a sliver cut beside its foot. Then the pieces are taken one at a time,
   * and one that does the same on its own is left out.
   */
  const ink = (contours: Contour[]) =>
    contours.reduce((total, contour) => total + contourArea(contour), 0);
  // Counted piece by piece, overlaps twice: a bound, and no boolean.
  const most = (knife: Contour[]) =>
    knife.reduce((total, contour) => total + Math.abs(contourArea(contour)), 0) * 1.02 + 1;
  const before = ink(shape);
  if (before - ink(cut) <= most(tool)) return cut;
  let left = shape;
  for (const piece of tool) {
    const next = subtract(left, [piece], "winding");
    if (ink(left) - ink(next) <= most([piece])) left = next;
  }
  return left;
}

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

/**
 * Bands across the letter, at heights the whole font agrees on.
 *
 * Set against the font's own vertical extent rather than against each letter's
 * bounds, which is the difference between a face and a decoration. Measured
 * per letter, the bands landed at different heights on an H and an o and a
 * comma, so they never lined up across a word -- and a full stop, being one
 * stem tall, was handed two bands of its own and came back as three crumbs.
 * Measured against the font, every letter is cut at the same heights, a word
 * reads as one striped block, and the letters too short to reach a band are
 * simply not cut.
 *
 * Each band is drawn long enough to cross the letter whatever angle it is
 * turned to, and turned about the middle of the letter rather than about its
 * own end, so raising the angle pivots the field instead of swinging it off
 * the letter. Angled, they cannot line up across a word: a letter is drawn
 * without knowing where in the line it will stand, so there is no shared
 * origin for the angle to turn about. Square, they always do.
 */
function slotTool(bounds: Bounds, slot: Cuts["slot"], stem: number, scale: CutScale): Contour[] {
  const { ascender, descender } = scale;
  const height = ascender - descender;
  const count = Math.max(1, Math.round(slot.count));
  const thickness = slot.width * stem;
  if (height <= 0 || thickness <= 0) return [];

  // The field the bands are spread through, with the ends of the font left
  // alone: a slot through the very top of an l is a nick out of its head.
  const clear = Math.min(Math.max(slot.inset, 0), 0.45) * height;
  const from = descender + clear;
  const room = height - clear * 2;
  if (room <= 0) return [];

  const centre = { x: (bounds.xMin + bounds.xMax) / 2, y: (ascender + descender) / 2 };
  // Long enough that a band turned to any angle still crosses the letter.
  const reach = Math.hypot(bounds.xMax - bounds.xMin, height);
  const turn = (slot.angle * Math.PI) / 180;

  const bands: Contour[] = [];
  for (let index = 0; index < count; index++) {
    const at = from + (room * (index + 0.5)) / count;
    bands.push(
      turned(rect(centre.x - reach, at - thickness / 2, reach * 2, thickness), centre, turn),
    );
  }
  return bands;
}

/**
 * A comb of notches along one edge.
 *
 * Each notch is a triangle whose base is well outside the letter and whose
 * apex points in, so consecutive notches meet at their bases and what is left
 * between them is a point. That is what makes the edge read as a saw rather
 * than as a row of holes.
 */
function toothTool(bounds: Bounds, tooth: Cuts["tooth"], stem: number, scale: CutScale): Contour[] {
  const pitch = Math.max(tooth.pitch * scale.xHeight, stem * 0.1);
  const depth = tooth.depth * stem;
  if (depth <= 0) return [];

  const sides: Array<"left" | "right" | "top" | "bottom"> =
    tooth.edge === "both" ? ["left", "right"] : [tooth.edge];

  const cut: Contour[] = [];
  for (const side of sides) {
    const upright = side === "left" || side === "right";
    const from = upright ? bounds.yMin : bounds.xMin;
    const to = upright ? bounds.yMax : bounds.xMax;
    const run = to - from;
    if (run <= 0) continue;

    // A whole number of teeth across the edge, so the comb starts and finishes
    // on the letter rather than half way through a tooth.
    const teeth = Math.max(1, Math.round(run / pitch));
    const step = run / teeth;

    const edge =
      side === "left"
        ? bounds.xMin
        : side === "right"
          ? bounds.xMax
          : side === "bottom"
            ? bounds.yMin
            : bounds.yMax;
    const inward = side === "left" || side === "bottom" ? 1 : -1;
    const outside = edge - inward * depth;
    const apex = edge + inward * depth;

    for (let index = 0; index < teeth; index++) {
      const start = from + step * index;
      const middle = start + step / 2;
      cut.push(
        upright
          ? poly([
              { x: outside, y: start },
              { x: apex, y: middle },
              { x: outside, y: start + step },
            ])
          : poly([
              { x: start, y: outside },
              { x: middle, y: apex },
              { x: start + step, y: outside },
            ]),
      );
    }
  }
  return cut;
}

/**
 * A groove down the middle of every stroke.
 *
 * The groove is the letter shrunk by a wall's thickness all round (`eroded`),
 * so both walls are the same thickness wherever they run: down a stem, round
 * a counter, and through a join. It used to be each spine swept again with a
 * thinner pen, one stroke at a time, and every place two strokes met was then
 * a question the grooves had to settle between them -- and settled badly. The
 * bowl of an a, b or g runs into its stem at a tangent, so its groove slid
 * into the stem's and the wall between them thinned to a pinch; kept out of
 * the stem instead, it stopped in a stub. The stem of a Sans a is drawn twice,
 * and each copy's groove butted into the other's in a bar of ink. Shrinking
 * the whole letter asks none of those questions: where two strokes meet, the
 * grooves meet as one.
 *
 * The skeleton still says where the groove may run. Only down the thick of a
 * stroke -- see `THICK` -- and pulled back from each end that is free by the
 * inset, so a terminal keeps a solid end. An end buried in another stroke is
 * where two grooves meet, and it is left for them to meet.
 *
 * Nothing past the end rather than exactly at it, when the inset is nothing.
 * Run to exactly the end of the spine, the groove's last edge lies along the
 * stroke's own end cap, and whether that cuts through or leaves a bridge of no
 * width is a question about floating point rather than about the letter. Run
 * a stem past it, it breaks out because it was drawn breaking out.
 */
function inlineTool(
  shape: Contour[],
  strokes: Stroke[],
  inline: Cuts["inline"],
  stem: number,
): Contour[] {
  const width = Math.min(Math.max(inline.width, 0), 0.85) * stem;
  if (width <= 0) return [];
  const wall = (stem - width) / 2;
  /*
   * Only where there is room for it, and the shrinking says where that is: a
   * stroke thinner than two walls has nothing left once they are taken, so a
   * contrast face's hairlines -- the arms of a Serif E, the crossbar of its e
   * -- keep no groove, and the groove fades out where a stroke thins, as an
   * engraved inline does: Castellar, Goudy's hand-tooled faces.
   *
   * It used to be held to the strokes a skeleton called thick as well, by a
   * mask swept down each of them. Nothing the shrinking allows needed that,
   * and on a heavy face it took grooves away that had room: the bowl of a
   * Black a is drawn with a lighter pen and lost the groove down one side,
   * and a stretch of arch swept on its own crossed itself and cut the groove
   * off at a slant at the foot of the m.
   */
  const core = eroded(shape, wall);
  if (core.length === 0 || strokes.length === 0) return core;
  const back = inline.inset * stem;

  const breakouts: Contour[] = [];
  const terminals: Contour[] = [];
  strokes.forEach((stroke, index) => {
    const ends = endsOf(stroke.spine);
    /*
     * Held back only from a terminal: an end with no other stroke near it.
     * An end that stops at a corner -- the top of the stem of an E, under its
     * arm -- is closed by the wall the shrinking leaves, which runs round the
     * corner with the groove.
     */
    const free = ends.map(
      (end) => end !== null && !nearAnother(end.at, strokes, index, stem * 0.5),
    );
    ends.forEach((end, at) => {
      if (!end || !free[at]) return;
      /*
       * The paper past the terminal as it was drawn, within the stroke's own
       * width, grown by the inset. Measured from the end of the spine, the
       * groove stopped square to the stroke, and a stroke cut level at an
       * angle to itself -- the top of a Sans a, the ends of an s and an e --
       * had the groove running out through the lower corner of the cut. The
       * paper follows the cut, whatever its angle.
       */
      const across = { x: -end.out.y, y: end.out.x };
      const half = halfWidth(stroke.pen, across);
      // A box square to the stroke at its end, reaching `from` to `to` along
      // it and `wide` either side.
      const box = (from: number, to: number, wide: number): Contour =>
        poly([
          {
            x: end.at.x + end.out.x * from + across.x * wide,
            y: end.at.y + end.out.y * from + across.y * wide,
          },
          {
            x: end.at.x + end.out.x * from - across.x * wide,
            y: end.at.y + end.out.y * from - across.y * wide,
          },
          {
            x: end.at.x + end.out.x * to - across.x * wide,
            y: end.at.y + end.out.y * to - across.y * wide,
          },
          {
            x: end.at.x + end.out.x * to + across.x * wide,
            y: end.at.y + end.out.y * to + across.y * wide,
          },
        ]);
      // Far enough either side of the end of the spine to hold a cut up to
      // fifty degrees off square, and no further: past that it found the
      // paper under the arch of an a, and the bowl below it.
      const tip = subtract([box(-half * 1.2, half * 1.2, half * 0.9)], shape, "winding").filter(
        (one) => contourArea(one) > 0,
      );
      if (back > 0) {
        // Grown by the inset, and kept to this terminal's own stretch of ink.
        if (tip.length > 0) {
          terminals.push(
            ...intersect(
              outlined(tip, back),
              [box(-(half * 1.2 + back + 2), half * 1.2, half * 1.5)],
              "winding",
            ),
          );
        }
        return;
      }
      // Broken out only through a stroke thick enough to have a groove to
      // break out with.
      if (half * 2 < stem) return;
      const inward = wall + stem * 0.3;
      breakouts.push(
        ...sweep({
          spine: {
            segments: [
              {
                kind: "line",
                from: { x: end.at.x - end.out.x * inward, y: end.at.y - end.out.y * inward },
                to: { x: end.at.x + end.out.x * stem, y: end.at.y + end.out.y * stem },
              },
            ],
            closed: false,
          },
          pen: { weight: width, contrast: 0, angle: 0 },
          start: { kind: "butt" },
          end: { kind: "butt" },
        }),
      );
    });
  });
  const held = terminals.length > 0 ? subtract(core, terminals, "winding") : core;
  /*
   * Less the slivers. Where a contrast face's stroke thins towards a
   * terminal, the shrinking leaves a last few units of groove standing
   * apart from the rest -- a white fleck beside the ends of a Serif e and
   * s. A groove shorter than it is wide is not a groove.
   */
  const least = width * width;
  return [
    ...held.filter((one) => contourArea(one) <= 0 || contourArea(one) >= least),
    ...breakouts,
  ];
}

/**
 * Where each end of an open spine is and which way out of the stroke it
 * points, or nothing for a ring. The heading is read off the last piece that
 * has any length: the bowl of a Sans e ends on a piece of none.
 */
function endsOf(spine: Spine): [{ at: Vec2; out: Vec2 } | null, { at: Vec2; out: Vec2 } | null] {
  const real = spine.segments.filter((segment) => lengthOf(segment) > 1e-6);
  if (spine.closed || real.length === 0) return [null, null];
  const head = endOf(real[0], "front");
  const tail = endOf(real[real.length - 1], "back");
  return [
    { at: head.at, out: { x: -head.away.x, y: -head.away.y } },
    { at: tail.at, out: tail.away },
  ];
}

/**
 * Whether one stroke's spine runs inside another's ink nearly parallel to it,
 * which is how a bowl meets its stem and not how an arm leaves one.
 */
function runsAlongside(stroke: Stroke, other: Stroke): boolean {
  const path = alongSpine(stroke.spine, 64);
  const wall = alongSpine(other.spine, 64);
  if (path.length < 3 || wall.length < 2) return false;
  for (let index = 1; index + 1 < path.length; index++) {
    const nearest = nearestOn(wall, path[index]);
    const half = halfWidth(other.pen, { x: -nearest.along.y, y: nearest.along.x });
    if (nearest.distance >= half) continue;
    const heading = away(path[index - 1], path[index + 1]);
    if (!heading) continue;
    const sine = Math.abs(heading.x * nearest.along.y - heading.y * nearest.along.x);
    if (sine < 0.35) return true;
  }
  return false;
}

/**
 * A gap wherever two strokes run into each other.
 *
 * Two spines are joined where they pass within about a stem of each other,
 * which is close enough that their swept ink certainly overlaps. Sampled
 * rather than solved: the answer only has to be near the join, because what is
 * put there is a band wider than the stroke.
 */
/**
 * What a cast thrown before the cuts has done to the letter they are cutting:
 * how far a rim grew it all round.
 */
export interface CastFirst {
  grown: number;
}

function splitTool(
  strokes: Stroke[],
  split: Cuts["split"],
  stem: number,
  xHeight: number,
  cast?: CastFirst,
): { knives: Contour[]; lips: Contour[] } {
  /*
   * Cut through what the cast put on, when it went first.
   *
   * The breaks are found on the skeleton and sized to the strokes as they
   * were drawn, and a rim grown first stood across every gap as a hairline
   * -- over the crossbar of an A, the arm of a k -- where the knife stopped
   * at the stroke's own edge and the rim did not. Planned on strokes as fat
   * as the rim made them, each gap lies flush against the rimmed side of the
   * stroke that stays and runs through the rim of the one that leaves. A
   * shadow is left as it is: the block and its shadow are one thing sliced,
   * which is what putting the cast first asks for.
   */
  const grown = cast?.grown ?? 0;
  const fat =
    grown > 0
      ? strokes.map((stroke) => ({
          ...stroke,
          pen: { ...stroke.pen, weight: stroke.pen.weight + grown * 2.4 },
        }))
      : strokes;
  const { knives, lips } = splitPlan(fat, split, stem, xHeight);
  return { knives, lips };
}

/** The knife the breaks are cut with, and which pairs of strokes it parts. */
function splitPlan(
  strokes: Stroke[],
  split: Cuts["split"],
  stem: number,
  xHeight: number,
): { knives: Contour[]; parted: Set<string>; lips: Contour[] } {
  const gap = split.size * stem;
  /*
   * The least a break may cut free. The exit stroke of a script H or A is a
   * short flick off the foot of the stem, and a gap at its root left the
   * rest of it lying beside the letter as a full stop. A loose end shorter
   * than this stays on if it is longer than a stem or thinner than two
   * fifths of one: a flick. One shorter than a stem and as thick as the arms of a
   * Display E is a block, and comes off as one.
   */
  const least = xHeight * 0.3;
  if (gap <= 0 || strokes.length < 2) return { knives: [], parted: new Set(), lips: [] };

  const near = stem * 1.15;
  const samples = strokes.map((stroke) => alongSpine(stroke.spine, SAMPLES));
  const lengths = strokes.map((stroke) => spineLength(stroke.spine));

  const found: Gap[] = [];
  const bridges: Array<{ stroke: number; keeps: number; ink: Contour[] }> = [];
  for (let one = 0; one < samples.length; one++) {
    for (let other = one + 1; other < samples.length; other++) {
      let closest = Infinity;
      let where: [number, number] = [0, 0];
      samples[one].forEach((a, i) => {
        samples[other].forEach((b, j) => {
          const between = Math.hypot(a.x - b.x, a.y - b.y);
          if (between < closest) {
            closest = between;
            where = [i, j];
          }
        });
      });
      if (closest >= near) continue;
      /*
       * Nor a stroke drawn over the length of another. The stem of a Sans a
       * is laid once on its own and again as the foot of the arch that runs
       * down into it, and read as two strokes meeting, the break cut between
       * the two copies: a white hairline the height of the stem, down the
       * middle of it. One stroke lying wholly inside another is not a join,
       * and nor are two whose straight runs lie along one line for most of a
       * stem: on the Black the copy runs on below the foot of the arch, and
       * the break cut the arch off where it came down onto it.
       */
      if (
        within(samples[other], samples[one], stem) ||
        within(samples[one], samples[other], stem) ||
        sharesARun(strokes[one], strokes[other], stem)
      ) {
        continue;
      }

      /*
       * Which of the two gives way.
       *
       * A ring never does: an o is one closed stroke, and cutting it is
       * cutting the letter in half where cutting the tail that meets it is a
       * break.
       *
       * Otherwise it is whichever of them meets the other at its own end. That
       * is what an arm leaving a stem is: the arm stops there and the stem
       * goes past. It used to be whichever was shorter, which says the same
       * thing on a text face and the opposite on a heavy one -- the stem of a
       * Display B is 545 units long and the bowl that wraps round it is 667,
       * so the stem was the shorter of the two and the break was cut through
       * the backbone of the letter. The B came back reading as a 5.
       */
      const rings = [strokes[one].spine.closed, strokes[other].spine.closed];
      /*
       * Except a ring drawn against a stem, which is a bowl.
       *
       * The bowl of a b, a d, a Sans g and an a is drawn as a ring with one
       * side laid along the stem, and read as a ring it never gave way: the
       * stem did, beside the ring's top, and the break came out as a slash
       * through the ascender of the b, across the tail of the g and over the
       * shoulder of the a, where it left a caret standing on the bowl. A
       * stencil takes the bowl off the stem and leaves the stem whole -- as
       * the arch of an n comes off its stem -- so the ring is opened where it
       * leaves the stem, at both ends of the side it shares with it.
       */
      if (rings[0] !== rings[1]) {
        const ring = rings[0] ? one : other;
        const backbone = ring === one ? other : one;
        if (
          isStem(strokes[backbone], strokes[ring], stem) &&
          runsAlongside(strokes[ring], strokes[backbone])
        ) {
          const turned = startingOpposite(
            strokes[ring],
            sharedMiddle(strokes[ring], strokes[backbone]),
          );
          const meet = samples[backbone][ring === one ? where[1] : where[0]];
          const opened = [1, -1].map((way) =>
            gapBeside(turned, strokes[backbone], 0.5, way, gap, stem),
          );
          for (const placed of opened) {
            if (placed) found.push({ ...placed, stroke: ring, keeps: backbone, meet });
          }
          /*
           * And the side of the ring between the two breaks goes with them.
           * It lies along the stem, mostly inside it, but a round bowl bulges
           * a unit or two past the stem's edge in the middle, and that stood
           * on the stem as a sliver the height of the bowl.
           */
          const [above, below] = opened;
          if (above && below) {
            const total = spineLength(turned.spine);
            const from = Math.max(0, Math.min(above.at, below.at));
            const to = Math.min(total, Math.max(above.at, below.at));
            const side = spineBetween(turned.spine, from, to);
            if (side.segments.length > 0) {
              bridges.push({
                stroke: ring,
                keeps: backbone,
                ink: sweep({
                  spine: side,
                  pen: { ...turned.pen, weight: turned.pen.weight * 1.2 + 2 },
                  start: { kind: "butt" },
                  end: { kind: "butt" },
                  join: "round",
                }),
              });
            }
          }
          continue;
        }
      }
      const ends = [atItsEnd(where[0]), atItsEnd(where[1])];
      /*
       * Two strokes meeting tip to tip at a sharp angle are a vertex, not a
       * join: the apex of a Serif A, where the thin leg runs up past the
       * thick one to make the point. Broken there, the tip of the leg that
       * gave way was left standing on the other as a flag, and the leg below
       * it cut through on a long slant. A stencil keeps a vertex whole.
       */
      if (ends[0] < 0.1 && ends[1] < 0.1 && tipAngle(samples[one], samples[other], where) < 70) {
        continue;
      }
      /*
       * Both at their own ends is a tie, and the commonest one in the
       * alphabet: the lower bowl of a B starts where its stem starts. Length
       * used to settle it and settles it backwards on a heavy face, so what
       * settles it is which of the two bends. A stem is drawn straight and a
       * bowl is drawn round, and it is the bowl that leaves.
       */
      const bends = [arcsIn(strokes[one]), arcsIn(strokes[other])];
      /*
       * Neither at its own end is a crossing, and one of them turning a
       * corner right there is the point of a chevron laid against a stem: the
       * arm and leg of a Display k are one stroke with its point on the stem.
       * Settled by ends it was the stem that gave way, and the break took the
       * top off the stem instead of the arm off it.
       */
      const cornered = [
        cornerNear(strokes[one], (where[0] / SAMPLES) * lengths[one], stem),
        cornerNear(strokes[other], (where[1] / SAMPLES) * lengths[other], stem),
      ];
      const crossing =
        ends[0] > 0.15 &&
        ends[1] > 0.15 &&
        cornered[0] !== cornered[1] &&
        isStem(strokes[cornered[0] ? other : one], strokes[cornered[0] ? one : other], stem) &&
        strokes[cornered[0] ? other : one].spine.segments.length === 1;
      const gives =
        rings[0] !== rings[1]
          ? rings[0]
            ? other
            : one
          : crossing
            ? cornered[0]
              ? one
              : other
            : ends[0] !== ends[1]
              ? ends[0] < ends[1]
                ? one
                : other
              : bends[0] !== bends[1]
                ? bends[0] > bends[1]
                  ? one
                  : other
                : lengths[one] <= lengths[other]
                  ? one
                  : other;
      const keeps = gives === one ? other : one;
      /*
       * A hairline never gives way to a bowl.
       *
       * The link and the ear of a two-storey g are thin strokes running into
       * a ring at a slant, and what a break leaves of a hairline at a slant is
       * a flat chip on the bowl beside the gap: the link was cut at both ends
       * and vanished, the lower loop floated free, and the ear came off as a
       * comma with a nick left where it had been. They are what holds the
       * letter together, and a stencil leaves them whole.
       */
      if (strokes[keeps].spine.closed && strokes[gives].pen.weight < stem * 0.8) continue;
      const index = gives === one ? where[0] : where[1];
      // Towards whichever end of this stroke is further off, so a crossbar
      // joined at both ends gets a gap beside each stem rather than two gaps
      // in the same place.
      const way = index < SAMPLES / 2 ? 1 : -1;
      const placed = gapBeside(
        strokes[gives],
        strokes[keeps],
        index / SAMPLES,
        way,
        gap,
        stem,
        strokes.filter((_, at) => at !== gives && at !== keeps),
        crossing,
      );
      /*
       * A chevron leaves the stem both ways from its point, and each limb
       * gets a gap: with only the arm's, the foot of the Display k's leg
       * stood out past the cut.
       */
      if (crossing) {
        const limb = gapBeside(
          strokes[gives],
          strokes[keeps],
          index / SAMPLES,
          -way,
          gap,
          stem,
          strokes.filter((_, at) => at !== gives && at !== keeps),
          true,
        );
        if (limb) {
          found.push({
            limb: true,
            ...limb,
            stroke: gives,
            keeps,
            meet: samples[keeps][gives === one ? where[1] : where[0]],
          });
        }
      }
      const freed = placed ? (way > 0 ? lengths[gives] - placed.at : placed.at) - gap / 2 : 0;
      // Only a loose end: a piece held at its far end too is not cut free.
      const loose = !nearAnother(samples[gives][way > 0 ? SAMPLES : 0], strokes, gives, stem * 0.5);
      const tip = samples[gives][way > 0 ? SAMPLES : 0];
      const root = samples[gives][index];
      const reach = Math.hypot(tip.x - root.x, tip.y - root.y) || 1;
      const wide =
        2 *
        halfWidth(strokes[gives].pen, {
          x: -(tip.y - root.y) / reach,
          y: (tip.x - root.x) / reach,
        });
      // Nor a curl: the arm of a Display r bends over and ends in a slant,
      // and cut off short of a stem it was a wedge.
      const curl = arcsIn(strokes[gives]) > 0 && freed < stem * 0.75;
      // And only off the end of the stroke it leaves, as an exit stroke
      // leaves the foot of a stem: the bar of an f and the middle arm of an
      // E leave theirs part way up, and come off however short they are.
      const offTheEnd = ends[gives === one ? 1 : 0] < 0.1;
      const flick = offTheEnd && (freed > stem || wide < stem * 0.4);
      if (placed && loose && freed < least && (flick || curl)) {
        continue;
      }
      if (placed) {
        const meet = samples[keeps][gives === one ? where[1] : where[0]];
        found.push({ ...placed, stroke: gives, keeps, meet });
      }
      /*
       * And at its other end, where that runs into the same stroke too.
       *
       * A pair of strokes was parted once, where they came closest, and the
       * bowl of an R, a B, a D and an a runs out of its stem and back into
       * it: one end was broken and the other left joined, and which one
       * depended on the weight. The Black R kept its bowl on at the top and
       * lost it at the foot, and a stencil takes a bowl off its stem at both.
       */
      const far = way > 0 ? SAMPLES : 0;
      // Only off a stem: the bar of an e runs into its bowl at both ends too,
      // and parted at both it floated in the eye.
      if (Math.abs(far - index) > SAMPLES / 2 && isStem(strokes[keeps], strokes[gives], stem)) {
        /*
         * Runs into it, rather than comes near it: the flat top of a Black
         * r's arm starts in the stem and stops a stem short of it, and was
         * broken off as a crumb.
         */
        const tip = samples[gives][far];
        const wall = nearestOn(samples[keeps], tip);
        const touches =
          wall.distance <
          halfWidth(strokes[keeps].pen, { x: -wall.along.y, y: wall.along.x }) + stem * 0.25;
        const other = touches
          ? gapBeside(
              strokes[gives],
              strokes[keeps],
              far / SAMPLES,
              -way,
              gap,
              stem,
              strokes.filter((_, at) => at !== gives && at !== keeps),
            )
          : null;
        if (other) {
          const nearest = samples[keeps].reduce((best, point) =>
            Math.hypot(point.x - tip.x, point.y - tip.y) <
            Math.hypot(best.x - tip.x, best.y - tip.y)
              ? point
              : best,
          );
          found.push({ ...other, stroke: gives, keeps, meet: nearest });
        }
      }
    }
  }

  /*
   * Two strokes meeting a third at nearly the same place are one gap, not two:
   * cutting the same stretch twice is harmless, but two cuts a hair apart
   * leave a sliver of stroke between them. And two gaps near enough on one
   * stroke to leave only a crumb between them are the same failure one step
   * further apart -- a crossbar on a Black face, too short for a gap beside
   * each stem, came back as a chip floating between two slits.
   */
  const spare = gap * 0.75;
  /*
   * Where three strokes meet, two breaks rather than three.
   *
   * The bowl of an R and its leg both leave the stem at the foot of the bowl,
   * and the leg also leaves the bowl there: three breaks at one join, each
   * cut flush against a different side, and on a Black what was left between
   * them was a chip of bowl and a wedge of leg sticking out of the stem at
   * odd angles. The two lower bowls of a B leave the stem together and meet
   * each other at the waist, and the waist was slashed through as well.
   *
   * A stencil cuts the piece away from the backbone and leaves the piece
   * itself whole. So where two strokes both give way to the same third one
   * at nearly the same place on it, the break between the two of them is not
   * cut: the bowl and the leg of the R come away from the stem as one piece,
   * the bowls of the B as one.
   */
  const together = (a: Gap, b: Gap): boolean =>
    a.stroke !== b.stroke &&
    a.keeps === b.keeps &&
    Math.hypot(a.meet.x - b.meet.x, a.meet.y - b.meet.y) < stem * 1.5;
  const between = (one: Gap, a: number, b: number): boolean =>
    (one.stroke === a && one.keeps === b) || (one.stroke === b && one.keeps === a);
  const joined = found.filter(
    (one) =>
      !found.some((a) => found.some((b) => together(a, b) && between(one, a.stroke, b.stroke))),
  );
  const kept: Gap[] = [];
  for (const one of joined) {
    if (
      kept.some(
        (other) =>
          other.stroke === one.stroke &&
          // The two limbs of a chevron leave from its one point.
          !(one.limb || other.limb) &&
          Math.abs(other.at - one.at) < gap + Math.max(spare, stem * 1.2),
      )
    ) {
      continue;
    }
    kept.push(one);
  }

  /*
   * And each band kept off every stroke but the one it is breaking.
   *
   * The band is laid beside the stroke that stays and made long enough to be
   * sure of crossing the one that leaves, and long enough is sometimes too
   * long: on a Black A the crossbar is buried in the two legs, and a band
   * crossing it cut a slash through the leg beside it. Taking the other
   * strokes' ink back out of the knife means a break only ever removes ink
   * that belongs to the stroke giving way -- which also puts its near side
   * exactly on the edge of the stroke that stays, however that edge curves.
   */
  const giving = [...new Set(kept.map((one) => one.stroke))];
  const swept = strokes.map((one) => sweep(one));
  const inkBut = (...except: number[]) =>
    swept.flatMap((one, index) => (except.includes(index) ? [] : one));
  const cutting = new Map(
    giving.map((stroke) => [
      stroke,
      kept
        .filter((one) => one.stroke === stroke)
        .flatMap((one) => intersect([one.band, ...(one.column ?? [])], one.local, "winding")),
    ]),
  );
  const knives = giving.flatMap((stroke) => {
    const bands = cutting.get(stroke) ?? [];
    if (bands.length === 0) return [];
    const others = inkBut(stroke);
    if (others.length === 0) return facingOut(bands);
    // A chevron's two bands meet at its point, and taken out of the stem
    // together the boolean lost both: each is kept off it on its own.
    if (kept.some((one) => one.stroke === stroke && one.limb)) {
      return bands.flatMap((band) => facingOut(subtract([band], others, "winding")));
    }
    return facingOut(subtract(bands, others, "winding"));
  });
  /*
   * And the stroke's own ink between the join and the gap, past the edge of
   * the stroke that stays. Kept apart from the bands and cut after them: a
   * boolean that loses its way on it must not take a band down with it.
   */
  const lips: Contour[] = [];
  for (const one of kept) {
    // Not a bowl's: the side it lays along its stem goes with the bridge.
    if (!one.root || one.root.length === 0 || strokes[one.stroke].spine.closed) continue;
    const others = inkBut(one.stroke);
    // Hugging the other stroke's edge only. A lip is a sliver standing a few
    // units out of the side; further out is what the break leaves standing,
    // and taken too the point of a Display k's chevron was cut through and a
    // script bowl was hollowed along its stem.
    const beside = sweep({
      ...strokes[one.keeps],
      pen: { ...strokes[one.keeps].pen, weight: strokes[one.keeps].pen.weight + gap * 2 },
    });
    const near = intersect(unite(one.root, "winding"), beside, "winding");
    lips.push(...facingOut(subtract(near, others, "winding")));
  }
  for (const bridge of bridges) {
    const others = inkBut(bridge.stroke);
    if (others.length > 0) knives.push(...facingOut(subtract(bridge.ink, others, "winding")));
  }
  /*
   * And where two strokes that come away together overlap, the ground both
   * their bands cross. Each knife is kept off every other stroke's ink, so
   * where the bowl and the leg of an R overlap at the foot of the bowl
   * neither cut it, and the overlap stood across the gap as a bridge.
   */
  const pairs = joined.flatMap((a) =>
    joined.filter((b) => together(a, b) && a.stroke < b.stroke).map((b) => [a.stroke, b.stroke]),
  );
  for (const [one, other] of pairs) {
    const mine = cutting.get(one) ?? [];
    const theirs = cutting.get(other) ?? [];
    if (mine.length === 0 || theirs.length === 0) continue;
    const both = intersect(mine, theirs, "winding");
    if (both.length === 0) continue;
    const rest = inkBut(one, other);
    knives.push(...facingOut(rest.length === 0 ? both : subtract(both, rest, "winding")));
  }
  const parted = new Set<string>([
    ...joined.map((one) => pairKey(one.stroke, one.keeps)),
    ...bridges.map((one) => pairKey(one.stroke, one.keeps)),
  ]);
  return { knives, parted, lips };
}

/** The same name for a pair of strokes whichever way round they are given. */
export function pairKey(one: number, other: number): string {
  return one < other ? `${one}:${other}` : `${other}:${one}`;
}

/**
 * The pieces of a knife wound the way ink is.
 *
 * A subtraction that takes nothing away can hand its shape back wound the
 * other way round, and the knives are fused under the non-zero rule before
 * they cut: where a band wound one way overlapped a piece wound the other,
 * the two cancelled, and the ground between them stood across the break as a
 * sliver -- the foot of a Roundhand L, the tail of a Formal Script y.
 */
function facingOut(contours: Contour[]): Contour[] {
  const total = contours.reduce((sum, contour) => sum + contourArea(contour), 0);
  return total < 0 ? contours.map(reverseContour) : contours;
}

/**
 * Whether a stroke is a stem a bowl can be drawn against: straight for at
 * least a stem's length somewhere, and no thinner than the bowl. The link and
 * the ear of a two-storey g touch its rings too, and are neither.
 */
function isStem(stroke: Stroke, bowl: Stroke, stem: number): boolean {
  if (stroke.pen.weight < bowl.pen.weight * 0.9) return false;
  return stroke.spine.segments.some(
    (segment) => segment.kind === "line" && distance(segment.from, segment.to) >= stem,
  );
}

/**
 * The angle, in degrees, between two strokes leaving the place their tips
 * meet, read off the sampled spines a few steps in from each tip.
 */
function tipAngle(one: Vec2[], other: Vec2[], where: [number, number]): number {
  const inward = (line: Vec2[], index: number): Vec2 | null => {
    const tip = index < line.length / 2 ? 0 : line.length - 1;
    const step = tip === 0 ? 3 : line.length - 4;
    return away(line[tip], line[Math.max(0, Math.min(line.length - 1, step))]);
  };
  const a = inward(one, where[0]);
  const b = inward(other, where[1]);
  if (!a || !b) return 180;
  return (Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y))) * 180) / Math.PI;
}

/**
 * Where along a ring, as a share of its length, the middle of the stretch it
 * shares with a stem lies: the longest run of the ring's spine inside the
 * stem's ink, taken round the ring's seam where it crosses it.
 */
function sharedMiddle(ring: Stroke, stem: Stroke): number {
  const FINE = 192;
  const path = alongSpine(ring.spine, FINE).slice(0, FINE);
  const wall = alongSpine(stem.spine, FINE);
  if (path.length === 0 || wall.length < 2) return 0;
  const inside = path.map((point) => {
    const nearest = nearestOn(wall, point);
    return nearest.distance < halfWidth(stem.pen, { x: -nearest.along.y, y: nearest.along.x });
  });
  let best = { from: 0, length: 0 };
  for (let start = 0; start < FINE; start++) {
    if (!inside[start] || inside[(start + FINE - 1) % FINE]) continue;
    let length = 0;
    while (length < FINE && inside[(start + length) % FINE]) length++;
    if (length > best.length) best = { from: start, length };
  }
  if (best.length === 0) return 0;
  return ((best.from + best.length / 2) % FINE) / FINE;
}

/**
 * A ring whose spine starts half way round from a place on it, as a share of
 * its length -- so that place is the middle of the spine, and a walk out from
 * it either way meets no seam.
 */
function startingOpposite(ring: Stroke, share: number): Stroke {
  const total = spineLength(ring.spine);
  const from = ((((share + 0.5) % 1) + 1) % 1) * total;
  const segments = [
    ...spineBetween(ring.spine, from, total).segments,
    ...spineBetween(ring.spine, 0, from).segments,
  ];
  return { ...ring, spine: { segments, closed: true } };
}

/** A gap in one stroke: where along it, and the band that cuts it. */
interface Gap {
  stroke: number;
  /** The second limb of a chevron, parted from the same point as the first. */
  limb?: boolean;
  /** The stroke it gives way to, and the place on that stroke's spine it met it. */
  keeps: number;
  meet: Vec2;
  /** How far along the stroke's spine the middle of the gap is. */
  at: number;
  band: Contour;
  /**
   * Where the stroke that stays was carried on past its bend to be measured
   * against (see `straightOn`), the ground over that stretch: what the stroke
   * giving way puts there stood above the stem as a horn.
   */
  column?: Contour[];
  /**
   * The stretch of the stroke around the gap, swept a little wider than the
   * stroke itself: what the band is allowed to cut. A band long enough to
   * cross a stroke leaving at a slant is long enough to reach the same stroke
   * again further round, and the bowl of a Black e was sliced across its whole
   * top by a band meant for the foot of it.
   */
  local: Contour[];
  /**
   * The stroke from where it met the other one up to the gap. Its ink past
   * the other stroke's edge is what stood under the break as a lip: the foot
   * of an arch curves out of its stem a little below where the gap is laid.
   */
  root?: Contour[];
}

/**
 * The band that takes a stroke off the one it runs into, laid flush against
 * the side of the one that stays.
 *
 * It used to be placed a fixed distance along the stroke that gives way and
 * turned square to that stroke -- a stem's half width, plus an eighth of a
 * stem to be safe, plus half the gap. Square to the arm is exactly right for
 * the crossbar of an H and wrong for everything that leaves at an angle or on
 * a curve: the arch of an n leaves its stem heading up and over, so a band
 * square to the arch is a slash across the shoulder, and it left a wedge of
 * arch standing on top of the stem. The eighth of a stem left a stub on every
 * stem it cleared, which on a Black is a sliver twenty-five units wide still
 * stuck to the stem beside every gap.
 *
 * So the band runs along the stroke that stays, just clear of its side, and
 * is long enough to cross the one that leaves at whatever angle it leaves.
 * The stem is left with its own clean edge, and the arm stops square to it --
 * which is how a stencil is cut. Found by walking out along the stroke that
 * gives way until it is a gap's width clear of the other, so a curve that
 * stays inside the stem for a while is followed until it comes out.
 *
 * Nothing, where the stroke gives out before it clears the other with enough
 * left beyond the gap to read as a terminal rather than a crumb: an arm too
 * short to break is an arm that stays whole.
 */
function gapBeside(
  giving: Stroke,
  keeping: Stroke,
  from: number,
  way: number,
  gap: number,
  stem: number,
  // The rest of the letter, for asking whether what is left past the gap is
  // held by another stroke.
  others: Stroke[] = [],
  // Leaving from the point of a chevron, whose other limb lies behind.
  chevron = false,
): {
  at: number;
  band: Contour;
  local: Contour[];
  column?: Contour[];
  root?: Contour[];
} | null {
  const FINE = 192;
  const path = alongSpine(giving.spine, FINE);
  const wall = alongSpine(keeping.spine, FINE);
  if (path.length < 3 || wall.length < 2) return null;
  const walls = [wall, ...straightOn(keeping.spine, stem * 2.5, stem * 1.2)];
  const total = spineLength(giving.spine);
  const step = total / FINE;
  const spare = gap * 0.75;
  const clearance = Math.max(1, stem * 0.02);
  const start = Math.round(from * FINE);

  let previous: { point: Vec2; off: number; need: number } | null = null;
  for (let index = start; index >= 0 && index <= FINE; index += way) {
    const point = path[index];
    const nearest = nearestOnAny(walls, point);
    const side = away(nearest.point, point);
    if (!side) {
      previous = null;
      continue;
    }
    const half = halfWidth(keeping.pen, { x: -nearest.along.y, y: nearest.along.x });
    // The middle of the gap half a gap off the other stroke's side, so its
    // near edge lies along that side; the knife is trimmed back to the side
    // exactly once the other strokes are taken out of it.
    const need = half + gap / 2;
    if (nearest.distance >= need) {
      // Between this sample and the last one, where the spine crossed the line
      // the middle of the gap has to sit on.
      /*
       * Already clear at the first step, which is a stroke that starts a
       * little way off the other one -- the leg of an R leaves the foot of the
       * bowl, not the stem. Laid through the point itself the band stood off
       * the stem by however far that was, and left a wedge of leg bridging
       * the gap it was meant to open. Moved in along the line to the stem
       * until it is flush, like every other break.
       */
      let centre = {
        x: nearest.point.x + side.x * need,
        y: nearest.point.y + side.y * need,
      };
      if (previous && previous.off < previous.need) {
        const share = (previous.need - previous.off) / (nearest.distance - previous.off || 1);
        const t = Math.min(Math.max(share, 0), 1);
        centre = {
          x: previous.point.x + (point.x - previous.point.x) * t,
          y: previous.point.y + (point.y - previous.point.y) * t,
        };
      }
      const at = index * step;
      // What is left of the stroke past the gap.
      const left = way > 0 ? total - at : at;
      const heading = away(path[Math.max(0, index - 1)], path[Math.min(FINE, index + 1)]);
      if (!heading) return null;
      const along = nearest.along;
      const sine = Math.abs(heading.x * side.x + heading.y * side.y);
      // Nearly running along the other stroke there is no side to cut flush
      // against, and a band long enough to cross the arm would slice the stem.
      if (sine < 0.35) return null;
      /*
       * And enough left past the gap to read as a stroke: a Black r's arm
       * broke off its stem as a square crumb floating beside it. Short of
       * half a stem of stroke, the arm stays on -- unless what is left runs
       * on into another stroke, which holds it.
       */
      const past = left - gap / (2 * sine);
      if (past < spare) return null;
      if (past < stem * 0.5 && !buried(path[way > 0 ? FINE : 0], others, -1)) return null;
      const cosine = Math.sqrt(Math.max(0, 1 - sine * sine));
      const across = halfWidth(giving.pen, { x: -heading.y, y: heading.x });
      const reach = ((across + (gap / 2) * cosine) / sine) * 1.6 + clearance;
      const g = gap / 2;
      const around = reach + gap;
      // How far along the stroke the band crosses it where it is laid: the
      // gap's own width and the slant of the cut across the stroke.
      const crossing = ((g + across * cosine) / sine) * 1.25 + clearance;
      /*
       * A break crosses the stroke once. Where the stroke turns after leaving
       * and runs along the other one inside the band's reach, the band lies
       * along it instead of across it: the bowl of a Black e leaves the end of
       * its bar at a slant and then runs over the top of the counter just
       * that far above the bar, and the break sliced the whole top off the
       * letter. Nothing is cut there rather than that.
       */
      let inside = 0;
      for (let other = 0; other <= FINE; other++) {
        if (Math.abs(other * step - at) > crossing * 2) continue;
        // Past where the search set out only: behind it is the stroke's
        // other limb -- the leg of a chevron whose point is on the stem.
        if (chevron && (other - start) * way < 0) continue;
        const there = nearestOnAny(walls, path[other]);
        // On this side of the other stroke only: a bar that starts past the
        // middle of the leg it leaves is also that far off it on the far side.
        const out = away(there.point, path[other]);
        if (!out || out.x * side.x + out.y * side.y <= 0) continue;
        if (Math.abs(there.distance - need) < g) inside += step;
      }
      if (inside > (gap / sine) * 1.5 + clearance) return null;
      const piece = spineBetween(
        giving.spine,
        Math.max(0, at - around),
        Math.min(total, at + around),
      );
      if (piece.segments.length === 0) return null;
      const local = sweep({
        spine: piece,
        pen: { ...giving.pen, weight: giving.pen.weight * 1.2 + 2 },
        start: { kind: "butt" },
        end: { kind: "butt" },
        join: "round",
      });
      const extended = walls[nearest.line];
      const column =
        nearest.line > 0
          ? [
              poly([
                {
                  x: extended[0].x - nearest.along.y * (half + clearance),
                  y: extended[0].y + nearest.along.x * (half + clearance),
                },
                {
                  x: extended[1].x - nearest.along.y * (half + clearance),
                  y: extended[1].y + nearest.along.x * (half + clearance),
                },
                {
                  x: extended[1].x + nearest.along.y * (half + clearance),
                  y: extended[1].y - nearest.along.x * (half + clearance),
                },
                {
                  x: extended[0].x + nearest.along.y * (half + clearance),
                  y: extended[0].y - nearest.along.x * (half + clearance),
                },
              ]),
            ]
          : undefined;
      // From the end of the stroke when that end lies inside the other one:
      // the foot of an arch starts down in its stem, below where it came
      // closest to the stem's spine.
      const tail = way > 0 ? 0 : FINE;
      // Only a foot a step or so long: the foot of a Sans a's arch runs all
      // the way down the stem it is drawn over, and at a hairline weight the
      // cut took the stem with it.
      const from0 =
        buried(path[tail], [keeping], -1) && Math.abs(tail * step - at) < stem * 3 ? tail : start;
      const joint = spineBetween(
        giving.spine,
        Math.min(from0 * step, at),
        Math.max(from0 * step, at),
      );
      // Only where the stroke starts down inside the other: the foot of an
      // arch in its stem. Elsewhere there is no lip, and a script's loops
      // and descenders were carved up by one.
      const root =
        from0 === tail && joint.segments.length > 0
          ? sweep({
              spine: joint,
              pen: { ...giving.pen, weight: giving.pen.weight * 1.2 + 2 },
              start: { kind: "butt" },
              end: { kind: "butt" },
              join: "round",
            })
          : [];
      return {
        at,
        local,
        root,
        ...(column ? { column } : {}),
        band: poly([
          {
            x: centre.x - side.x * g - along.x * reach,
            y: centre.y - side.y * g - along.y * reach,
          },
          {
            x: centre.x + side.x * g - along.x * reach,
            y: centre.y + side.y * g - along.y * reach,
          },
          {
            x: centre.x + side.x * g + along.x * reach,
            y: centre.y + side.y * g + along.y * reach,
          },
          {
            x: centre.x - side.x * g + along.x * reach,
            y: centre.y - side.y * g + along.y * reach,
          },
        ]),
      };
    }
    previous = { point, off: nearest.distance, need };
  }
  return null;
}

/** The nearest point of a sampled spine, how far off it is, and which way the spine runs there. */
function nearestOn(line: Vec2[], point: Vec2): { point: Vec2; distance: number; along: Vec2 } {
  let best = { point: line[0], distance: Infinity, along: { x: 1, y: 0 } };
  for (let index = 0; index + 1 < line.length; index++) {
    const a = line[index];
    const b = line[index + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const span = dx * dx + dy * dy;
    if (span < 1e-12) continue;
    const t = Math.min(Math.max(((point.x - a.x) * dx + (point.y - a.y) * dy) / span, 0), 1);
    const on = { x: a.x + dx * t, y: a.y + dy * t };
    const off = distance(on, point);
    if (off < best.distance) {
      const run = Math.sqrt(span);
      best = { point: on, distance: off, along: { x: dx / run, y: dy / run } };
    }
  }
  return best;
}

/** The nearest point on any of several sampled lines. */
function nearestOnAny(
  lines: Vec2[][],
  point: Vec2,
): { point: Vec2; distance: number; along: Vec2; line: number } {
  let best = { ...nearestOn(lines[0], point), line: 0 };
  for (let index = 1; index < lines.length; index++) {
    const one = nearestOn(lines[index], point);
    if (one.distance < best.distance) best = { ...one, line: index };
  }
  return best;
}

/**
 * The straight runs of a spine carried on past the place they turn into a
 * curve, as lines of their own.
 *
 * Where a stroke runs straight and then bends away -- the middle stem of an
 * m, which is the leg of the first arch -- another stroke leaving from the
 * bend leaves the straight run, not the curve. Measured against the curve,
 * the second arch of an m was broken off along the first arch's shoulder, a
 * slash across the top of the letter rather than a gap beside its stem. Only
 * runs at least `least` long are carried on, by `by`.
 */
function straightOn(spine: Spine, by: number, least: number): Vec2[][] {
  const lines: Vec2[][] = [];
  const segments = spine.segments;
  segments.forEach((segment, index) => {
    // Only a stem: carried on, the short tail at the foot of an a ran back
    // under its bowl and the break cut a sliver along the bottom of it.
    if (segment.kind !== "line" || distance(segment.from, segment.to) < least) return;
    const way = away(segment.from, segment.to);
    if (!way) return;
    const next = segments[index + 1] ?? (spine.closed ? segments[0] : undefined);
    const before =
      segments[index - 1] ?? (spine.closed ? segments[segments.length - 1] : undefined);
    if (next?.kind === "arc") {
      lines.push([segment.to, { x: segment.to.x + way.x * by, y: segment.to.y + way.y * by }]);
    }
    if (before?.kind === "arc") {
      lines.push([
        { x: segment.from.x - way.x * by, y: segment.from.y - way.y * by },
        segment.from,
      ]);
    }
  });
  return lines;
}

/**
 * Whether two strokes have a straight run in common: two lines lying along
 * one another, the same way or opposite, for a good part of a stem.
 */
function sharesARun(one: Stroke, other: Stroke, stem: number): boolean {
  const lines = (stroke: Stroke) =>
    stroke.spine.segments.filter(
      (segment): segment is SpineSegment & { kind: "line" } => segment.kind === "line",
    );
  const off = (point: Vec2, from: Vec2, way: Vec2): number =>
    Math.abs((point.x - from.x) * way.y - (point.y - from.y) * way.x);
  for (const a of lines(one)) {
    const way = away(a.from, a.to);
    if (!way) continue;
    for (const b of lines(other)) {
      if (off(b.from, a.from, way) > stem * 0.05 || off(b.to, a.from, way) > stem * 0.05) continue;
      const along = (point: Vec2) => (point.x - a.from.x) * way.x + (point.y - a.from.y) * way.y;
      const [b0, b1] = [along(b.from), along(b.to)].sort((x, y) => x - y);
      if (Math.min(distance(a.from, a.to), b1) - Math.max(0, b0) >= stem * 0.4) return true;
    }
  }
  return false;
}

/** Whether every point of one sampled spine lies on another, near enough. */
function within(inner: Vec2[], outer: Vec2[], stem: number): boolean {
  if (inner.length < 2 || outer.length < 2) return false;
  return inner.every((point) => nearestOn(outer, point).distance < stem * 0.1);
}

/** How far a stroke's ink stands from its spine, measured along one direction. */
function halfWidth(pen: Stroke["pen"], normal: Vec2): number {
  const reach = penReach(pen);
  const cos = Math.cos(-reach.angle);
  const sin = Math.sin(-reach.angle);
  const x = normal.x * cos - normal.y * sin;
  const y = normal.x * sin + normal.y * cos;
  return Math.hypot(x * reach.across, y * reach.along);
}

/** How finely a spine is sampled when looking for where two of them meet. */
const SAMPLES = 24;

/**
 * How near its own end a stroke meets the other one, as a share of its length.
 *
 * Zero at either end and a half in the middle. It is what tells an arm from
 * the stem it leaves: the arm stops at the join and the stem runs past it.
 */
function atItsEnd(index: number): number {
  return Math.min(index, SAMPLES - index) / SAMPLES;
}

/** How much of a stroke is drawn round rather than straight. */
/**
 * Whether a stroke's spine comes to a point, one straight segment turning back
 * into the next, within half a stem of a place along it.
 */
function cornerNear(stroke: Stroke, along: number, stem: number): boolean {
  let run = 0;
  const segments = stroke.spine.segments;
  for (let index = 0; index + 1 < segments.length; index++) {
    run += spineLength({ segments: [segments[index]], closed: false });
    if (Math.abs(run - along) > stem * 0.5) continue;
    const a = segments[index];
    const b = segments[index + 1];
    if (a.kind !== "line" || b.kind !== "line") continue;
    const u = { x: a.to.x - a.from.x, y: a.to.y - a.from.y };
    const v = { x: b.to.x - b.from.x, y: b.to.y - b.from.y };
    const cos = (u.x * v.x + u.y * v.y) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y) || 1);
    // Turned back on itself by more than a right angle: a point, not a bend.
    if (cos < 0) return true;
  }
  return false;
}

function arcsIn(stroke: Stroke): number {
  return stroke.spine.segments.filter((segment) => segment.kind === "arc").length;
}

/**
 * The corners of the letter, cut off square.
 *
 * Read off the outline the previous cuts left rather than off the skeleton,
 * because half the corners worth cutting are ones the other cuts made -- the
 * square ends a slot leaves in a stem, the points a saw leaves along an edge.
 *
 * A corner counts if the outline turns sharply there and if the ink is on the
 * inside of the turn. That second test is what keeps the cut on the corners of
 * the letter and off the corners of its counters, except where a counter has a
 * corner poking into it, which is a corner of the ink too and gets cut like
 * any other.
 */
function chamferTool(
  shape: Contour[],
  chamfer: Cuts["chamfer"],
  stem: number,
  // Where each corner that was cut off stood, for anything that has to know.
  corners: Vec2[] = [],
): Contour[] {
  const size = chamfer.size * stem;
  if (size <= 0) return [];

  /** Below this the outline is carrying on rather than turning. */
  const SHARP = (25 * Math.PI) / 180;
  /** Above this it is going back the way it came. */
  const REVERSED = (175 * Math.PI) / 180;

  const cut: Contour[] = [];
  for (const contour of shape) {
    const nodes = contour.nodes;
    if (nodes.length < 3) continue;

    for (let index = 0; index < nodes.length; index++) {
      const previous = nodes[(index - 1 + nodes.length) % nodes.length];
      const here = nodes[index];
      const next = nodes[(index + 1) % nodes.length];

      // Handles, where there are any, say which way the outline is actually
      // going: a node between two curves is not a corner however far apart its
      // neighbours are.
      const arriving = away(here.handleIn ?? previous.point, here.point);
      const leaving = away(here.point, here.handleOut ?? next.point);
      if (!arriving || !leaving) continue;

      const turn = angleBetween(arriving, leaving);
      if (Math.abs(turn) < SHARP) continue;
      /*
       * And an outline doubling straight back on itself is not a corner.
       *
       * A union can leave a hair of no width standing out of a letter -- a
       * point laid along an edge fuses into one -- and the outline runs out
       * along it and straight back. The triangle a chamfer laid on the tip of
       * that had two of its corners on the same spot and no area, and a knife
       * holding one took the whole letter with it.
       */
      if (Math.abs(turn) > REVERSED) continue;
      /*
       * Ink on the inside of the turn, which is a turn to the left whichever
       * contour this is. The shape has come out of a union, so its outlines
       * run with the ink on their left -- anticlockwise round the outside,
       * clockwise round a counter -- and a turn to the left has the ink inside
       * it on both.
       *
       * This used to flip the test for a counter, on the reading that a
       * counter runs the other way and so turns the other way. It does run
       * the other way, and that already puts the ink on its left; flipping it
       * again picked out exactly the corners it meant to leave alone -- the
       * corners of the counters themselves, where the ink is on the outside of
       * the turn. Every square counter got a cut at each of its corners, aimed
       * into the stem and the bar around it: a nick into the ink beside every inside corner instead of nothing.
       */
      if (turn <= 0) continue;

      // Never more than a share of the shorter of the two edges, or the cut
      // reaches past the corner and takes the next one with it.
      const room = Math.min(distance(here.point, previous.point), distance(here.point, next.point));
      const reach = Math.min(size, room * 0.45);
      /*
       * Nothing on a corner too small to see.
       *
       * A union hands back points doubled up a hair apart wherever two
       * strokes' ends met -- the foot of a light Serif H is full of them --
       * and each read as a corner with edges a ten-thousandth long. The cut
       * laid there was a triangle of no area at all, and a knife holding a
       * few of those took the whole letter with it: the H came back as
       * nothing.
       */
      if (reach < Math.max(0.5, size * 0.04)) continue;

      /*
       * Back along the edge that arrives, out past the point of the corner,
       * and forward along the edge that leaves.
       *
       * The middle one is the one to get right, and it is easy to get exactly
       * backwards: the way out of a corner is against the turn, along
       * `arriving - leaving`. The other sign points into the letter, which
       * makes the triangle a splinter lying along the outline instead of a cut
       * across it -- and every corner in the font came back with a nick beside
       * it rather than a chamfer on it.
       */
      const out = away({ x: leaving.x, y: leaving.y }, { x: arriving.x, y: arriving.y });
      if (!out) continue;
      corners.push(here.point);
      /*
       * Measured along the edges themselves rather than along their tangents.
       * Off a curve, a point a reach along the tangent is not on the outline,
       * and the cut left a step where it met it: a nick beside the chamfer at
       * the lower terminal of an e, where the bowl curves into the corner.
       */
      cut.push(
        poly([
          alongEdge(previous, here, reach, "back"),
          { x: here.point.x + out.x * reach, y: here.point.y + out.y * reach },
          alongEdge(here, next, reach, "forward"),
        ]),
      );
    }
  }
  return cut;
}

/**
 * The point on one edge of an outline a distance from one of its ends,
 * following the curve: back from the end of the edge, or forward from its
 * start.
 */
function alongEdge(from: GlyphNode, to: GlyphNode, by: number, way: "back" | "forward"): Vec2 {
  const p0 = from.point;
  const p1 = from.handleOut ?? p0;
  const p2 = to.handleIn ?? to.point;
  const p3 = to.point;
  const STEPS = 32;
  const at = (t: number): Vec2 => {
    const u = 1 - t;
    return {
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    };
  };
  let walked = 0;
  let last = way === "back" ? p3 : p0;
  for (let step = 1; step <= STEPS; step++) {
    const point = at(way === "back" ? 1 - step / STEPS : step / STEPS);
    const run = distance(last, point);
    if (walked + run >= by) {
      const share = run > 0 ? (by - walked) / run : 0;
      return { x: last.x + (point.x - last.x) * share, y: last.y + (point.y - last.y) * share };
    }
    walked += run;
    last = point;
  }
  return last;
}

/**
 * The holes in a letter, replaced by a shape.
 *
 * Done by filling the letter in and then cutting the new shape out of it,
 * which is two cheap operations rather than one difficult one: a hole is
 * already a contour, so dropping it fills the letter, and the shape that
 * replaces it is a polygon in the box the hole used to occupy.
 *
 * Very small holes are left alone. The eye of an e at a heavy weight is a few
 * dozen units across, and a diamond that size is a printing fault rather than
 * a decision.
 */
function motifCut(shape: Contour[], motif: Cuts["motif"], stem: number): Contour[] {
  const holes = shape.filter((contour) => contourArea(contour) < 0);
  if (holes.length === 0) return shape;

  const solid = shape.filter((contour) => contourArea(contour) >= 0);
  /*
   * Held below the point where the motif stops being a counter.
   *
   * A shape larger than the hole opens the counter out, which is a real thing
   * to want, and a shape much larger than the hole is not a counter at all --
   * on an o at one and a half the counter's box, the square reaches past the
   * outer edge of the letter and the o comes back as nothing. Clipping it to
   * the letter does not save it, because the letter is exactly what it is
   * eating. So the size is capped where a rim of ink still survives.
   */
  const size = Math.min(Math.max(motif.size, 0.1), 1.25);

  // Holes too small to replace stay the holes they were. Decided before
  // anything is cut, so the letter the motifs are clipped against is the same
  // letter throughout rather than one that grows as the loop runs.
  const kept = holes.filter((hole) => {
    const box = contoursBounds([hole]);
    return Math.min(box.xMax - box.xMin, box.yMax - box.yMin) < stem * 0.5;
  });
  const replacing = holes.filter((hole) => !kept.includes(hole));
  if (replacing.length === 0) return shape;

  const shapes: Contour[] = [];
  for (const hole of replacing) {
    let box = contoursBounds([hole]);
    let middle = { x: (box.xMin + box.xMax) / 2, y: (box.yMin + box.yMax) / 2 };
    /*
     * Laid out about a point inside the counter.
     *
     * The middle of a counter's box is not always well inside the counter:
     * the triangle of a 4 has it on the sloping side, or past it. Measured
     * from there, the shape seemed to have room on every side, and a diamond
     * dropped into a light 4 cut straight through the diagonal and opened the
     * counter to the outside. Where the counter's own centre of area stands
     * well clear of its sides and the box's middle does not, the box is moved
     * to sit on the centre.
     */
    const centre = centreOf(hole);
    if (
      contourContainsPoint(hole, centre) &&
      (!contourContainsPoint(hole, middle) || clearance(hole, centre) > clearance(hole, middle) * 2)
    ) {
      box = {
        xMin: box.xMin + centre.x - middle.x,
        xMax: box.xMax + centre.x - middle.x,
        yMin: box.yMin + centre.y - middle.y,
        yMax: box.yMax + centre.y - middle.y,
      };
      middle = centre;
    }
    // Drawn at full size and then held to the counter, so that size 1 means
    // the shape fills the counter rather than the counter's box.
    const full = motifShape(motif.shape, box, 1);
    const room = roomInCounter(full, hole, middle);
    /*
     * A shape that will not go into the counter leaves the counter alone.
     *
     * A diamond in the triangle of a 4 has to shrink until its points clear
     * the sloping side, which on a light face is a speck a few units across:
     * the counter was filled in for it and the 4 came back as a solid wedge
     * with a pinhole in it. Where the shape at its fullest would cover less
     * than a fifth of the hole, the hole is kept as it was drawn.
     */
    const fullest = Math.abs(full.reduce((total, one) => total + contourArea(one), 0)) * room ** 2;
    if (fullest < Math.abs(contourArea(hole)) * 0.2) {
      kept.push(hole);
      continue;
    }
    /*
     * Nor where any part of the shape would come out a speck.
     *
     * The counter of a Black A is a small triangle, and a diamond fitted into
     * it -- or the hole of a ring -- was a dot a few units across, which
     * prints as dirt rather than as a figure. The hole stays as it was drawn.
     */
    const scale = room * Math.min(size, 1);
    const least = Math.min(...full.map((one) => Math.abs(contourArea(one)))) * scale ** 2;
    if (least < stem * stem * 0.2) {
      kept.push(hole);
      continue;
    }
    /*
     * Larger than the counter, but never through the stroke round it.
     *
     * Clipping to the letter's silhouette was what held a large motif in, and
     * the silhouette is the far side of the stroke: a square at 1.2 on a light
     * o reached through the thin sides of the bowl and cut the o into four
     * corners, and a light 4 and 8 came apart the same way. So a motif grows
     * past its counter by at most half the ink standing between the counter
     * and the outside, measured along each of its own points.
     */
    const grow =
      size > 1 ? Math.min(size, room > 0 ? halfwayOut(full, hole, shape, middle) / room : 1) : size;
    const drawn = scaleAbout(full, middle, Math.max(grow, Math.min(size, 1)) * room);
    // Held inside the letter, so a motif larger than the hole opens the
    // counter out rather than bursting through the side of the letter.
    shapes.push(...(size > 1 ? intersect(drawn, solid, "winding") : drawn));
  }
  const filled = [...solid, ...kept];
  return shapes.length === 0 ? filled : subtract(filled, shapes, "winding");
}

/**
 * How far a motif drawn in the counter's box can be scaled before it leaves
 * the counter.
 *
 * Every shape here is laid out in the box the counter fits inside, and a box
 * is bigger than the thing it bounds wherever that thing is round. The corners
 * of a square drawn in an O's box are not in the O's counter at all, they are
 * out in the stroke -- and subtracting them there does not make a counter, it
 * cuts the O into four arcs. Five of the eleven shapes have corners like that,
 * and on the thinner bases every one of them severed the letter.
 *
 * So each of the shape's own points is cast back at the counter from the
 * middle, and the shape is held to the tightest answer. A diamond comes back
 * unchanged, because its points sit at the middles of the edges, which is
 * exactly where a round counter reaches furthest; a square comes back at about
 * a 1/sqrt(2) of its box, which is the largest square that fits in a circle.
 */
function roomInCounter(drawn: Contour[], hole: Contour, middle: Vec2): number {
  const edge = [flattenContour(hole, 24)];
  let room = 1;
  for (const contour of drawn) {
    for (const point of flattenContour(contour, 6)) {
      const reach = Math.hypot(point.x - middle.x, point.y - middle.y);
      if (reach < 1e-6) continue;
      const wall = rayHitDistance(edge, middle, {
        x: (point.x - middle.x) / reach,
        y: (point.y - middle.y) / reach,
      });
      if (!Number.isFinite(wall)) continue;
      // A hair inside, so the subtraction does not shave the stroke it touches.
      room = Math.min(room, (wall * 0.995) / reach);
    }
  }
  return room;
}

/**
 * How far a motif drawn in the counter's box can be scaled before any of its
 * points is more than half way through the ink round the counter.
 */
function halfwayOut(drawn: Contour[], hole: Contour, shape: Contour[], middle: Vec2): number {
  const wall = [flattenContour(hole, 24)];
  const beyond = shape.filter((contour) => contour !== hole).map((one) => flattenContour(one, 24));
  let room = Infinity;
  for (const contour of drawn) {
    for (const point of flattenContour(contour, 6)) {
      const reach = Math.hypot(point.x - middle.x, point.y - middle.y);
      if (reach < 1e-6) continue;
      const way = { x: (point.x - middle.x) / reach, y: (point.y - middle.y) / reach };
      const inner = rayHitDistance(wall, middle, way);
      if (!Number.isFinite(inner)) continue;
      const start = { x: middle.x + way.x * (inner + 0.5), y: middle.y + way.y * (inner + 0.5) };
      const outer = inner + 0.5 + rayHitDistance(beyond, start, way);
      if (!Number.isFinite(outer)) continue;
      room = Math.min(room, (inner + (outer - inner) / 2) / reach);
    }
  }
  return Number.isFinite(room) ? room : 1;
}

/** How far a point stands from the nearest part of an outline. */
function clearance(contour: Contour, point: Vec2): number {
  const path = flattenContour(contour, 12);
  let nearest = Infinity;
  for (let index = 0; index < path.length; index++) {
    const a = path[index];
    const b = path[(index + 1) % path.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const span = dx * dx + dy * dy;
    const t =
      span > 0 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / span)) : 0;
    nearest = Math.min(nearest, Math.hypot(point.x - a.x - dx * t, point.y - a.y - dy * t));
  }
  return nearest;
}

/** The centre of area of one outline. */
function centreOf(contour: Contour): Vec2 {
  const path = flattenContour(contour, 12);
  let area = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < path.length; index++) {
    const a = path[index];
    const b = path[(index + 1) % path.length];
    const cross = a.x * b.y - b.x * a.y;
    area += cross;
    x += (a.x + b.x) * cross;
    y += (a.y + b.y) * cross;
  }
  if (Math.abs(area) < 1e-9) return path[0] ?? { x: 0, y: 0 };
  return { x: x / (3 * area), y: y / (3 * area) };
}

/** Every point and handle moved towards or away from one place. */
function scaleAbout(contours: Contour[], middle: Vec2, by: number): Contour[] {
  if (Math.abs(by - 1) < 1e-9) return contours;
  const move = (point: Vec2): Vec2 => ({
    x: middle.x + (point.x - middle.x) * by,
    y: middle.y + (point.y - middle.y) * by,
  });
  return contours.map((contour) => ({
    ...contour,
    nodes: contour.nodes.map((node) => ({
      ...node,
      point: move(node.point),
      handleIn: node.handleIn ? move(node.handleIn) : null,
      handleOut: node.handleOut ? move(node.handleOut) : null,
    })),
  }));
}

function motifShape(shape: MotifShape, box: Bounds, size: number): Contour[] {
  const middle = { x: (box.xMin + box.xMax) / 2, y: (box.yMin + box.yMax) / 2 };
  const wide = ((box.xMax - box.xMin) / 2) * size;
  const tall = ((box.yMax - box.yMin) / 2) * size;

  switch (shape) {
    case "diamond":
      return [rhombus(middle, wide, tall)];
    case "lozenge":
      // The same figure drawn tall and narrow, which is what most woven and
      // painted geometry uses where a square diamond would read as a hole.
      return [rhombus(middle, wide * 0.5, tall)];
    case "nested":
      // A diamond with a diamond in it: the counter becomes two outlines, one
      // inside the other, which is the commonest way a geometric face gets a
      // counter that is neither open nor closed.
      return [
        rhombus(middle, wide, tall),
        reverseContour(rhombus(middle, wide * 0.42, tall * 0.42)),
      ];
    case "hourglass":
      // Two triangles meeting at their points. Two shapes rather than one,
      // because drawn as a single outline it would cross itself in the middle
      // and the fill rule would empty one half of it.
      return [
        poly([
          { x: middle.x - wide, y: middle.y + tall },
          { x: middle.x + wide, y: middle.y + tall },
          { x: middle.x, y: middle.y },
        ]),
        poly([
          { x: middle.x - wide, y: middle.y - tall },
          { x: middle.x + wide, y: middle.y - tall },
          { x: middle.x, y: middle.y },
        ]),
      ];
    case "chevron":
      return [
        poly([
          { x: middle.x - wide, y: middle.y + tall },
          { x: middle.x, y: middle.y - tall * 0.35 },
          { x: middle.x + wide, y: middle.y + tall },
          { x: middle.x + wide, y: middle.y + tall * 0.3 },
          { x: middle.x, y: middle.y - tall },
          { x: middle.x - wide, y: middle.y + tall * 0.3 },
        ]),
      ];
    case "bars": {
      // A comb of three, which reads as a counter cut into stripes rather than
      // replaced by a figure.
      const thick = (tall * 2) / 7;
      return [-1, 0, 1].map((step) =>
        rect(middle.x - wide, middle.y + step * thick * 2 - thick / 2, wide * 2, thick),
      );
    }
    case "triangle":
      return [
        poly([
          { x: middle.x - wide, y: middle.y - tall },
          { x: middle.x + wide, y: middle.y - tall },
          { x: middle.x, y: middle.y + tall },
        ]),
      ];
    case "square":
      return [rect(middle.x - wide, middle.y - tall, wide * 2, tall * 2)];
    case "slot":
      return [rect(middle.x - wide, middle.y - tall * 0.34, wide * 2, tall * 0.68)];
    case "dot":
      // A small disc in the middle of the counter, so the letter closes up to
      // a ring with a point in it -- which is most of what an inline face and
      // a geometric display face have in common.
      return [disc(middle, wide * 0.47, tall * 0.47)];
    case "ring":
      // A disc with a hole: the counter becomes two rings, one inside the
      // other. Drawn as one shape and its own counter, so it stays a hole
      // rather than becoming a blot when the letter is fused.
      return [
        disc(middle, wide * 0.72, tall * 0.72),
        reverseContour(disc(middle, wide * 0.36, tall * 0.36)),
      ];
  }
}

/** A diamond on its point, which every other four-sided motif here is a version of. */
function rhombus(middle: Vec2, wide: number, tall: number): Contour {
  return poly([
    { x: middle.x, y: middle.y - tall },
    { x: middle.x + wide, y: middle.y },
    { x: middle.x, y: middle.y + tall },
    { x: middle.x - wide, y: middle.y },
  ]);
}

/**
 * An ellipse, as four cubics.
 *
 * A quarter of a circle written as one cubic is off by about a part in a
 * thousand of the radius, which on a counter of two hundred units is a fifth
 * of a unit -- below anything a font file records.
 */
const KAPPA = 0.5522847498;

function disc(middle: Vec2, wide: number, tall: number): Contour {
  const across = wide * KAPPA;
  const up = tall * KAPPA;
  const at = (
    x: number,
    y: number,
    inX: number,
    inY: number,
    outX: number,
    outY: number,
  ): GlyphNode => ({
    point: { x, y },
    handleIn: { x: x + inX, y: y + inY },
    handleOut: { x: x + outX, y: y + outY },
    type: "smooth",
  });
  return {
    closed: true,
    nodes: [
      at(middle.x + wide, middle.y, 0, -up, 0, up),
      at(middle.x, middle.y + tall, across, 0, -across, 0),
      at(middle.x - wide, middle.y, 0, up, 0, -up),
      at(middle.x, middle.y - tall, -across, 0, across, 0),
    ],
  };
}

// ---------------------------------------------------------------------------
// Geometry the tools are made of
// ---------------------------------------------------------------------------

const node = (x: number, y: number): GlyphNode => ({
  point: { x, y },
  handleIn: null,
  handleOut: null,
  type: "corner",
});

/** A polygon, always wound as ink so `winding` reads it as solid. */
function poly(points: Vec2[]): Contour {
  const contour: Contour = { nodes: points.map((point) => node(point.x, point.y)), closed: true };
  return contourArea(contour) >= 0 ? contour : { ...contour, nodes: [...contour.nodes].reverse() };
}

const rect = (x: number, y: number, w: number, h: number): Contour =>
  poly([
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]);

function turned(contour: Contour, about: Vec2, by: number): Contour {
  if (by === 0) return contour;
  const cos = Math.cos(by);
  const sin = Math.sin(by);
  return {
    ...contour,
    nodes: contour.nodes.map((one) => {
      const x = one.point.x - about.x;
      const y = one.point.y - about.y;
      return node(about.x + x * cos - y * sin, about.y + x * sin + y * cos);
    }),
  };
}

const distance = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);

/** The direction from one point to another, or nothing if they are the same point. */
function away(from: Vec2, to: Vec2): Vec2 | null {
  const run = distance(from, to);
  return run < 1e-9 ? null : { x: (to.x - from.x) / run, y: (to.y - from.y) / run };
}

/** How far the outline turns at a corner, signed: positive is a left turn. */
function angleBetween(arriving: Vec2, leaving: Vec2): number {
  return Math.atan2(
    arriving.x * leaving.y - arriving.y * leaving.x,
    arriving.x * leaving.x + arriving.y * leaving.y,
  );
}

/**
 * The stretch of a spine between two distances along it.
 *
 * Open, whatever it was cut out of: a piece of a ring is an arc, and asking
 * for it closed would join its two ends back up.
 */
function spineBetween(spine: Spine, from: number, to: number): Spine {
  const total = spineLength(spine);
  const front = eatFrom(spine.segments, Math.max(0, from), "front");
  const both = eatFrom(front, Math.max(0, total - to), "back");
  return { segments: both, closed: false };
}

/** Whether a point lies within `by` of the ink of any stroke but one. */
function nearAnother(point: Vec2, strokes: Stroke[], except: number, by: number): boolean {
  return strokes.some((stroke, index) => {
    if (index === except) return false;
    const line = alongSpine(stroke.spine, 96);
    if (line.length < 2) return false;
    const nearest = nearestOn(line, point);
    return (
      nearest.distance < halfWidth(stroke.pen, { x: -nearest.along.y, y: nearest.along.x }) + by
    );
  });
}

/** Whether a point lies inside the ink of any stroke but one. */
function buried(point: Vec2, strokes: Stroke[], except: number): boolean {
  return strokes.some((stroke, index) => {
    if (index === except) return false;
    const line = alongSpine(stroke.spine, 96);
    if (line.length < 2) return false;
    const nearest = nearestOn(line, point);
    const half = halfWidth(stroke.pen, { x: -nearest.along.y, y: nearest.along.x });
    return nearest.distance < half * 0.9;
  });
}

/** Where a spine segment ends, and the way it was heading when it got there. */
function endOf(segment: SpineSegment, end: "front" | "back"): { at: Vec2; away: Vec2 } {
  if (segment.kind === "line") {
    const at = end === "front" ? segment.from : segment.to;
    const run = { x: segment.to.x - segment.from.x, y: segment.to.y - segment.from.y };
    const span = Math.hypot(run.x, run.y);
    const away = span > 0 ? { x: run.x / span, y: run.y / span } : { x: 1, y: 0 };
    return { at, away };
  }
  const angle = end === "front" ? segment.startAngle : segment.endAngle;
  const at = {
    x: segment.centre.x + Math.cos(angle) * segment.radius,
    y: segment.centre.y + Math.sin(angle) * segment.radius,
  };
  // The tangent of a circle, pointing the way the arc is being swept.
  const turn = segment.sweepPositive ? 1 : -1;
  return { at, away: { x: -Math.sin(angle) * turn, y: Math.cos(angle) * turn } };
}

function eatFrom(segments: SpineSegment[], by: number, end: "front" | "back"): SpineSegment[] {
  const order = end === "front" ? [...segments] : [...segments].reverse();
  const kept: SpineSegment[] = [];
  let left = by;

  for (const segment of order) {
    const run = lengthOf(segment);
    if (left <= 0) {
      kept.push(segment);
      continue;
    }
    if (run <= left) {
      left -= run;
      continue;
    }
    kept.push(trim(segment, left, end));
    left = 0;
  }
  return end === "front" ? kept : kept.reverse();
}

function lengthOf(segment: SpineSegment): number {
  return segment.kind === "line"
    ? distance(segment.from, segment.to)
    : Math.abs(segment.endAngle - segment.startAngle) * segment.radius;
}

function trim(segment: SpineSegment, by: number, end: "front" | "back"): SpineSegment {
  if (segment.kind === "line") {
    const run = distance(segment.from, segment.to);
    const part = by / run;
    return end === "front"
      ? {
          ...segment,
          from: {
            x: segment.from.x + (segment.to.x - segment.from.x) * part,
            y: segment.from.y + (segment.to.y - segment.from.y) * part,
          },
        }
      : {
          ...segment,
          to: {
            x: segment.to.x + (segment.from.x - segment.to.x) * part,
            y: segment.to.y + (segment.from.y - segment.to.y) * part,
          },
        };
  }
  const way = Math.sign(segment.endAngle - segment.startAngle) || 1;
  const turn = (by / segment.radius) * way;
  return end === "front"
    ? { ...segment, startAngle: segment.startAngle + turn }
    : { ...segment, endAngle: segment.endAngle - turn };
}
