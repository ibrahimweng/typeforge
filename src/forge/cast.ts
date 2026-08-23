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
import { contourArea, reverseContour, splitCubic } from "@/font/geometry";
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
  sameCast,
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
  sameCast,
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
  return sweptAlong(shape, Math.cos(radians) * reach, Math.sin(radians) * reach);
}

/**
 * A shape and the same shape moved, fused into one, and tidied after.
 *
 * The approximate sweep, and it is the right one where the move is short
 * against the shape being moved. Two copies of a stem five units apart overlap
 * along almost their whole length, so their union is the ground between them
 * to within the width of a hair -- which is what the rim is built out of, eight
 * short moves that add up to a sixteen-sided figure.
 *
 * The exact sweep below is not used here, and was tried. Its bands are laid
 * along every edge of the shape, and the rim lays one move on top of the last
 * eight times over, so by the fourth the shape it is banding has hundreds of
 * curved edges and paper runs out of stack resolving their crossings. The
 * shadow makes one move against the letter as drawn and has no such trouble.
 *
 * Tidied because every union leaves the straight runs chopped into collinear
 * pieces, and the next one would carry all of them.
 *
 * Refitting the curves as well was tried and is not here. It takes the point
 * count down by two thirds and takes the shape apart while doing it -- a
 * letter that was eleven contours came back as two hundred and eleven, because
 * an outline moved even a tenth of a unit no longer touches the copy of itself
 * it is supposed to be fusing with. The union has to be handed exactly what it
 * was given, and only the points that change nothing can go.
 */
function grownBy(shape: Contour[], dx: number, dy: number): Contour[] {
  return tidied(unite([...shape, ...moved(shape, dx, dy)], "winding", "whole"));
}

/**
 * The ground a shape covers as it travels along one line, exactly.
 *
 * The shape, the shape moved, and a band laid along every edge between them.
 * That is the whole of the swept region -- it is what a Minkowski sum with a
 * segment is -- with nothing sampled and nothing approximated.
 *
 * Folded in two at a time rather than handed over all at once, which is the
 * one thing this cannot do. A union of a letter's strokes is a handful of
 * shapes overlapping a little, and paper resolves that in one go. This is
 * thirty bands overlapping enormously -- every one meets its neighbour along a
 * whole edge and most of them lie inside the letter -- and handed all of them
 * together paper answers with the counter of an o filled in, at every throw
 * and every angle. Folded, it is right at every one of them, and the counter
 * shrinks as the throw lengthens, which is what a shadow does.
 *
 * Paired up rather than added one after another, so the shapes stay small for
 * as long as possible: a band against a band is a cheap boolean and a band
 * against the whole accumulated shadow is not. Same number of unions, a good
 * deal less work in them.
 */
function sweptAlong(shape: Contour[], dx: number, dy: number): Contour[] {
  if (Math.hypot(dx, dy) < 1e-9) return shape;
  const bands: Contour[][] = [];
  for (const contour of shape) {
    const nodes = contour.nodes;
    if (nodes.length < 2) continue;
    for (let index = 0; index < nodes.length; index++) {
      for (const piece of facingOneWay(nodes[index], nodes[(index + 1) % nodes.length], dx, dy)) {
        const band = bandAlong(piece, dx, dy);
        if (band) bands.push([band]);
      }
    }
  }
  /*
   * The bands first and the letter last, which is not arbitrary. Paired up in
   * that order the bands meet each other -- shapes of the same size, each
   * touching the next along one edge -- and only the fused ring of them meets
   * the letter. The letter first, and the first union is a whole letter
   * against one small band, which is the arrangement paper is worst at: an o
   * thrown two stems at a hundred and fifty degrees came back solid that way
   * and open this way, and nothing else about it changed.
   */
  return tidied(pairedUp([...bands, moved(shape, dx, dy), shape]));
}

/** Everything fused, two at a time, up a tree rather than along a line. */
function pairedUp(shapes: Contour[][]): Contour[] {
  let round = shapes;
  while (round.length > 1) {
    const next: Contour[][] = [];
    for (let index = 0; index < round.length; index += 2) {
      next.push(
        index + 1 < round.length
          ? unite([...round[index], ...round[index + 1]], "winding", "whole")
          : round[index],
      );
    }
    round = next;
  }
  return round[0] ?? [];
}

