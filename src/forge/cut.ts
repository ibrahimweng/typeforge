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
import { alongSpine, spineLength } from "./shapes";
import { sweep } from "./sweep";
import type { Style } from "./style";
import type { Spine, SpineSegment, Stroke } from "./types";

// ---------------------------------------------------------------------------
// What a cut is
// ---------------------------------------------------------------------------

/** Which side of the letter a saw runs along. */
export type Edge = "left" | "right" | "both" | "top" | "bottom";

/** What a counter is replaced with. */
/**
 * The shapes a counter can be replaced with.
 *
 * Geometric primitives, named for what they are. That is a decision and not
 * only a convenience -- see the note on where these forms recur, in the help.
 * A lozenge, a chevron and a nested diamond are figures that turn up in
 * geometric ornament everywhere there is any, and belong exclusively to
 * nobody; the symbol sets that a face like this is often reached for alongside
 * -- Adinkra, Nsibidi, Tifinagh -- are not that. Each of those carries
 * meaning, some of them are living scripts, and one of them has a documented
 * history of being mass-produced abroad with nothing going back to the people
 * whose symbols they are. None of them is in here, and the help says why.
 */
export type MotifShape =
  | "diamond"
  | "lozenge"
  | "nested"
  | "triangle"
  | "hourglass"
  | "chevron"
  | "bars"
  | "square"
  | "slot"
  | "dot"
  | "ring";

export interface Cuts {
  /**
   * Bands cut clean across the letter.
   *
   * The single most characteristic move of the faces this was built for, and
   * the one that reads at any size. Cut at an angle they stop looking like
   * rules across a page and start looking like the letter has been sliced.
   */
  slot: {
    on: boolean;
    /** How many bands. */
    count: number;
    /** How thick each band is, in stem widths. */
    width: number;
    /** Degrees the bands lean. */
    angle: number;
    /** How much of the letter's height is left uncut at top and bottom. */
    inset: number;
  };
  /**
   * A saw run along one edge of the letter.
   *
   * Cut as a comb of notches across the whole letter rather than fitted to its
   * outline, which is what a saw does: wherever the comb meets ink it leaves
   * teeth, and where it meets nothing it does nothing.
   */
  tooth: {
    on: boolean;
    /**
     * Distance from one tooth to the next, as a share of the x-height.
     *
     * The one size here that is not in stems, and deliberately. How fine a saw
     * looks is how many teeth run down the side of a letter, and a letter is
     * the same height at every weight -- so measured in stems the same setting
     * gave a Display half as many teeth as a Sans, each twice the size, and
     * what had been a saw on one face was three wedges on the other.
     */
    pitch: number;
    /** How far each notch reaches in, in stem widths. */
    depth: number;
    edge: Edge;
  };
  /** Corners cut off square. Applied last, so it also finds the corners the other cuts made. */
  chamfer: {
    on: boolean;
    /** How far back along each edge the cut starts, in stem widths. */
    size: number;
  };
  /**
   * A gap wherever two strokes run into each other.
   *
   * Found from the skeleton rather than from the outline: a join is two spines
   * passing within a stem of each other, which is a fact about how the letter
   * was built and does not have to be recovered from the ink afterwards.
   *
   * Cut square across the shorter of the two strokes rather than as a hole at
   * the crossing. Which stroke gives way is the whole difference between a
   * letter that has been taken apart and a letter with a chip out of it: the
   * arm of an E leaves the stem, the stem carries on.
   *
   * The other one that cannot reach an imported letter: without spines there
   * is nothing to find a join in, and an outline alone does not say which of
   * the two shapes crossing at a corner was the arm.
   */
  split: {
    on: boolean;
    /** How wide the gap is, in stem widths. */
    size: number;
  };
  /**
   * A groove down the middle of every stroke.
   *
   * The same skeleton swept a second time with a much thinner pen, and taken
   * away. Which is why it follows the letter exactly and costs almost nothing
   * to work out -- the hard part, where the middle of a stroke runs, is the
   * thing this half of the application already knows.
   *
   * It is also why this is one of the two that cannot reach a letter somebody
   * drew elsewhere: an imported outline has no middle to run down. Nothing
   * happens rather than something wrong, and the panel says so.
   */
  inline: {
    on: boolean;
    /** How wide the groove is, as a share of the stem. */
    width: number;
    /** How far short of each stroke end it stops, in stem widths. Zero lets it break out. */
    inset: number;
  };
  /** The hole inside a letter, replaced by a shape. */
  motif: {
    on: boolean;
    shape: MotifShape;
    /** How large, against the hole it replaces. One fills it. */
    size: number;
  };
}

/** A font that has had nothing taken out of it. */
export const NO_CUTS: Cuts = {
  slot: { on: false, count: 2, width: 0.34, angle: 0, inset: 0.14 },
  tooth: { on: false, pitch: 0.11, depth: 0.3, edge: "left" },
  chamfer: { on: false, size: 0.5 },
  split: { on: false, size: 0.45 },
  inline: { on: false, width: 0.3, inset: 0.45 },
  motif: { on: false, shape: "diamond", size: 1 },
};

