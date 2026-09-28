/**
 * Slab terminals.
 *
 * Turning a sans into a slab serif by finding where each stroke ends and
 * laying a bar across it. This is the change that most obviously makes one
 * design out of another, and it needs no knowledge of which letter it is
 * looking at.
 *
 * A stroke end is a short straight edge whose two neighbouring edges run
 * perpendicular to it and point in opposite directions -- the flat bottom of a
 * stem with its two sides running back up, or the flat end of an arm. That
 * description finds all four ends of an H, both ends of an I, the two feet and
 * the stem top of an n, and the three arm ends of an E.
 *
 * It also finds one thing that is not a stroke end, and the fix is what makes
 * this reliable: the tall inner edge of an E, between the top arm and the
 * middle one, has perpendicular neighbours pointing opposite ways just as a
 * real terminal does. It is told apart by which way the outline turns. A
 * terminal is convex, bulging away from the letter; that notch is concave,
 * cutting into it. Comparing the turn against the contour's own winding
 * settles it without reference to any measurement, so it holds at any size and
 * any weight.
 *
 * Two more things are not stroke ends, and both only show up on real fonts.
 * The straight inside edge of a counter -- the flat back of B's bowls, the
 * upright of 4's triangle -- has the same shape as a terminal when it is read
 * against the counter's own winding, so counters are left out altogether: a
 * stroke never ends on the edge of a hole. And on a font that already has
 * serifs, the flat ends the shape test finds are the tips of those serifs and
 * beaks, not the ends of strokes. They are told apart by being much thinner
 * than the letter's strokes, and are left alone; see `strokeOf`.
 *
 * The slabs are laid over the letter rather than merged into it, which is how
 * a serif is drawn by hand and what the overlap removal on export already
 * expects.
 */

import {
  contourSegments,
  contoursBounds,
  flattenContour,
  inkRunsAt,
  isClockwise,
  rayHitDistance,
  reverseContour,
  type Segment,
} from "./geometry";
import { classifyContours } from "./outline";
import type { Contour, GlyphNode, Vec2 } from "./types";

export interface SlabOptions {
  /** How far the slab reaches past the stroke on each side, in font units. */
  projection: number;
  /** How far the slab reaches back along the stroke, in font units. */
  thickness: number;
  /**
   * Longest edge still treated as a stroke end, as a backstop. The length of an
   * edge relative to its neighbours does most of the work; this catches a wide
   * flat area whose neighbours happen to be longer still.
   */
  maxWidth: number;
  /**
   * Weight still to come, in font units. It grows every slab towards its
   * neighbour by this much again, so it is taken out of the room first:
   * leaving it in let the feet of a heavy n grow into each other until a
   * crack a few units wide was all that parted them.
   */
  weight?: number;
  /**
   * Whether the top of an upright stem gets a flag to the left rather than a
   * bar across: the lowercase of a slab serif.
   */
  flagTops?: boolean;
}

/** A stroke end: where it is, how wide, and which way the stroke runs. */
export interface Terminal {
  /** Middle of the end edge. */
  centre: Vec2;
  /** Unit vector along the end edge. */
  along: Vec2;
  /** Unit vector pointing back into the stroke. */
  inward: Vec2;
  width: number;
  /** Which way the contour this end belongs to is wound. */
  clockwise: boolean;
}

function unit(from: Vec2, to: Vec2): { x: number; y: number; length: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x: 0, y: 0, length: 0 };
  return { x: dx / length, y: dy / length, length };
}

/** Direction a segment sets off in, treating a curve by its chord. */
function chord(segment: Segment): { x: number; y: number; length: number } {
  return unit(segment.from, segment.to);
}

/** How square two directions are: zero when perpendicular. */
const PERPENDICULAR_TOLERANCE = 0.26; // about 15 degrees
/** How far from level or upright an end may lie: about three degrees. */
const SQUARE_END = 0.05;
/** How far a diagonal may lean from square to a level end it is cut off by. */
const SLANTED_SIDES = 0.8;
/** How opposed the two sides of a stroke have to be. */
const OPPOSITE_TOLERANCE = -0.9;
/** How much longer than its stroke an end may measure and still count. */
const END_SLACK = 1.25;
/**
 * How thin an end may be, against the letter's strokes, and still be the end
 * of one of them rather than the tip of a serif, a beak or a hairline.
 *
 * The two populations are far apart, which is what makes a plain ratio enough.
 * Geist's thinnest real ends -- the tops of n and r, where the arch takes a
 * bite out of the stem -- measure 0.86 of its stem; Lora's serif tips measure
 * 0.52 and the tips of the beaks on its E, L and T 0.39 to 0.45. Six tenths
 * sits in the gap with room either side, and leaves a sans with some contrast
 * in its arms still counted as a sans.
 */