/** One piece of the outline: where it starts and ends, and how it curves. */
interface Edge {
  from: Vec2;
  c1: Vec2 | null;
  c2: Vec2 | null;
  to: Vec2;
}

/**
 * One edge cut wherever it turns through the direction of the throw.
 *
 * A band is the edge, the edge moved, and the two ends joined -- and that is a
 * simple shape only while the edge faces one way relative to the throw. Where
 * it turns through it, the edge and its own moved copy cross each other, the
 * band folds over itself, and the union resolves the fold into a crescent: the
 * counter of an o came back as a swirl and the bowl of a B as a comma.
 *
 * A curve turns through the throw where its tangent runs parallel to it, which
 * for a cubic is the root of a quadratic and so is exactly two places at most.
 * Cut there, every piece faces one way and every band is simple. A straight
 * edge faces one way all along by definition.
 */
function facingOneWay(from: GlyphNode, to: GlyphNode, dx: number, dy: number): Edge[] {
  const start = from.point;
  const finish = to.point;
  const c1 = from.handleOut;
  const c2 = to.handleIn;
  if (c1 === null && c2 === null) return [{ from: start, c1: null, c2: null, to: finish }];

  // A cubic with one handle missing is the same cubic with that handle sitting
  // on its own point, which is what the rest of the engine means by it too.
  const one = c1 ?? start;
  const other = c2 ?? finish;
  const cross = (a: Vec2, b: Vec2): number => (b.x - a.x) * dy - (b.y - a.y) * dx;
  const a = cross(start, one);
  const b = cross(one, other);
  const c = cross(other, finish);

  const at: number[] = [];
  const square = a - 2 * b + c;
  const linear = -2 * a + 2 * b;
  if (Math.abs(square) < 1e-12) {
    if (Math.abs(linear) > 1e-12) at.push(-a / linear);
  } else {
    const under = linear * linear - 4 * square * a;
    if (under >= 0) {
      const root = Math.sqrt(under);
      at.push((-linear + root) / (2 * square), (-linear - root) / (2 * square));
    }
  }
  const cuts = at.filter((value) => value > 1e-6 && value < 1 - 1e-6).sort((x, y) => x - y);
  if (cuts.length === 0) return [{ from: start, c1: one, c2: other, to: finish }];

  const pieces: Edge[] = [];
  let piece: [Vec2, Vec2, Vec2, Vec2] = [start, one, other, finish];
  let eaten = 0;
  for (const cut of cuts) {
    // Measured against what is left, since each cut renumbers the rest.
    const where = (cut - eaten) / (1 - eaten);
    const [before, after] = splitCubic(piece[0], piece[1], piece[2], piece[3], where);
    pieces.push({ from: before[0], c1: before[1], c2: before[2], to: before[3] });
    piece = after;
    eaten = cut;
  }
  pieces.push({ from: piece[0], c1: piece[1], c2: piece[2], to: piece[3] });
  return pieces;
}

/**
 * The ground one edge of the outline passes over, as a shape.
 *
 * The edge, the edge moved, and the two straight runs joining their ends. A
 * curved edge gives a curved band: the far side is the same curve moved, so
 * its handles are the near side's handles moved, taken in the other order
 * because that side is walked backwards.
 *
 * Wound solid whichever way the edge happened to run, because the union is
 * told to read the roles off the winding and a band that came out running the
 * other way would be read as a hole and punched out of the shadow it is part
 * of.
 */
