/**
 * Putting material on.
 *
 * The cut layer's other half. Everything in the pen half of this application
 * adds ink by drawing it -- a spine swept, a serif laid on an end -- and the
 * cut layer takes ink away afterwards. Neither of them can reach the moves
 * that add ink to the letter *as a whole*: a block shadow thrown off it, a rim
 * grown all round it, a point built out of every corner. Those are not shapes
 * a pen can make and they are not holes, so they are a layer of their own,
 * running on the fused letter exactly as the cuts do.
 *
 * Sizes are in stem widths, for the same reason and by the same argument as
 * the cuts: a shadow forty units long is a hint on a display face and a
 * doubling on a hairline, and a family cast from one description has to stay
 * cast the same way at every weight.
 *
 * The two that move the whole letter -- the shadow and the rim -- are done by
 * copying it and fusing the copies, which is exactly what those shapes are.
 * All the copies go into a single union rather than being added one at a time,
 * so a shadow twenty copies long costs one boolean and not twenty.
 */

import { loaded, unite, type Roles } from "@/font/boolean";
import { contourArea } from "@/font/geometry";
import type { Contour, GlyphNode, Vec2 } from "@/font/types";
import type { CutScale } from "./cut";
import { alongSpine } from "./shapes";
import type { Stroke } from "./types";

/*
 * The description of a cast lives a layer down, because a font somebody opened
 * and a pile of drawings somebody made elsewhere are cast on by the same one.
 * It is handed straight back out again, so everything that reaches for it here
 * still finds it here.
 */
import {
  anyCast,
  CAST_NAMES,
  FROM_SKELETON,
  NO_CAST,
  noCast,
  type Cast,
  type CastName,
  type CastOrder,
} from "@/font/cast";

export {
  anyCast,
  CAST_NAMES,
  FROM_SKELETON,
  NO_CAST,
  noCast,
  type Cast,
  type CastName,
  type CastOrder,
};

/** How many places along a spine are looked at when hunting for a join. */
const SAMPLES = 96;

/**
 * Whether any of the operations that are on can do anything to this ink.
 *
 * Not the same question as whether any are on, and the difference is a whole
 * boolean: an imported letter with only the weld switched on is reached by
 * nothing, because a weld is a place where two spines meet and there are no
 * spines. Fusing it anyway would leave the drawing identical and its outline
 * rewritten, which is work done to no end.
 */
export function reachesCast(cast: Cast | undefined, strokes: Stroke[]): boolean {
  if (cast === undefined) return false;
  return CAST_NAMES.some(
    (name) => cast[name].on && (strokes.length > 0 || !FROM_SKELETON.has(name)),
  );
}

/**
 * The letter with the cast put on it.
 *
 * The order inside the layer is not a preference. The spur and the weld are
 * both local -- they find a place on the letter and add ink there -- so they
 * go first, and the shadow that is thrown afterwards is thrown by a letter
 * that already has them. The rim goes last of all, so that it runs round the
 * shadow too rather than round a letter the shadow then buries.
 */
export function castInk(
  ink: Contour[],
  strokes: Stroke[],
  scale: CutScale,
  cast: Cast,
  roles: Roles = "winding",
): Contour[] {
  if (!reachesCast(cast, strokes) || ink.length === 0 || !loaded()) return ink;

  let shape = unite(ink, roles, "whole");
  const stem = Math.max(scale.stem, 1);

  const local: Contour[] = [];
  if (cast.spur.on) local.push(...spurTool(shape, cast.spur, stem));
  if (cast.weld.on) local.push(...weldTool(strokes, cast.weld, stem));
  if (local.length > 0) shape = unite([...shape, ...local], "winding", "whole");

  if (cast.extrude.on) shape = extruded(shape, cast.extrude, stem);
  if (cast.outline.on) shape = outlined(shape, cast.outline.width * stem);

  return shape;
}

// ---------------------------------------------------------------------------
// The operations
// ---------------------------------------------------------------------------

/**
 * The letter thrown along a line, with everything it passes through filled.
 *
 * Done by halving. Sweeping a shape along a line is a Minkowski sum, and a
 * Minkowski sum is associative -- sweeping by half the line and then sweeping
 * the answer by half the line again covers exactly the same ground as sweeping
 * by the whole of it. So the throw is halved until the step is shorter than a
 * unit and a half, at which point the shape and the shape moved by that step
 * are touching everywhere and their union is the swept ground; then the answer
 * is doubled back up. A throw of any length costs about eight unions, because
 * the count follows the logarithm of the distance and not the distance.
 *
 * Two other ways were tried and are worth knowing about.
 *
 * Stamping copies along the line leaves a staircase on every edge not parallel
 * to the throw, as deep as the gap between copies: a shadow two and a half
 * stems long came back with a serrated A. Closing it needs a copy every unit,
 * which is hundreds of them.
 *
 * Laying a band along each piece of the outline is exact on paper and wrong in
 * practice. The bands round a counter should fuse into a ring and they fuse
 * into a disc, so an O lost its counter at a throw of half a stem. Halving
 * uses nothing but the union of a shape with a copy of itself, which is the
 * one operation here already known to keep its counters.
 */