const THINNEST_END = 0.6;
/**
 * And how wide. An end much wider than the strokes is not the end of one: on
 * Lora it is the outer edge of an arm and the beak hanging off it together,
 * two hundred units tall on an E whose stem is eighty.
 */
const WIDEST_END = 1.75;

/**
 * How thick the strokes of a letter are, as a ruler across it would find.
 *
 * Horizontal rulers at several heights, and each run of ink they cross checked
 * against a vertical ruler through its middle; the shorter of the two is the
 * thickness of the stroke there. A horizontal ruler alone reads a stem right
 * but reads a bar lying on its side -- a hyphen, the arm of an E where it
 * crosses one -- as its whole length, and the shorter of the two answers is
 * the one that is across the stroke rather than along it. The median over all
 * the rulers then settles on what most of the letter is made of, which is the
 * stems: an E ruled at seven heights crosses its stem at six of them.
 *
 * Null when there is nothing to rule across, and then no end is turned away
 * for its width.
 */
function strokeOf(contours: Contour[]): number | null {
  if (contours.length === 0) return null;
  const box = contoursBounds(contours);
  const height = box.yMax - box.yMin;
  if (!(height > 0)) return null;
  const found: number[] = [];
  for (const share of [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) {
    const y = box.yMin + height * share;
    for (const [from, to] of inkRunsAt(contours, y)) {
      const middle = (from + to) / 2;
      const across = inkRunsAt(contours, middle, "x").find(([low, high]) => low <= y && y <= high);
      const thickness = across ? Math.min(to - from, across[1] - across[0]) : to - from;
      if (thickness > 0) found.push(thickness);
    }
  }
  if (found.length === 0) return null;
  found.sort((first, second) => first - second);
  return found[Math.floor((found.length - 1) / 2)];
}

/**
 * Find the stroke ends of one outline.
 *
 * Only straight edges are considered. A stroke that tapers into a curve has no
 * flat end to sit a slab on, and guessing at one would put a bar across the
 * middle of a curve.
 */
export function findTerminals(contours: Contour[], maxWidth: number): Terminal[] {
  const terminals: Terminal[] = [];
  /*
   * Only the ink's own outlines. A counter is wound against the letter, so the
   * convexity test below -- which reads the turn against the contour's own
   * winding -- sees its corners inside out: the flat back of each of Geist's B
   * bowls read as a stroke end 232 units across, and a slab stood up in the
   * middle of the letter, half in the bowl and half in the stem. The same
   * happened in b and in the triangle of 4. A stroke cannot end on the edge of
   * a hole, so holes are not asked.
   */
  const ink = contours.length > 1 ? classifyContours(contours) : contours.map(() => true);
  const stroke = strokeOf(contours);
  const box = contoursBounds(contours);
  const polylines = contours.map((contour) => flattenContour(contour, 8));
  const carriesStem = (terminal: Terminal): boolean => {
    const back = terminal.width * 2;
    const reach = terminal.width * 1.2;
    const base = {
      x: terminal.centre.x + terminal.inward.x * back,
      y: terminal.centre.y + terminal.inward.y * back,
    };
    // Which side of the arm is the inside of the letter: away from the edge
    // of the letter it is flush with.
    const middle = (box.yMin + box.yMax) / 2;
    const into = terminal.centre.y > middle ? -1 : 1;
    return insideInk(polylines, { x: base.x, y: base.y + into * reach });
  };

  const standsOnBar = (terminal: Terminal): boolean => {
    const depth = terminal.width * STUB;
    const aside = terminal.width * 1.3;
    const probe = (side: -1 | 1) => ({
      x: terminal.centre.x + terminal.inward.x * depth + terminal.along.x * side * aside,
      y: terminal.centre.y + terminal.inward.y * depth + terminal.along.y * side * aside,
    });
    return insideInk(polylines, probe(-1)) && insideInk(polylines, probe(1));
  };

  for (const [index, contour] of contours.entries()) {
    if (!ink[index]) continue;
    const segments = contourSegments(contour);
    if (segments.length < 3) continue;
    /*
     * Nor a dot. The square dot of Geist's i and j has two flat ends with
     * square sides like any stem, and each got a slab: a cross over the
     * light i, and at the heaviest a block run into the stem. A dot is no
     * longer either way than a stroke is wide, near enough.
     */
    if (stroke !== null) {
      const own = contoursBounds([contour]);
      if (Math.max(own.xMax - own.xMin, own.yMax - own.yMin) <= stroke * DOT) continue;
    }
    // Winding says which way a convex corner turns for this contour.
    const convexSign = isClockwise(contour) ? -1 : 1;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (segment.kind !== "line") continue;

      const here = chord(segment);
      if (here.length === 0 || here.length > maxWidth) continue;

      const previous = chord(segments[(i - 1 + segments.length) % segments.length]);
      const next = chord(segments[(i + 1) % segments.length]);
      if (previous.length === 0 || next.length === 0) continue;

      // An end is shorter than the stroke running away from it. Without this a
      // plain rectangle offers four candidates rather than two: it is symmetric,
      // so nothing but relative length says which pair is the end and which is
      // the side. Comparing against the longer neighbour rather than both keeps
      // the top of an n's stem, where the arch springs away after only a short
      // run.
      //
      // The comparison is loose because it has to survive the other controls
      // moving things about. On a real letter an end is a fifth the length of
      // its stroke or less, so a little slack costs nothing -- but exactly at
      // the boundary it decided whether a slab existed. Raising t's crossbar
      // left 168 units of stem above it, just under the 185 the stem is wide,
      // and the slab on the ascender vanished while the others stayed.
      const longer = Math.max(previous.length, next.length);

      /*
       * Only a level or upright end. A slab stands square to the letter; laid
       * along the slanted cut at the end of the tail of an &, it stuck out
       * sideways like a stick.
       */
      if (Math.min(Math.abs(here.x), Math.abs(here.y)) > SQUARE_END) continue;
      /*
       * Both sides square to the end, and running opposite each other -- or,
       * for a level end, the two sides of a diagonal cut off level: the arm
       * and the leg of a k, the feet of A, the tops of v and y, which a slab
       * serif gives a slab like any stem.
       */
      const level = Math.abs(here.y) <= SQUARE_END;
      const square = level ? SLANTED_SIDES : PERPENDICULAR_TOLERANCE;
      if (Math.abs(here.x * previous.x + here.y * previous.y) > square) continue;
      if (Math.abs(here.x * next.x + here.y * next.y) > square) continue;
      if (previous.x * next.x + previous.y * next.y > OPPOSITE_TOLERANCE) continue;

      // Convex, so this is the end of a stroke rather than a notch cut into one.
      const turnIn = previous.x * here.y - previous.y * here.x;
      const turnOut = here.x * next.y - here.y * next.x;
      if (Math.sign(turnIn) !== convexSign || Math.sign(turnOut) !== convexSign) continue;

      // The stroke runs back the way the neighbouring edges point.
      const inward = {
        x: (previous.x * -1 + next.x) / 2,
        y: (previous.y * -1 + next.y) / 2,
      };
      const inwardLength = Math.hypot(inward.x, inward.y);
      if (inwardLength === 0) continue;
      // Square across the end, whichever way the stroke leans behind it, so
      // the slab is a rectangle rather than leaning with a diagonal.
      const facing = inward.x * -here.y + inward.y * here.x > 0 ? 1 : -1;
      const terminal: Terminal = {
        centre: { x: (segment.from.x + segment.to.x) / 2, y: (segment.from.y + segment.to.y) / 2 },
        along: { x: here.x, y: here.y },
        inward: { x: -here.y * facing, y: here.x * facing },
        width: here.length,
        clockwise: convexSign === -1,
      };

      if (here.length > longer * END_SLACK) continue;
      /*
       * And not the tip of a serif. An arm lying on its side has white on its
       * inner side a little way back from its end -- between the arms of an
       * E. The foot or head of a serif has the stem it carries standing
       * there instead.
       */
      if (Math.abs(terminal.inward.x) > Math.abs(terminal.inward.y) && carriesStem(terminal))
        continue;
      /*
       * Nor a stub standing on a bar: the top of a t, which meets its
       * crossbar a stroke's width or so down. A slab there is a second
       * crossbar just over the first -- the t read as a struck-through t --
       * and a slab serif leaves it plain, as Rockwell and Roboto Slab do.
       */
      if (standsOnBar(terminal)) continue;

      /*
       * About as wide as the strokes of the letter it is on.
       *
       * The shape test above describes the tip of a serif just as well as the
       * end of a stem: a short flat edge with its two sides running back square
       * and parallel. On a font with serifs that is nearly all it finds. Every
       * stem of Lora already ends in a serif, whose foot is too wide to pass for
       * an end, so what came back instead were the tips of the serifs
       * themselves and of the beaks on E, F, L, T and s -- and a slab on each,
       * standing crosswise on a serif that was already there. That was the row
       * of little crosses along Lora's E and the second serif piled on every
       * foot. Those tips are half a stem across or less; the end of a stroke is
       * the stroke's own width.
       *
       * Measured against the letter rather than the em, so a Light and a Black
       * are judged alike.
       */
      if (
        stroke !== null &&
        (here.length < stroke * THINNEST_END || here.length > stroke * WIDEST_END)
      )
        continue;

      terminals.push(terminal);
    }
  }

  return terminals;
}