function bandAlong(edge: Edge, dx: number, dy: number): Contour | null {
  const at = (point: Vec2): Vec2 => ({ x: point.x + dx, y: point.y + dy });
  const band: Contour = {
    closed: true,
    nodes: [
      { point: { ...edge.from }, handleIn: null, handleOut: edge.c1, type: "corner" },
      { point: { ...edge.to }, handleIn: edge.c2, handleOut: null, type: "corner" },
      { point: at(edge.to), handleIn: null, handleOut: edge.c2 && at(edge.c2), type: "corner" },
      { point: at(edge.from), handleIn: edge.c1 && at(edge.c1), handleOut: null, type: "corner" },
    ],
  };
  /*
   * An edge running along the throw sweeps no ground, and a band of no area is
   * a shape the union has to resolve for nothing. Judged on the area rather
   * than on the direction, so a curve that happens to sweep nothing is caught
   * as well as a straight run that does.
   */
  if (Math.abs(contourArea(band)) < 1e-9) return null;
  return contourArea(band) < 0 ? reverseContour(band) : band;
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
    let nodes = contour.nodes;
    if (nodes.length < 4) return contour;

    /*
     * The points that sit on top of their neighbour go first, and they have to
     * go first.
     *
     * A union answers with plenty of them, and one of them is at the seam
     * where the outline closes -- the last point is the first point written
     * again. Left in, the very first point of the outline is measured against
     * a copy of itself, comes out as lying on the line between it and its
     * other neighbour, and is dropped: a shadow of a rectangle came back as a
     * triangle of exactly half the area, with its bounds still right, which is
     * a shape that is easy to look at and not notice.
     *
     * A hundredth of a unit apart still counts as the same point, because they
     * do not come back exactly on top of each other. A union grows every shape
     * it is handed outward by up to a ten-thousandth before joining them, so
     * what was one point arrives as two a couple of ten-thousandths apart --
     * and asked for exactness this caught none of them.
     */
    const SAME = 0.01;
    nodes = nodes.filter((node, index) => {
      const before = nodes[(index + nodes.length - 1) % nodes.length];
      if (node.handleIn !== null || before.handleOut !== null) return true;
      return Math.hypot(node.point.x - before.point.x, node.point.y - before.point.y) > SAME;
    });
    if (nodes.length < 4) return { ...contour, nodes };

    /*
     * Then the points that change nothing: a point on the straight line
     * between its neighbours, with no handles at either side to say the
     * outline is curving through it. The tolerance is a twentieth of a unit,
     * which is below what a font file can hold, so what comes out draws
     * identically to what went in.
     *
     * Swept again and again until a sweep finds nothing, because removing one
     * point makes its two neighbours neighbours: three steps of a staircase in
     * a line come out only if the middle one going lets the other two be
     * looked at together. Each sweep asks about the outline as it now is,
     * rather than about the one it started as.
     */
    for (;;) {
      const kept = nodes.filter((node, index) => {
        if (node.handleIn !== null || node.handleOut !== null) return true;
        const before = nodes[(index + nodes.length - 1) % nodes.length];
        const after = nodes[(index + 1) % nodes.length];
        if (before.handleOut !== null || after.handleIn !== null) return true;
        return offLine(before.point, node.point, after.point) > NEAR;
      });
      if (kept.length === nodes.length || kept.length < 3) break;
      nodes = kept;
    }
    return nodes.length >= 3 ? { ...contour, nodes } : contour;
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
 *
 * It is still the expensive one, and the reason is worth writing down because
 * four ways of making it cheaper have been tried and none of them worked.
 *
 * Each round leaves a notch at every convex corner -- that is exactly what the
 * approximate sweep gets wrong -- and every notch is points the next round
 * doubles. A Flared `k` goes into the first round at 42 points and comes out of
 * the eighth at 348, and the last two rounds cost more than the first six
 * together. The rim alone is about 90ms on that letter and all four operations
 * together about 185ms, which is the worst of the letters measured.
 *
 * What does not help. The exact sweep below cannot be used, because it lays a
 * band along every edge and by the fourth round the shape it is banding has
 * hundreds of curved edges: paper runs out of stack. Splitting each round into
 * four shorter moves, which should converge on the exact answer, runs out of
 * stack the same way and where it survives it disagrees with itself -- one
 * letter grew 35% more, another 12% less. Rejoining curves in the tidy recovers
 * nothing: a union cuts a curve where two boundaries cross, and a crossing is a
 * real corner, so the pieces are not two halves of one curve and the point
 * count comes back the same to the point. Taking the eight directions in a
 * spread order rather than in a fan is worse by more than a factor of ten,
 * because consecutive near-parallel moves are what keeps the shape simple.
 *
 * What would work is not a tuning: it is `S + P = S union (every edge + P)`,
 * where each edge's own region is built directly from the sixteen-gon's
 * supporting vertex as the tangent turns, and the pieces are folded the way the
 * shadow folds its bands. That is exact, and the shape it hands back is the
 * shape rather than the shape with notches in it. It is a piece of work rather
 * than an edit, and the test below holds the point count still until somebody
 * does it.
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