function extruded(shape: Contour[], extrude: Cast["extrude"], stem: number): Contour[] {
  const reach = extrude.distance * stem;
  if (reach <= 0) return shape;

  const radians = (extrude.angle * Math.PI) / 180;

  /*
   * Short enough that a shape and the same shape moved by it overlap all along
   * their touching edges, which is what makes the union at the bottom of the
   * halving the swept ground rather than two shapes side by side. A unit and a
   * half is below the resolution a font file can hold, so nothing that follows
   * can see the difference.
   */
  const STEP = 1.5;
  const halvings = Math.max(0, Math.ceil(Math.log2(Math.max(reach / STEP, 1))));
  const step = reach / 2 ** halvings;

  let swept = grownBy(shape, Math.cos(radians) * step, Math.sin(radians) * step);
  for (let round = 0; round < halvings; round++) {
    const along = step * 2 ** round;
    swept = grownBy(swept, Math.cos(radians) * along, Math.sin(radians) * along);
  }
  return swept;
}

/**
 * A shape and the same shape moved, fused into one, and tidied after.
 *
 * Tidied because every union leaves the straight runs chopped into collinear
 * pieces, and the halving would carry all of them into the next union.
 *
 * Refitting the curves as well was tried and is not here. It takes the point
 * count down by two thirds and takes the shape apart while doing it -- a
 * letter that was eleven contours came back as two hundred and eleven, because
 * an outline moved even a tenth of a unit no longer touches the copy of itself
 * it is supposed to be fusing with. The union has to be handed exactly what it
 * was given, and only the points that change nothing can go.
 */
function grownBy(shape: Contour[], dx: number, dy: number): Contour[] {
  /*
   * Moved a hair further than asked, so the copy's edges never land exactly on
   * the original's.
   *
   * Not a precaution. This union is a shape against an exact copy of itself,
   * which is the one arrangement where edges landing on each other is certain
   * rather than unlucky -- throw an H two and a half stems to the right and
   * the swept left stem arrives exactly on the right one. Where that happened
   * the union left a hairline of daylight through the letter, and it left it
   * inside a single contour, so nothing that counts pieces could see it.
   *
   * A hundredth of a unit, the same as the fuse uses for the same reason. Over
   * the eight rounds of a halving that is under a tenth of a unit of drift in
   * the finished letter, which is below what a font file can hold.
   */
  const HAIR = 0.01;
  return tidied(unite([...shape, ...moved(shape, dx + HAIR, dy + HAIR * 0.618)], "winding", "whole"));
}

/**
 * The same outline with the points that say nothing taken out.
 *
 * Every union in the halving leaves a scatter of them. Where two copies of a
 * shape meet along an edge the answer comes back with that edge chopped into
 * pieces at every place the two boundaries touched, and the pieces are
 * collinear, and the next union chops them again. Left alone it compounds: a
 * Sans letter is a dozen points, and after a shadow of a stem and a bit it was
 * seven hundred and forty. Every boolean after that pays for all of them, which
 * is why a shadow with a rim round it cost half a second a letter.
 *
 * Only points that change nothing are dropped -- a point on the straight line
 * between its neighbours, with no handles at either side to say the outline is
 * curving through it. The tolerance is a twentieth of a unit, which is below
 * what a font file can hold, so the outline that comes out draws identically to
 * the one that went in.
 */
function tidied(contours: Contour[]): Contour[] {
  const NEAR = 0.05;
  return contours.map((contour) => {
    const nodes = contour.nodes;
    if (nodes.length < 4) return contour;

    const kept: GlyphNode[] = [];
    for (let index = 0; index < nodes.length; index++) {
      const here = nodes[index];
      // A point the outline curves through is never redundant, whatever it
      // lines up with.
      if (here.handleIn !== null || here.handleOut !== null) {
        kept.push(here);
        continue;
      }
      const previous = kept.length > 0 ? kept[kept.length - 1] : nodes[nodes.length - 1];
      const next = nodes[(index + 1) % nodes.length];
      if (previous.handleOut !== null || next.handleIn !== null) {
        kept.push(here);
        continue;
      }
      if (offLine(previous.point, here.point, next.point) > NEAR) kept.push(here);
    }
    return kept.length >= 3 ? { ...contour, nodes: kept } : contour;
  });
}