/** How long a piece of ink may be, against the letter's strokes, and be a dot. */
const DOT = 1.8;
/** How far down, in widths of the stroke, a stub on a bar meets the bar. */
const STUB = 1.6;

/**
 * How near the top or bottom of the letter the edge of an arm has to be to
 * count as that edge, as a share of the arm's thickness.
 */
const FLUSH = 0.25;
/**
 * How much of the white beside a stroke end a slab may take, from each side.
 * Less than half, so two slabs reaching for each other -- the feet of an m --
 * still leave a gap between them rather than meeting.
 */
const SHARE_OF_GAP = 0.4;
/** Where across the slab's thickness the white beside it is measured. */
const GAP_DEPTHS = [0.15, 0.5, 0.85];

/** Even-odd containment against flattened outlines: is this point in the ink? */
function insideInk(polylines: Vec2[][], point: Vec2): boolean {
  let inside = false;
  for (const polygon of polylines) {
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i];
      const b = polygon[j];
      if (a.y > point.y !== b.y > point.y) {
        const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
        if (point.x < x) inside = !inside;
      }
    }
  }
  return inside;
}

/**
 * Lay a slab across every stroke end.
 *
 * The bars are returned alongside the original contours rather than merged
 * into them. Overlapping pieces are how a serif is drawn -- a bar laid over a
 * stem -- and the export already knows to fuse them; under the non-zero fill
 * that font rasterisers use, the overlap is invisible in the meantime.
 */