export function noCuts(): Cuts {
  return {
    slot: { ...NO_CUTS.slot },
    tooth: { ...NO_CUTS.tooth },
    chamfer: { ...NO_CUTS.chamfer },
    split: { ...NO_CUTS.split },
    inline: { ...NO_CUTS.inline },
    motif: { ...NO_CUTS.motif },
  };
}

export type CutName = keyof Cuts;

export const CUT_NAMES: CutName[] = ["slot", "tooth", "inline", "motif", "split", "chamfer"];

/**
 * The two cuts made out of the skeleton rather than out of the outline.
 *
 * A groove is the spine swept again; a break is where two spines meet. Both
 * need to know how the letter was built, so neither can reach a letter that
 * arrived as an outline from somewhere else.
 *
 * Named here rather than in the panel that mentions it, because it is a fact
 * about the operation and not about how it is described. The panel reads this.
 */
export const FROM_SKELETON = new Set<CutName>(["inline", "split"]);

/** Whether anything is switched on. */
export function anyCut(cuts: Cuts | undefined): boolean {
  return cuts !== undefined && CUT_NAMES.some((name) => cuts[name].on);
}

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
  style: Style,
  cuts: Cuts,
  roles: Roles = "winding",
): Cutting {
  if (!reaches(cuts, strokes) || ink.length === 0 || !loaded()) return { contours: ink };

  let shape = unite(ink, roles);
  const stem = Math.max(style.pen.weight, 1);
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
  if (cuts.slot.on) knife.push(...slotTool(bounds, cuts.slot, stem, style));
  if (cuts.tooth.on) knife.push(...toothTool(bounds, cuts.tooth, stem, style));
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
  return pieces(unite(ink, "winding"));
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
function slotTool(bounds: Bounds, slot: Cuts["slot"], stem: number, style: Style): Contour[] {
  const { ascender, descender } = style.metrics;
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
      turned(
        rect(centre.x - reach, at - thickness / 2, reach * 2, thickness),
        centre,
        turn,
      ),
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
function toothTool(bounds: Bounds, tooth: Cuts["tooth"], stem: number, style: Style): Contour[] {
  const pitch = Math.max(tooth.pitch * style.metrics.xHeight, stem * 0.1);
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

    const edge = side === "left" ? bounds.xMin : side === "right" ? bounds.xMax : side === "bottom" ? bounds.yMin : bounds.yMax;
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
 */
function inlineTool(strokes: Stroke[], inline: Cuts["inline"], stem: number): Contour[] {
  const width = Math.min(Math.max(inline.width, 0), 0.85) * stem;
  if (width <= 0) return [];
  const back = inline.inset * stem;

  const grooves: Contour[] = [];
  for (const stroke of strokes) {
    const spine = back > 0 ? shortened(stroke.spine, back) : stroke.spine;
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

  const found: Array<{ stroke: number; at: number }> = [];
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
       * break. Otherwise the shorter one gives way, which is the arm leaving
       * its stem rather than the stem leaving its arm.
       */
      const rings = [strokes[one].spine.closed, strokes[other].spine.closed];
      const gives =
        rings[0] !== rings[1]
          ? rings[0]
            ? other
            : one
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
      found.push({ stroke: gives, at: (index / SAMPLES) * lengths[gives] + way * clear });
    }
  }

  // Two strokes meeting a third at nearly the same place are one gap, not two:
  // cutting the same stretch twice is harmless, but two cuts a hair apart
  // leave a sliver of stroke between them.
  const kept: typeof found = [];
  for (const one of found) {
    if (kept.some((other) => other.stroke === one.stroke && Math.abs(other.at - one.at) < gap * 0.9)) {
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
  return kept.flatMap(({ stroke, at }) => {
    const giving = strokes[stroke];
    const total = lengths[stroke];
    const from = Math.max(0, at - gap / 2);
    const to = Math.min(total, at + gap / 2);
    if (to - from <= 0) return [];
    const piece = spineBetween(giving.spine, from, to);
    if (piece.segments.length === 0) return [];
    return sweep({
      spine: piece,
      pen: { weight: giving.pen.weight * 1.35, contrast: giving.pen.contrast, angle: giving.pen.angle },
      start: { kind: "butt" },
      end: { kind: "butt" },
      join: "round",
    });
  });
}

/** How finely a spine is sampled when looking for where two of them meet. */
const SAMPLES = 24;

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
      const room = Math.min(
        distance(here.point, previous.point),
        distance(here.point, next.point),
      );
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
      return [rhombus(middle, wide, tall), reverseContour(rhombus(middle, wide * 0.42, tall * 0.42))];
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
  const at = (x: number, y: number, inX: number, inY: number, outX: number, outY: number): GlyphNode => ({
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