/** How far a point sits off the straight line between two others. */
function offLine(from: Vec2, point: Vec2, to: Vec2): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const run = Math.hypot(dx, dy);
  if (run < 1e-9) return Math.hypot(point.x - from.x, point.y - from.y);
  return Math.abs((point.x - from.x) * dy - (point.y - from.y) * dx) / run;
}

/**
 * The letter grown outwards all round.
 *
 * Grown by a sixteen-sided figure rather than by a circle, which is the same
 * thing to look at -- at sixteen sides the flats are a fiftieth of the rim's
 * own width -- and a very different thing to compute. A figure with a centre
 * of symmetry is the sum of segments through that centre, and a regular
 * sixteen-gon is the sum of eight of them. So growing by it is growing by one
 * segment eight times over, and every one of those is the union of a shape
 * with a copy of itself: the same cheap operation the shadow is built from.
 *
 * Done instead as sixteen copies laid round a circle and fused in one go, it
 * took a seventh of a second a letter on its own, and three seconds a letter
 * on top of a shadow -- a union of seventeen copies of an already complicated
 * shape is not seventeen times the work of a union of two, it is very much
 * worse. Eight unions of two shapes each is the same answer in a fraction of
 * the time.
 *
 * This grows the counters closed as well as the outside out, which is what
 * growing a shape does and is worth knowing before turning it up: on a light
 * face a rim of half a stem will fill the eye of an e.
 */
function outlined(shape: Contour[], width: number): Contour[] {
  if (width <= 0) return shape;

  const SIDES = 8;
  /*
   * How long each segment has to be for the eight of them to sum to a figure
   * reaching `width` all round. The sum of their supports in any direction is
   * `half` times the sum of |cos| over the eight angles, which comes to very
   * nearly eight times two-over-pi whichever direction is asked -- that near
   * constancy is the same fact as the figure being nearly a circle.
   */
  const half = width / ((2 / Math.PI) * SIDES);

  let grown = shape;
  let back = { x: 0, y: 0 };
  for (let side = 0; side < SIDES; side++) {
    const angle = (side / SIDES) * Math.PI;
    const dx = Math.cos(angle) * half * 2;
    const dy = Math.sin(angle) * half * 2;
    grown = grownBy(grown, dx, dy);
    // Every segment runs one way only, so the shape creeps as it grows. The
    // creep is exactly half of what it grew by, and is taken back at the end.
    back = { x: back.x - dx / 2, y: back.y - dy / 2 };
  }
  return moved(grown, back.x, back.y);
}

/**
 * A point built out of every corner.
 *
 * The chamfer's opposite and found the same way -- a corner is a place where
 * the outline turns sharply with the ink on the inside of the turn -- so the
 * two agree about what a corner is, which matters when both are switched on
 * and one is undoing the other.
 *
 * The spike sits on the two edges that meet and reaches out past the point of
 * the corner. Its base is drawn back along both edges rather than pinned to
 * the corner itself, so what is added is a wedge with a width to it instead of
 * a hair standing on a single point.
 */
function spurTool(shape: Contour[], spur: Cast["spur"], stem: number): Contour[] {
  const size = spur.size * stem;
  if (size <= 0) return [];

  /** Below this the outline is carrying on rather than turning. */
  const SHARP = (25 * Math.PI) / 180;

  const added: Contour[] = [];
  for (const contour of shape) {
    const nodes = contour.nodes;
    if (nodes.length < 3) continue;
    const ink = contourArea(contour) >= 0 ? 1 : -1;

    for (let index = 0; index < nodes.length; index++) {
      const previous = nodes[(index - 1 + nodes.length) % nodes.length];
      const here = nodes[index];
      const next = nodes[(index + 1) % nodes.length];

      // Handles say which way the outline is really going: a node between two
      // curves is not a corner however far apart its neighbours sit.
      const arriving = away(here.handleIn ?? previous.point, here.point);
      const leaving = away(here.point, here.handleOut ?? next.point);
      if (!arriving || !leaving) continue;

      const turn = angleBetween(arriving, leaving);
      if (Math.abs(turn) < SHARP) continue;
      // Ink on the inside of the turn, whichever way this contour runs.
      if (turn * ink <= 0) continue;

      // Never more of the edge than there is edge to take, or the base of one
      // spike reaches the next corner and the two run together.
      const room = Math.min(
        distance(here.point, previous.point),
        distance(here.point, next.point),
      );
      const base = Math.min(size * 0.7, room * 0.45);
      if (base <= 0) continue;

      // Out of the corner is against the turn, along `arriving - leaving`.
      // The other sign points into the letter and buries the spike.
      const out = away({ x: leaving.x, y: leaving.y }, { x: arriving.x, y: arriving.y });
      if (!out) continue;
      added.push(
        poly([
          { x: here.point.x - arriving.x * base, y: here.point.y - arriving.y * base },
          { x: here.point.x + out.x * size, y: here.point.y + out.y * size },
          { x: here.point.x + leaving.x * base, y: here.point.y + leaving.y * base },
        ]),
      );
    }
  }
  return added;
}