export function addSlabs(contours: Contour[], options: SlabOptions): Contour[] {
  const { projection, thickness, maxWidth } = options;
  const growth = Math.max(0, options.weight ?? 0);
  if (projection <= 0 && thickness <= 0) return contours;

  const terminals = findTerminals(contours, maxWidth);
  if (terminals.length === 0) return contours;

  const box = contoursBounds(contours);
  const polylines = contours.map((contour) => flattenContour(contour, 12));

  const slabs: Contour[] = [];
  for (const terminal of terminals) {
    const half = terminal.width / 2;
    const along = terminal.along;
    const inward = terminal.inward;

    const at = (offset: number, depth: number): Vec2 => ({
      x: terminal.centre.x + along.x * offset + inward.x * depth,
      y: terminal.centre.y + along.y * offset + inward.y * depth,
    });

    /*
     * How far the slab may reach out on one side: the projection asked for,
     * unless the letter comes back within reach.
     *
     * A slab used to be the full projection on both sides whatever lay beside
     * it. The foot of Geist's k sits right up against the foot of its leg, and
     * the slab ran across the white between them and into the leg, which is
     * the odd bar there; heavier, the same happens between the feet of an m.
     * So each side looks along the slab, across the white beside the stroke,
     * and takes at most a share of what it finds. Rulers that start in ink --
     * where the side of the stroke is shorter than the slab is thick and the
     * arch of an n has already sprung away -- say nothing about white and are
     * not asked.
     */
    const reach = (side: -1 | 1): number => {
      const heading = { x: along.x * side, y: along.y * side };
      let room = Infinity;
      for (const share of GAP_DEPTHS) {
        const start = at(side * (half + 0.5), thickness * share);
        if (insideInk(polylines, start)) continue;
        room = Math.min(room, rayHitDistance(polylines, start, heading));
      }
      return Math.max(0, Math.min(projection, room * SHARE_OF_GAP - growth));
    };

    let low = -(half + reach(-1));
    let high = half + reach(1);

    /*
     * The top of a lowercase stem gets a flag, not a bar. A bar across the
     * top of the ascender of h, b or l, or of the stem of n, i or u, read as
     * a stroke through it -- h as a barred h -- where a slab serif's
     * lowercase has its serif to the left only, as Rockwell, Courier and
     * Roboto Slab do. Diagonals cut off level keep their bars.
     */
    if (options.flagTops && inward.y < -0.9 && Math.abs(along.y) < 0.1) {
      if (along.x > 0) high = half;
      else low = -half;
    }

    /*
     * An arm gets a beak, not a bar.
     *
     * The slab reaches across the stroke on both sides, which on a stem is a
     * serif. On a stroke lying on its side -- the arms of E, F, L, T and Z --
     * across the stroke is up and down, and a bar there went up past the top of
     * the letter from the top arm and down below the baseline from the bottom
     * one: the tall posts through the ends of Geist's E. A slab-serif E has a
     * beak instead, hanging from the top arm into the letter and standing up
     * from the bottom arm, flush with the outside of the arm on the other side.
     *
     * The outside is whichever edge of the arm is the top or bottom of the
     * letter. An arm with neither -- the middle arm of E and F, the crossbar of
     * 4 or t -- gets nothing, because it has no outside to be flush with and a
     * bar through it both ways is the post again in miniature. An arm that is
     * both is a bar on its own, a hyphen or a dash, and gets nothing either.
     */
    if (Math.abs(inward.x) > Math.abs(inward.y)) {
      const tolerance = terminal.width * FLUSH;
      const flush = (side: -1 | 1): boolean => {
        const corner = at(side * half, 0);
        return corner.y >= box.yMax - tolerance || corner.y <= box.yMin + tolerance;
      };
      const lowFlush = flush(-1);
      const highFlush = flush(1);
      if (lowFlush === highFlush) continue;
      if (lowFlush) low = -half;
      else high = half;
    }

    // Start flush with the end of the stroke so the letter keeps its height,
    // and reach back into it.
    const points = [at(low, 0), at(high, 0), at(high, thickness), at(low, thickness)];
    const nodes: GlyphNode[] = points.map((point) => ({
      point,
      handleIn: null,
      handleOut: null,
      type: "corner",
    }));
    const slab: Contour = { nodes, closed: true };

    /*
     * Wind the bar the same way as the letter it belongs to.
     *
     * Which way round a contour runs decides whether it is ink or a hole, and
     * emboldening reads it to know which way is outward. A bar wound against
     * the letter got thinner as weight was added: an I with serifs measured 382
     * units wide unweighted and 269 at weight 80, shrinking as it was asked to
     * grow. It went unseen while slabs were added after the weight, and
     * appeared the moment they were added before it.
     */
    slabs.push(isClockwise(slab) === terminal.clockwise ? slab : reverseContour(slab));
  }

  if (slabs.length === 0) return contours;
  return [...contours, ...slabs];
}

