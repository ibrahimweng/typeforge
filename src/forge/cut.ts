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
  contoursBounds,
  flattenContour,
  rayHitDistance,
  reverseContour,
  type Bounds,
} from "@/font/geometry";
import type { Contour, GlyphNode, Vec2 } from "@/font/types";
import { alongSpine, spineEnd, spineLength, spineStart } from "./shapes";
import { sweep } from "./sweep";
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
 * imported letter with only the inline switched on is reached by nothing: the
 * groove needs a skeleton and there is none. Fusing it anyway would leave the
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
}

/** The scale of a face that was drawn here, which knows its own pen. */
export function scaleOf(style: Style): CutScale {
  return {
    stem: style.pen.weight,
    ascender: style.metrics.ascender,
    descender: style.metrics.descender,
    xHeight: style.metrics.xHeight,
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
): Cutting {
  if (!reaches(cuts, strokes) || ink.length === 0 || !loaded()) return { contours: ink };

  let shape = unite(ink, roles, "whole");
  const stem = Math.max(scale.stem, 1);
  // Counted here rather than anywhere else, because here it is free: the
  // letter has just been fused, and counting its pieces is reading the
  // contours it already has rather than doing the geometry again.
  const was = pieces(shape);

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
  if (cuts.inline.on) knife.push(...inlineTool(strokes, cuts.inline, stem));
  if (cuts.slot.on) knife.push(...slotTool(bounds, cuts.slot, stem, scale));
  if (cuts.tooth.on) knife.push(...toothTool(bounds, cuts.tooth, stem, scale));
  if (cuts.split.on) knife.push(...splitTool(strokes, cuts.split, stem));
  shape = take(shape, knife);

  if (cuts.chamfer.on) shape = take(shape, chamferTool(shape, cuts.chamfer, stem));

  return { contours: shape, cut: { pieces: pieces(shape), was } };
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

function take(shape: Contour[], tool: Contour[]): Contour[] {
  return tool.length === 0 ? shape : subtract(shape, tool, "winding");
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
 * The same spine, swept with a thinner pen of the same angle and contrast, so
 * the groove narrows and widens exactly where the stroke does. Pulled back
 * from each end first, or it breaks out through the terminals and the letter
 * arrives in pieces -- which is a thing somebody may want, and is what setting
 * the inset to nothing does.
 *
 * Nothing means past the end rather than exactly at it. Run to exactly the end
 * of the spine, the groove's last edge lies exactly along the stroke's own end
 * cap, and whether that cuts through or leaves a bridge of no width is a
 * question about floating point rather than about the letter. Run a stem past
 * it, it breaks out because it was drawn breaking out.
 */
function inlineTool(strokes: Stroke[], inline: Cuts["inline"], stem: number): Contour[] {
  const width = Math.min(Math.max(inline.width, 0), 0.85) * stem;
  if (width <= 0) return [];
  const back = inline.inset * stem;

  const grooves: Contour[] = [];
  for (const stroke of strokes) {
    const spine = back > 0 ? shortened(stroke.spine, back) : lengthened(stroke.spine, stem);
    if (spine.segments.length === 0) continue;
    grooves.push(
      ...sweep({
        spine,
        pen: { weight: width, contrast: stroke.pen.contrast, angle: stroke.pen.angle },
        start: { kind: "butt" },
        end: { kind: "butt" },
        join: "round",
      }),
    );
  }
  return grooves;
}

/**
 * A gap wherever two strokes run into each other.
 *
 * Two spines are joined where they pass within about a stem of each other,
 * which is close enough that their swept ink certainly overlaps. Sampled
 * rather than solved: the answer only has to be near the join, because what is
 * put there is a square wider than the stroke.
 */
function splitTool(strokes: Stroke[], split: Cuts["split"], stem: number): Contour[] {
  const gap = split.size * stem;
  if (gap <= 0 || strokes.length < 2) return [];

  const near = stem * 1.15;
  const samples = strokes.map((stroke) => alongSpine(stroke.spine, SAMPLES));
  const lengths = strokes.map((stroke) => spineLength(stroke.spine));

  const found: Array<{ stroke: number; at: number; way: number }> = [];
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
      const ends = [atItsEnd(where[0]), atItsEnd(where[1])];
      /*
       * Both at their own ends is a tie, and the commonest one in the
       * alphabet: the lower bowl of a B starts where its stem starts. Length
       * used to settle it and settles it backwards on a heavy face, so what
       * settles it is which of the two bends. A stem is drawn straight and a
       * bowl is drawn round, and it is the bowl that leaves.
       */
      const bends = [arcsIn(strokes[one]), arcsIn(strokes[other])];
      const gives =
        rings[0] !== rings[1]
          ? rings[0]
            ? other
            : one
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
      const index = gives === one ? where[0] : where[1];

      /*
       * Just past the edge of the stroke it is leaving, and no further.
       *
       * Measured from that stroke's own edge rather than as a multiple of the
       * font's stem, because on a heavy face every unit further round is a
       * long way: the bowl of a Display B has barely more radius than the stem
       * has width, so an extra stem of clearance puts the break a third of the
       * way round the bowl instead of at the foot of it.
       */
      const clear = strokes[keeps].pen.weight / 2 + stem * 0.12 + gap / 2;
      // Towards whichever end of this stroke is further off, so a crossbar
      // joined at both ends gets a gap inside each stem rather than two gaps
      // in the same place.
      const way = index < SAMPLES / 2 ? 1 : -1;
      found.push({
        stroke: gives,
        at: (index / SAMPLES) * lengths[gives] + way * clear,
        way,
      });
    }
  }

  // Two strokes meeting a third at nearly the same place are one gap, not two:
  // cutting the same stretch twice is harmless, but two cuts a hair apart
  // leave a sliver of stroke between them.
  const kept: typeof found = [];
  for (const one of found) {
    if (
      kept.some((other) => other.stroke === one.stroke && Math.abs(other.at - one.at) < gap * 0.9)
    ) {
      continue;
    }
    kept.push(one);
  }

  /*
   * The gap is a short run of the stroke's own spine, swept with a pen a
   * little wider than its own.
   *
   * Which is the whole reason it follows the letter. A straight band across
   * the stroke is exact where the stroke is straight and a diagonal slash
   * where it curves, and on a heavy face the bowl of a B turns through a
   * right angle inside its own width -- so there is no length of band that
   * both crosses the stroke and stays on it. A piece of the spine cannot
   * miss, because it is the stroke.
   */
  return kept.flatMap(({ stroke, at, way }) => {
    const giving = strokes[stroke];
    const total = lengths[stroke];

    /*
     * The gap has to leave a stroke on both sides of it, or it is not a break.
     *
     * Sizes here are multiples of the font's stem, which is what keeps one
     * description meaning the same thing at every weight -- and the length of
     * an arm is not a multiple of the stem. On a Display face the arm of an E
     * is 209 units long and the stem it leaves is 175 wide, so clearing that
     * stem put the gap 71% of the way along the arm and the gap itself ran to
     * 89% of it: the arm came back as a stub on the stem and a crumb floating
     * where its terminal had been. The same setting on the text face cuts at
     * 15% and leaves the arm whole.
     *
     * So the break is held inside the stroke it is cutting. It stays at least
     * a gap's width from the far end, and if there is not room for that it
     * gives up rather than eating the terminal -- an arm too short to break is
     * an arm that stays whole, which is a letter somebody can still read.
     */
    // How much stroke has to survive past the gap, on the side away from the
    // join: enough to still read as a terminal rather than as a crumb.
    const spare = gap * 0.75;
    const lowest = way > 0 ? gap / 2 : spare + gap / 2;
    const highest = way > 0 ? total - spare - gap / 2 : total - gap / 2;
    if (highest < lowest) return [];
    const held = Math.min(Math.max(at, lowest), highest);

    const from = Math.max(0, held - gap / 2);
    const to = Math.min(total, held + gap / 2);
    if (to - from <= 0) return [];
    const piece = spineBetween(giving.spine, from, to);
    if (piece.segments.length === 0) return [];

    /*
     * A band straight across the stroke, square to it where it is being cut.
     *
     * It used to be the piece of spine itself, swept with a pen a little wider
     * than the stroke's own -- which follows the letter exactly and cannot
     * miss, and which turns itself inside out as soon as the stroke bends
     * tightly. A band swept along an arc has an inner edge of the arc's radius
     * less half the pen, so a pen approaching twice the radius collapses that
     * edge to a point: the bowl of a Display B turns at a radius of 128 and
     * the stroke alone is 175 wide, so there is no pen that both crosses the
     * stroke and stays a band. What came out was a fan -- a pie slice, narrow
     * at the counter and splayed across the outside of the letter -- and that
     * is the wedge that made a Display B read as a 5.
     *
     * Straight across, the cut is the same width all the way through however
     * tightly the stroke turns. It is only as long as it has to be to cross
     * the stroke, so where the letter curves away from it inside that length
     * it leaves the ink rather than reaching for it.
     */
    const middle = alongSpine(piece, 2);
    const centre = middle[Math.floor(middle.length / 2)] ?? spineStart(piece);
    const ends = [spineStart(piece), spineEnd(piece)];
    const run = { x: ends[1].x - ends[0].x, y: ends[1].y - ends[0].y };
    const along = Math.hypot(run.x, run.y);
    if (along < 1e-6) return [];
    const heading = { x: run.x / along, y: run.y / along };
    // Far enough to cross the stroke and its joins, and no further.
    const reach = giving.pen.weight * 0.75;
    const across = { x: -heading.y, y: heading.x };
    const half = gap / 2;
    return [
      poly([
        {
          x: centre.x - heading.x * half - across.x * reach,
          y: centre.y - heading.y * half - across.y * reach,
        },
        {
          x: centre.x + heading.x * half - across.x * reach,
          y: centre.y + heading.y * half - across.y * reach,
        },
        {
          x: centre.x + heading.x * half + across.x * reach,
          y: centre.y + heading.y * half + across.y * reach,
        },
        {
          x: centre.x - heading.x * half + across.x * reach,
          y: centre.y - heading.y * half + across.y * reach,
        },
      ]),
    ];
  });
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
function chamferTool(shape: Contour[], chamfer: Cuts["chamfer"], stem: number): Contour[] {
  const size = chamfer.size * stem;
  if (size <= 0) return [];

  /** Below this the outline is carrying on rather than turning. */
  const SHARP = (25 * Math.PI) / 180;

  const cut: Contour[] = [];
  for (const contour of shape) {
    const nodes = contour.nodes;
    if (nodes.length < 3) continue;
    const ink = contourArea(contour) >= 0 ? 1 : -1;

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
      // Ink on the inside of the turn, whichever way this contour runs.
      if (turn * ink <= 0) continue;

      // Never more than a share of the shorter of the two edges, or the cut
      // reaches past the corner and takes the next one with it.
      const room = Math.min(distance(here.point, previous.point), distance(here.point, next.point));
      const reach = Math.min(size, room * 0.45);
      if (reach <= 0) continue;

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
      cut.push(
        poly([
          { x: here.point.x - arriving.x * reach, y: here.point.y - arriving.y * reach },
          { x: here.point.x + out.x * reach, y: here.point.y + out.y * reach },
          { x: here.point.x + leaving.x * reach, y: here.point.y + leaving.y * reach },
        ]),
      );
    }
  }
  return cut;
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
    const box = contoursBounds([hole]);
    const middle = { x: (box.xMin + box.xMax) / 2, y: (box.yMin + box.yMax) / 2 };
    // Drawn at full size and then held to the counter, so that size 1 means
    // the shape fills the counter rather than the counter's box.
    const full = motifShape(motif.shape, box, 1);
    const drawn = scaleAbout(full, middle, size * roomInCounter(full, hole, middle));
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
      return [disc(middle, wide * 0.42, tall * 0.42)];
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
 * A spine pulled back from both of its ends.
 *
 * A ring has no ends, so it comes back as it was. Anything shorter than twice
 * the amount asked for disappears, which is the right answer: a groove that
 * cannot fit inside its own stroke should not be drawn at all.
 */
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

/**
 * The same spine with a straight run added at each end, along the way it was
 * going when it got there.
 *
 * For the groove that is meant to break out through the terminals. Straight
 * rather than curving on with the arc it leaves, because what this is for is
 * getting clear of the end of the stroke, and the shortest way out of a
 * terminal is the way the stroke was pointing.
 */
function lengthened(spine: Spine, by: number): Spine {
  if (spine.closed || by <= 0 || spine.segments.length === 0) return spine;
  const first = spine.segments[0];
  const last = spine.segments[spine.segments.length - 1];
  const head = endOf(first, "front");
  const tail = endOf(last, "back");
  return {
    closed: false,
    segments: [
      {
        kind: "line",
        from: { x: head.at.x - head.away.x * by, y: head.at.y - head.away.y * by },
        to: head.at,
      },
      ...spine.segments,
      {
        kind: "line",
        from: tail.at,
        to: { x: tail.at.x + tail.away.x * by, y: tail.at.y + tail.away.y * by },
      },
    ],
  };
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

function shortened(spine: Spine, by: number): Spine {
  if (spine.closed || by <= 0) return spine;
  const front = eatFrom(spine.segments, by, "front");
  const both = eatFrom(front, by, "back");
  return { segments: both, closed: false };
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