/**
 * Ink piled into the corner wherever two strokes run into each other.
 *
 * A join is two spines passing within about a stem of each other, which is the
 * same test the break uses to find the same places -- so a face with both on
 * fills exactly the corners the other would have cut.
 *
 * What goes there is a disc rather than a fitted fillet. A real fillet is two
 * tangents and an arc and has to know which way both strokes are running; a
 * disc at the meeting point covers the same corner, is buried in ink on all
 * the sides that are already ink, and shows only where there was a notch. The
 * difference between the two is smaller than the difference between weights.
 */
function weldTool(strokes: Stroke[], weld: Cast["weld"], stem: number): Contour[] {
  const size = weld.size * stem;
  if (size <= 0 || strokes.length < 2) return [];

  const near = stem * 1.15;
  const samples = strokes.map((stroke) => alongSpine(stroke.spine, SAMPLES));

  const added: Contour[] = [];
  for (let one = 0; one < samples.length; one++) {
    for (let other = one + 1; other < samples.length; other++) {
      let closest = Infinity;
      let where: Vec2 | null = null;
      for (const a of samples[one]) {
        for (const b of samples[other]) {
          const between = Math.hypot(a.x - b.x, a.y - b.y);
          if (between < closest) {
            closest = between;
            where = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          }
        }
      }
      if (closest >= near || where === null) continue;
      added.push(disc(where, size));
    }
  }
  return added;
}

// ---------------------------------------------------------------------------
// Shapes and small arithmetic
// ---------------------------------------------------------------------------

/** The same contours, every point of them moved. */
function moved(contours: Contour[], dx: number, dy: number): Contour[] {
  const shift = (point: Vec2 | null): Vec2 | null =>
    point === null ? null : { x: point.x + dx, y: point.y + dy };
  return contours.map((contour) => ({
    ...contour,
    nodes: contour.nodes.map((node) => ({
      ...node,
      point: { x: node.point.x + dx, y: node.point.y + dy },
      handleIn: shift(node.handleIn),
      handleOut: shift(node.handleOut),
    })),
  }));
}

/** A closed polygon of corners. */
function poly(points: Vec2[]): Contour {
  const nodes: GlyphNode[] = points.map((point) => ({
    point,
    handleIn: null,
    handleOut: null,
    type: "corner",
  }));
  return { nodes, closed: true };
}

/**
 * A circle, as four points with the handles that make a circle out of them.
 *
 * Drawn rather than approximated by a polygon because this one is added to
 * every join in the letter, and a polygon of enough sides to look round is
 * more points at every one of them than the whole rest of the letter has.
 */
function disc(centre: Vec2, radius: number): Contour {
  const pull = radius * 0.5522847498;
  const around: Array<[Vec2, Vec2, Vec2]> = [
    [{ x: centre.x + radius, y: centre.y }, { x: 0, y: -pull }, { x: 0, y: pull }],
    [{ x: centre.x, y: centre.y + radius }, { x: pull, y: 0 }, { x: -pull, y: 0 }],
    [{ x: centre.x - radius, y: centre.y }, { x: 0, y: pull }, { x: 0, y: -pull }],
    [{ x: centre.x, y: centre.y - radius }, { x: -pull, y: 0 }, { x: pull, y: 0 }],
  ];
  return {
    closed: true,
    nodes: around.map(([point, into, outOf]) => ({
      point,
      handleIn: { x: point.x + into.x, y: point.y + into.y },
      handleOut: { x: point.x + outOf.x, y: point.y + outOf.y },
      type: "tangent" as const,
    })),
  };
}

const distance = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);

/** The direction from one point to another, or null where there is none. */
function away(from: Vec2, to: Vec2): Vec2 | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  return length < 1e-9 ? null : { x: dx / length, y: dy / length };
}

/** How far the outline turns between arriving and leaving, signed. */
function angleBetween(arriving: Vec2, leaving: Vec2): number {
  return Math.atan2(
    arriving.x * leaving.y - arriving.y * leaving.x,
    arriving.x * leaving.x + arriving.y * leaving.y,
  );
}