/**
 * The slabs of a letter made lighter or bolder, as the rectangles they are.
 *
 * They used to be weighted with the letter, as contours overlapping it, and
 * each was measured against the strokes it lay across: the ruler across a
 * slab on a diagonal found the diagonal's own edges a few units off and held
 * the slab back, so a light k, x or A stood on blocks three times the
 * weight of its stems, and a heavy one grew notches where the slab and the
 * stroke under it moved by different amounts. A slab is a bar. It moves as
 * one: its flush edge goes with the end of the stroke, out by the weight or
 * in by it, its thickness and its length change by the weight on each side,
 * and lighter it keeps a third of itself and a hairline, as a stroke does.
 *
 * `letter` is the letter the slabs were laid on, before the weight, which
 * says which edge of each is the flush one: the edge with paper outside it
 * and ink under the edge across from it. At no weight at all the slabs are
 * only joined where they end a crack apart.
 */
export function weighSlabs(
  slabs: Contour[],
  letter: Contour[],
  weight: number,
  unitsPerEm: number,
  /** The letter as the weight left it, where it has been weighted. */
  weighted?: Contour[],
): Contour[] {
  const polylines = letter.map((contour) => flattenContour(contour, 12));
  const moved = weighted?.map((contour) => flattenContour(contour, 12));
  const hairline = unitsPerEm * 0.008;
  const resize = (length: number): number =>
    weight >= 0 ? length + 2 * weight : Math.max(length + 2 * weight, hairline, length / 3);
  const bars = slabs.map((slab) => {
    if (slab.nodes.length !== 4) return null;
    const q = slab.nodes.map((node) => node.point);
    const c = {
      x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4,
      y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4,
    };
    const edges = q.map((point, index) => {
      const next = q[(index + 1) % 4];
      const middle = { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 };
      const out = unit(c, middle);
      return { middle, out, far: out.length };
    });
    const probe = (index: number) => {
      const { middle, out } = edges[index];
      return insideInk(polylines, { x: middle.x + out.x, y: middle.y + out.y });
    };
    let flush = -1;
    for (let index = 0; index < 4 && flush < 0; index++)
      if (!probe(index) && probe((index + 2) % 4)) flush = index;
    const axis = edges[flush < 0 ? 0 : flush];
    const u = { x: axis.out.x, y: axis.out.y };
    const thickness = resize(axis.far * 2);
    /*
     * Flush with the stroke's end where there is one -- where the weight
     * left it, which is not always by the weight: the top of a j's stem
     * comes up short of its dot, and a slab moved the whole weight met it.
     * Else about the middle.
     */
    let outer = flush < 0 ? thickness / 2 : axis.far + weight;
    if (flush >= 0 && moved) {
      const depth = axis.far * 2 + 2 * Math.abs(weight);
      const from = {
        x: axis.middle.x - u.x * depth,
        y: axis.middle.y - u.y * depth,
      };
      if (insideInk(moved, from)) {
        const out = rayHitDistance(moved, from, u) - depth;
        if (Number.isFinite(out) && Math.abs(out) <= Math.abs(weight) * 1.5 + 1)
          outer = axis.far + out;
      }
    }
    const side = resize(edges[flush < 0 ? 1 : (flush + 1) % 4].far * 2) / 2;
    return {
      c,
      u,
      v: { x: -u.y, y: u.x },
      outer,
      inner: outer - thickness,
      low: -side,
      high: side,
    };
  });

  /*
   * Two slabs that end a crack apart -- the foot of a k's stem and the foot of
   * its leg, which sit side by side -- are one slab. Each takes a share of the
   * white between it and its neighbour, which leaves a gap; where that gap
   * is narrower than an opening it reads as a flaw, not as two serifs, and a
   * slab serif joins them.
   */
  const crack = unitsPerEm * 0.036;
  const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
  bars.forEach((one, i) => {
    if (!one) return;
    bars.forEach((other, j) => {
      if (!other || j <= i || dot(one.u, other.u) < 0.99) return;
      const apart = { x: other.c.x - one.c.x, y: other.c.y - one.c.y };
      // The same band across: the one's flush edge where the other's is.
      if (Math.abs(dot(apart, one.u) + other.outer - one.outer) > 1) return;
      const offset = dot(apart, one.v);
      // How far the one's end is from the other's, along them.
      const gap = offset > 0 ? offset + other.low - one.high : one.low - (offset + other.high);
      if (!(gap > 0 && gap < crack)) return;
      const reach = gap / 2 + 0.5;
      if (offset > 0) {
        one.high += reach;
        other.low -= reach;
      } else {
        one.low -= reach;
        other.high += reach;
      }
    });
  });

  return slabs.map((slab, index) => {
    const bar = bars[index];
    if (!bar) return slab;
    const { c, u, v } = bar;
    const nodes = slab.nodes.map((node) => {
      const dx = node.point.x - c.x;
      const dy = node.point.y - c.y;
      const across = dx * u.x + dy * u.y > 0 ? bar.outer : bar.inner;
      const along = dx * v.x + dy * v.y > 0 ? bar.high : bar.low;
      return {
        ...node,
        point: { x: c.x + u.x * across + v.x * along, y: c.y + u.y * across + v.y * along },
      };
    });
    return { ...slab, nodes };
  });
}
