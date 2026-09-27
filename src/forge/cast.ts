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
 * The two that move the whole letter -- the shadow and the rim -- are the
 * ground the letter covers as a line or a small round figure is dragged over
 * every point of it. Both are built the same exact way, as the one loop each
 * outline makes while that happens, resolved once (`swept`).
 */

import { filled, loaded, subtract, unite, type Roles } from "@/font/boolean";
import {
  contourArea,
  contourContainsPoint,
  contoursBounds,
  reverseContour,
  splitCubic,
} from "@/font/geometry";
import type { Contour, GlyphNode, Vec2 } from "@/font/types";
import type { CutScale } from "./cut";
import { alongSpine } from "./shapes";
import { penReach, reachAlong } from "./sweep";
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
  const smallest = Math.min(
    Infinity,
    ...shape.map((contour) => -contourArea(contour)).filter((area) => area > 0),
  );

  const local: Contour[] = [];
  if (cast.spur.on) local.push(...spurTool(shape, cast.spur, stem));
  if (cast.weld.on) local.push(...weldTool(strokes, cast.weld, stem, shape));
  if (local.length > 0) shape = unite([...shape, ...local], "winding", "whole");

  if (cast.extrude.on) shape = extruded(shape, cast.extrude, stem);
  if (cast.outline.on) shape = outlined(shape, cast.outline.width * stem);

  return withoutSpecks(shape, stem, smallest);
}

/**
 * The letter with the pinholes the cast closed off filled back in.
 *
 * Growing a letter shuts every notch narrower than twice what it grew by, and
 * a notch deeper than it is wide is shut at its mouth and left as a pocket of
 * paper inside the ink: the rim round a Brush face left a white speck in the
 * foot of every stem, where the brush had left a nick. A shadow does the same
 * where it runs across a narrow gap. None of them is a counter anybody drew,
 * and at text size each is a fault in the print.
 *
 * So a hole smaller than a tenth of a stem square goes -- and never one as
 * large as half the smallest counter the letter went in with, so a small eye
 * the letter really has is never taken for one.
 */
function withoutSpecks(shape: Contour[], stem: number, smallest: number): Contour[] {
  const floor = Math.min(stem * stem * 0.1, smallest * 0.5);
  return shape.filter((contour) => {
    const area = contourArea(contour);
    return area >= 0 || -area >= floor;
  });
}

// ---------------------------------------------------------------------------
// The operations
// ---------------------------------------------------------------------------

/**
 * The letter thrown along a line, with everything it passes through filled.
 *
 * Sweeping a shape along a line is a Minkowski sum with a segment, and it is
 * done exactly, by `sweptAlong`, rather than approximated.
 *
 * Three other ways were tried and are worth knowing about.
 *
 * Stamping copies along the line leaves a staircase on every edge not parallel
 * to the throw, as deep as the gap between copies: a shadow two and a half
 * stems long came back with a serrated A. Closing it needs a copy every unit,
 * which is hundreds of them.
 *
 * Halving -- sweep by half the line, then sweep the answer by half again, down
 * to a step short enough that a shape and its copy touch everywhere -- is
 * about eight unions of a shape with a copy of itself, and every one of them
 * leaves a notch at every corner for the next one to double.
 *
 * Laying a band along each piece of the outline and fusing all of them with
 * the letter is exact on paper and wrong in practice, and was what this did
 * until recently: `sweptAlong` has what it got wrong.
 */
function extruded(shape: Contour[], extrude: Cast["extrude"], stem: number): Contour[] {
  const reach = extrude.distance * stem;
  if (reach <= 0) return shape;

  const radians = (extrude.angle * Math.PI) / 180;
  return sweptAlong(shape, Math.cos(radians) * reach, Math.sin(radians) * reach);
}

/**
 * The ground a shape covers as it travels along one line, exactly.
 *
 * What a Minkowski sum with a segment is, with nothing sampled and nothing
 * approximated -- and built so that no boolean in it is ever asked to decide
 * which side of a counter is inside while thirty other shapes lie across it.
 *
 * Each solid is swept on its own, as its convolution: the one loop that runs
 * round the ground its outline covers as it travels (`convolved` has the
 * construction). The ground is everything that loop winds round, which is a
 * single outline resolved against itself -- no counters in it, nothing to
 * mistake for one.
 *
 * Each counter is then worked out on its own and taken back out. A point in a
 * counter stays paper after the throw exactly when the whole run behind it,
 * back along the throw, stays inside the counter too. The same convolution
 * taken round the counter, which runs the other way, is the loop round the
 * paper that survives -- plus, where the counter is concave, small loops of
 * its own that lie outside the counter altogether, which is why what it winds
 * round is cut back to the counter before it is used.
 *
 * It used to be the shape, the shape moved and a band along every edge, all
 * fused together with the counters stated as holes, folded in pairs to keep
 * paper out of trouble -- and it was right or wrong depending on where each
 * outline happened to start. Every band shares an edge with the next and with
 * the letter, and paper resolves shared edges by judgement. The same `b` came
 * back open from Geist and solid from Lora, whose outlines are wound the other
 * way round and so arrive starting from a different point; the Lora `o`, `a`,
 * `8` and `B` filled one way and a Geist `B` came back holding twice the ink
 * it could possibly cover. Nothing about the geometry differed, only the
 * bookkeeping. Checked against the definition -- a point is shadow when some
 * point behind it along the throw is ink -- on twenty letters of both fonts at
 * five angles, this disagrees on under one sample in a hundred, all of them on
 * an edge.
 *
 * A solid standing inside a counter -- an island, which a font can draw and
 * the letters here do not -- would be taken out along with the counter it
 * sits in, so its own sweep is laid back on afterwards.
 */
function sweptAlong(shape: Contour[], dx: number, dy: number): Contour[] {
  if (Math.hypot(dx, dy) < 1e-9) return shape;
  return swept(shape, (contour) => convolved(contour, dx, dy));
}

/**
 * The ground a shape covers as a figure is dragged over every point of it,
 * given the one loop each outline makes as that happens.
 *
 * The part of the shadow's sweep that is not about the shadow, so the rim can
 * be made the same way: each solid's loop resolved on its own, each counter's
 * paper worked out on its own and taken back out, islands laid back on.
 */
function swept(shape: Contour[], convolve: (contour: Contour) => Contour): Contour[] {
  const solids = shape.filter((contour) => contour.nodes.length >= 2 && contourArea(contour) >= 0);
  const counters = shape.filter((contour) => contour.nodes.length >= 2 && contourArea(contour) < 0);
  if (solids.length === 0) return shape;

  const islands = solids.filter((solid) =>
    counters.some((counter) => contourContainsPoint(counter, solid.nodes[0].point)),
  );
  const sweep = (some: Contour[]): Contour[] => {
    const each = some.map((solid) => groundOf(convolve(solid), solid));
    return each.length === 1 ? each[0] : unite(each.flat(), "winding", "whole");
  };
  const ground = sweep(solids);

  /*
   * A counter's paper survives where the counter's loop winds round it once
   * the wrong way -- exactly once, which a fill rule cannot be asked for. So
   * the loop is laid inside a frame wound the right way round, where the
   * paper that survives is exactly the ground wound round no times at all,
   * and it is the frame less everything filled.
   *
   * It used to be the loop reversed and filled on its own, which fills
   * everything the loop winds round either way: the small loops a counter's
   * corners tie off, wound backwards, came back as paper too. Under the
   * shadow they landed outside the counter and were cut away; under the rim
   * they land in its corners, and every square counter came back with a speck
   * of paper standing in each corner, and a Black A whose counter should have
   * closed kept a star of them.
   */
  const kept = counters.flatMap((counter) => {
    const loop = convolve(counter);
    const box = contoursBounds([loop, counter]);
    const frame = poly([
      { x: box.xMin - 10, y: box.yMin - 10 },
      { x: box.xMax + 10, y: box.yMin - 10 },
      { x: box.xMax + 10, y: box.yMax + 10 },
      { x: box.xMin - 10, y: box.yMax + 10 },
    ]);
    return subtract([reverseContour(counter)], filled([frame, loop]), "winding");
  });
  let swept = kept.length > 0 ? subtract(ground, kept, "winding") : ground;
  if (islands.length > 0) swept = unite([...swept, ...sweep(islands)], "winding", "whole");
  return tidied(swept);
}

/**
 * What a solid's loop winds round, checked against the one thing it has to
 * be: something at least as large as the solid it was made from, since the
 * ground a shape covers as anything is dragged over it includes the shape.
 *
 * Paper resolves a loop that crosses itself by finding where it crosses, and
 * two crossings a hair apart along a nearly tangent pair of curves are ones it
 * can lose track of. A light Handwriting e grown by a rim came back as five
 * specks, then as nothing at all. The same loop with its coordinates set to a
 * hundredth of a unit -- far below anything a font file records -- resolves
 * cleanly. So a thousandth is the second try, a hundredth the third, a tenth
 * the fourth, and the solid as it was is the last answer rather than nothing.
 */
function groundOf(loop: Contour, solid: Contour): Contour[] {
  const least = contourArea(solid) * 0.999;
  for (const grid of [0, 1000, 100, 10]) {
    const ground = filled([grid === 0 ? loop : onGrid(loop, grid)]);
    const area = ground.reduce((total, one) => total + contourArea(one), 0);
    if (area >= least) return ground;
  }
  return [solid];
}

/** An outline with every point and handle set to the nearest step of `1 / per`. */
function onGrid(contour: Contour, per: number): Contour {
  const snap = (point: Vec2 | null): Vec2 | null =>
    point && { x: Math.round(point.x * per) / per, y: Math.round(point.y * per) / per };
  return {
    ...contour,
    nodes: contour.nodes.map((node) => ({
      ...node,
      point: snap(node.point) as Vec2,
      handleIn: snap(node.handleIn),
      handleOut: snap(node.handleOut),
    })),
  };
}

/**
 * One outline's path as it is dragged along the throw: its convolution.
 *
 * Every piece of the outline either faces the way the shadow is thrown or
 * faces away from it. A piece facing the throw leads the shape as it moves, so
 * where it ends up is the far edge of the swept ground; a piece facing away
 * trails, so where it started is the near edge. Walk the outline, take each
 * piece from wherever it belongs, and where the outline turns from facing one
 * way to the other join the two with a straight run along the throw -- which
 * is where the side of the shadow is. That one loop is the boundary of the
 * swept ground, crossing itself wherever the letter's own concave parts make
 * the ground fold, and the ground is everything it winds round.
 *
 * Which way a piece faces is judged against the side the ink is on, so the
 * same rule taken round a counter -- which runs the other way -- gives the
 * loop round the ground the counter's paper is swept over, in reverse.
 *
 * A piece running along the throw faces neither way, sweeps nothing, and
 * takes the side of the piece before it: it is then a straight run in line
 * with the join beside it, and the two read as one.
 */
function convolved(contour: Contour, dx: number, dy: number): Contour {
  const pieces: Array<{ edge: Edge; leads: boolean | null }> = [];
  const nodes = contour.nodes;
  for (let index = 0; index < nodes.length; index++) {
    for (const edge of facingOneWay(nodes[index], nodes[(index + 1) % nodes.length], dx, dy)) {
      // Outward is to the right of the way a solid is walked. Judged on the
      // chord, which on a piece that faces one way throughout has the sign
      // the tangent has everywhere along it.
      const across = (edge.to.y - edge.from.y) * dx - (edge.to.x - edge.from.x) * dy;
      const size =
        Math.hypot(edge.to.x - edge.from.x, edge.to.y - edge.from.y) * Math.hypot(dx, dy);
      pieces.push({ edge, leads: Math.abs(across) <= size * 1e-9 ? null : across > 0 });
    }
  }
  const first = pieces.findIndex((piece) => piece.leads !== null);
  if (first < 0) return contour;
  let last = pieces[first].leads as boolean;
  for (let step = 0; step < pieces.length; step++) {
    const piece = pieces[(first + step) % pieces.length];
    if (piece.leads === null) piece.leads = last;
    else last = piece.leads;
  }

  const out: GlyphNode[] = [];
  const at = (point: Vec2, leads: boolean): Vec2 =>
    leads ? { x: point.x + dx, y: point.y + dy } : { x: point.x, y: point.y };
  for (const { edge, leads } of pieces) {
    const from = at(edge.from, leads === true);
    const previous = out[out.length - 1];
    const handleOut = edge.c1 && at(edge.c1, leads === true);
    if (previous && same(previous.point, from)) previous.handleOut = handleOut;
    else out.push({ point: from, handleIn: null, handleOut, type: "corner" });
    out.push({
      point: at(edge.to, leads === true),
      handleIn: edge.c2 && at(edge.c2, leads === true),
      handleOut: null,
      type: "corner",
    });
  }
  const tail = out[out.length - 1];
  if (out.length > 1 && same(tail.point, out[0].point)) {
    out[0].handleIn = tail.handleIn;
    out.pop();
  }
  return { closed: true, nodes: out };
}

const same = (a: Vec2, b: Vec2): boolean =>
  Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;

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
 * The convolution takes each piece of the outline either where it started or
 * where the throw leaves it, depending on which way it faces -- and a piece
 * that turns through the throw faces both ways. Left whole, half of it would
 * be drawn in the wrong place; when the sweep was made of bands, the same
 * piece folded its band over itself and the counter of an o came back as a
 * swirl and the bowl of a B as a comma.
 *
 * A curve turns through the throw where its tangent runs parallel to it, which
 * for a cubic is the root of a quadratic and so is exactly two places at most.
 * Cut there, every piece faces one way. A straight edge faces one way all
 * along by definition.
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
 * Grown by a regular figure of `SIDES` sides rather than by a circle, which is
 * the same thing to look at -- at that many sides the flats are a hundredth of
 * the rim's own width -- and is a shape with corners the construction below
 * can name one at a time.
 *
 * Done exactly, the way the shadow is: each outline walked once, every piece
 * of it carried out to the corner of the figure that faces the way the piece
 * faces, and a run round the figure's own corners put in wherever the outline
 * turns (`convolvedRound` has it). One loop an outline, resolved once, and the
 * counters worked out on their own exactly as the shadow's are.
 *
 * It used to be eight unions of the shape with a copy of itself, each copy
 * moved a short way along one of eight directions, which sums to a sixteen-
 * sided figure. Every one of those unions left a notch at every convex corner
 * for the next one to double, and that was the whole of the trouble with it.
 * A Flared `k` went into the first round at 42 points and came out of the
 * eighth at 348. On a letter that already had corners to spare it ran away: a
 * Brush letter with points on went into the rim at a few hundred points and
 * took four to twenty seconds a letter to come out, fringed with the notches
 * as fine hair, and one `m` came out as nothing at all. A Sans with breaks,
 * the rim and points took eight seconds over a Black `R`.
 *
 * This grows the counters closed as well as the outside out, which is what
 * growing a shape does and is worth knowing before turning it up: on a light
 * face a rim of half a stem will fill the eye of an e.
 */
function outlined(shape: Contour[], width: number): Contour[] {
  if (width <= 0) return shape;
  const corners = Array.from({ length: SIDES }, (_, index) => {
    const angle = ((index + 0.5) / SIDES) * Math.PI * 2;
    return { x: Math.cos(angle) * width, y: Math.sin(angle) * width };
  });
  return swept(shape, (contour) => convolvedRound(contour, corners));
}

/** How many sides the figure a rim is grown by has. */
const SIDES = 24;

/**
 * One outline's path as a convex figure is dragged all the way round it: its
 * convolution with the figure.
 *
 * The shadow's construction with a polygon in place of a line. Each piece of
 * the outline faces one way, out to its right, and the figure's corner that
 * reaches furthest that way is the one the piece is carried out to. Where the
 * outline turns, the corner that reaches furthest changes, and the loop runs
 * round the figure's own corners from the one to the other -- the way the
 * outline turned, which at a convex corner of the ink is the rounded corner of
 * the rim, and at a concave one is a small loop back on itself that the fill
 * rule then ignores.
 *
 * A curve that turns through one of the figure's edge directions faces two
 * corners, one either side of that place, so it is cut there first; after
 * that every piece has one corner of its own.
 */
function convolvedRound(contour: Contour, corners: Vec2[]): Contour {
  const count = corners.length;
  // The figure's edge directions. Opposite edges are parallel, so half of them.
  const turns: Vec2[] = [];
  for (let index = 0; index < count / 2; index++) {
    const a = corners[index];
    const b = corners[(index + 1) % count];
    turns.push({ x: b.x - a.x, y: b.y - a.y });
  }
  const facing = (direction: Vec2): number => {
    // Out to the right of the way the outline runs.
    const out = { x: direction.y, y: -direction.x };
    let best = 0;
    let most = -Infinity;
    corners.forEach((corner, index) => {
      const reach = corner.x * out.x + corner.y * out.y;
      if (reach > most) {
        most = reach;
        best = index;
      }
    });
    return best;
  };

  const pieces: Array<{ edge: Edge; corner: number; enter: Vec2; leave: Vec2 }> = [];
  const nodes = contour.nodes;
  for (let index = 0; index < nodes.length; index++) {
    const from = nodes[index];
    const to = nodes[(index + 1) % nodes.length];
    for (const edge of cutAtAll(from, to, turns)) {
      const enter = headingOf(edge, "start");
      const leave = headingOf(edge, "end");
      if (!enter || !leave) continue;
      const middle = headingOf(edge, "middle") ?? enter;
      pieces.push({ edge, corner: facing(middle), enter, leave });
    }
  }
  if (pieces.length === 0) return contour;

  const out: GlyphNode[] = [];
  const shift = (point: Vec2, corner: number): Vec2 => ({
    x: point.x + corners[corner].x,
    y: point.y + corners[corner].y,
  });
  const push = (point: Vec2) => {
    const last = out[out.length - 1];
    if (last && same(last.point, point)) return;
    out.push({ point, handleIn: null, handleOut: null, type: "corner" });
  };
  for (let index = 0; index < pieces.length; index++) {
    const before = pieces[(index - 1 + pieces.length) % pieces.length];
    const piece = pieces[index];
    const at = piece.edge.from;
    // Round the figure from the corner the last piece used to this one's, the
    // way the outline turns here.
    if (before.corner !== piece.corner) {
      let cross = before.leave.x * piece.enter.y - before.leave.y * piece.enter.x;
      const dot = before.leave.x * piece.enter.x + before.leave.y * piece.enter.y;
      /*
       * Where the outline all but doubles back -- the sharp tip of a brushed
       * foot -- the two headings are nearly opposite, and which side of
       * straight back they fall on is a question about a handle a unit long.
       * Read the wrong way, the loop went round the inside of the tip and a
       * Black Brush H came back with a round bite out of every foot. The
       * chords of the two pieces say which way the outline really turned.
       */
      if (dot < -0.85) {
        const a = {
          x: before.edge.to.x - before.edge.from.x,
          y: before.edge.to.y - before.edge.from.y,
        };
        const b = {
          x: piece.edge.to.x - piece.edge.from.x,
          y: piece.edge.to.y - piece.edge.from.y,
        };
        const chords = a.x * b.y - a.y * b.x;
        cross = Math.abs(chords) > 1e-9 ? chords : 1;
      }
      const forward = (piece.corner - before.corner + count) % count;
      const way = Math.abs(cross) > 1e-9 ? (cross > 0 ? 1 : -1) : forward <= count / 2 ? 1 : -1;
      let corner = before.corner;
      for (let step = 0; step < count && corner !== piece.corner; step++) {
        corner = (corner + way + count) % count;
        push(shift(at, corner));
      }
    }
    const { edge, corner } = piece;
    const start = shift(edge.from, corner);
    push(start);
    const last = out[out.length - 1];
    last.handleOut = edge.c1 && shift(edge.c1, corner);
    out.push({
      point: shift(edge.to, corner),
      handleIn: edge.c2 && shift(edge.c2, corner),
      handleOut: null,
      type: "corner",
    });
  }
  /*
   * Without the pieces too short to be anything.
   *
   * A curve cut at every one of the figure's directions can leave a piece a
   * hundredth of a unit long between two cuts that fall almost together, and
   * a loop carrying a few of those is one paper cannot resolve: a light
   * Handwriting e grown by a rim came back as five specks and then as
   * nothing. The piece's two ends are one point for any purpose a font has.
   */
  const kept: GlyphNode[] = [];
  for (const node of out) {
    const last = kept[kept.length - 1];
    if (last && distance(last.point, node.point) < 0.05) {
      last.handleOut = node.handleOut;
      continue;
    }
    kept.push(node);
  }
  while (kept.length > 2 && distance(kept[kept.length - 1].point, kept[0].point) < 0.05) {
    kept[0].handleIn = kept[kept.length - 1].handleIn;
    kept.pop();
  }
  return { closed: true, nodes: kept };
}

/** One edge of an outline, cut wherever it turns through any of these directions. */
function cutAtAll(from: GlyphNode, to: GlyphNode, directions: Vec2[]): Edge[] {
  const start = from.point;
  const finish = to.point;
  if (from.handleOut === null && to.handleIn === null) {
    return same(start, finish) ? [] : [{ from: start, c1: null, c2: null, to: finish }];
  }
  const one = from.handleOut ?? start;
  const other = to.handleIn ?? finish;
  const at: number[] = [];
  for (const { x: dx, y: dy } of directions) {
    const cross = (a: Vec2, b: Vec2): number => (b.x - a.x) * dy - (b.y - a.y) * dx;
    const a = cross(start, one);
    const b = cross(one, other);
    const c = cross(other, finish);
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
  }
  const cuts = [...new Set(at.filter((value) => value > 1e-6 && value < 1 - 1e-6))].sort(
    (x, y) => x - y,
  );
  const pieces: Edge[] = [];
  let piece: [Vec2, Vec2, Vec2, Vec2] = [start, one, other, finish];
  let eaten = 0;
  for (const cut of cuts) {
    const where = (cut - eaten) / (1 - eaten);
    if (where <= 1e-9 || where >= 1 - 1e-9) continue;
    const [before, after] = splitCubic(piece[0], piece[1], piece[2], piece[3], where);
    pieces.push({ from: before[0], c1: before[1], c2: before[2], to: before[3] });
    piece = after;
    eaten = cut;
  }
  pieces.push({ from: piece[0], c1: piece[1], c2: piece[2], to: piece[3] });
  return pieces;
}

/** Which way a piece of outline is heading at its start, its end or half way. */
function headingOf(edge: Edge, where: "start" | "end" | "middle"): Vec2 | null {
  if (edge.c1 === null && edge.c2 === null) return away(edge.from, edge.to);
  const c1 = edge.c1 ?? edge.from;
  const c2 = edge.c2 ?? edge.to;
  if (where === "start")
    return away(edge.from, c1) ?? away(edge.from, c2) ?? away(edge.from, edge.to);
  if (where === "end") return away(c2, edge.to) ?? away(c1, edge.to) ?? away(edge.from, edge.to);
  // The derivative of the cubic at a half, which is a multiple of this.
  const x = edge.to.x + c2.x - c1.x - edge.from.x;
  const y = edge.to.y + c2.y - c1.y - edge.from.y;
  return away({ x: 0, y: 0 }, { x, y }) ?? away(edge.from, edge.to);
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
  /** Above this it is going back the way it came. */
  const REVERSED = (165 * Math.PI) / 180;

  const added: Contour[] = [];
  for (const contour of shape) {
    const nodes = contour.nodes;
    if (nodes.length < 3) continue;

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
      /*
       * Nor on a corner so sharp the outline all but doubles back on itself.
       * The point laid there lies along the edge rather than out of the
       * corner, and fused with the letter it left a hair of no width
       * standing along the baseline of a Flared n -- which a chamfer after it
       * read as a corner of no size and took the whole letter away with.
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
       * the turn. Every square counter got a spike at each of its corners, aimed
       * into the stem and the bar around it, and the union of those with the letter came back folded over itself at the B's and the b's.
       */
      if (turn <= 0) continue;

      // Never more of the edge than there is edge to take, or the base of one
      // spike reaches the next corner and the two run together.
      const room = Math.min(distance(here.point, previous.point), distance(here.point, next.point));
      const base = Math.min(size * 0.7, room * 0.45);
      /*
       * And never longer than its base can hold up.
       *
       * A brushed outline turns sharply now and then over a unit or two -- a
       * kink in the side of a stem, the step of a serif -- and a full-length
       * point stood on a base that narrow is a hair: a Brush face with points
       * on came back with whiskers standing off the middle of every stem, and
       * a rim grown over them turned each into a tuft of fur. Held to a
       * little over twice its base, a point on a short edge is a short point,
       * and one too small to see is not drawn.
       */
      const reach = Math.min(size, base * 2.4);
      if (reach < size * 0.2) continue;

      // Out of the corner is against the turn, along `arriving - leaving`.
      // The other sign points into the letter and buries the spike.
      const out = away({ x: leaving.x, y: leaving.y }, { x: arriving.x, y: arriving.y });
      if (!out) continue;
      added.push(
        poly([
          { x: here.point.x - arriving.x * base, y: here.point.y - arriving.y * base },
          { x: here.point.x + out.x * reach, y: here.point.y + out.y * reach },
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
 * What goes there is a fillet: in every corner between two of the strokes
 * leaving the join, the arc of the given radius that touches both of their
 * edges, and the ground between it and the join. That is what a brush leaves
 * when it changes direction without lifting, and it only ever lies in a
 * corner -- the arc is tangent to both edges, so the fill stops exactly where
 * the strokes' own sides carry on.
 *
 * It was a disc at the meeting point, on the argument that a disc is buried in
 * ink on every side that is already ink and shows only where there was a
 * notch. That holds while the disc is smaller than the strokes are wide, and
 * nowhere else: the crossbar of an H meets its stems at their centre-lines, so
 * a disc a stem across stood half a stem out of the outside of both stems, and
 * the arms of an E wore a ball on the back of the E at every join. A fillet
 * cannot do that, because it is built between the edges it fills and never
 * reaches past either of them.
 */
function weldTool(
  strokes: Stroke[],
  weld: Cast["weld"],
  stem: number,
  shape: Contour[] = [],
): Contour[] {
  const size = weld.size * stem;
  if (size <= 0 || strokes.length < 2) return [];

  const near = stem * 1.15;
  const samples = strokes.map((stroke) => alongSpine(stroke.spine, SAMPLES));

  // Whether a point is ink: inside an odd number of the fused outlines.
  const ink =
    shape.length === 0
      ? undefined
      : (point: Vec2): boolean =>
          shape.filter((contour) => contourContainsPoint(contour, point)).length % 2 === 1;

  // Every stroke but the two meeting, as somewhere an arm can run into.
  const thirds = (one: number, other: number): Array<{ line: Vec2[]; stroke: Stroke }> =>
    strokes
      .map((stroke, index) => ({ line: samples[index], stroke, index }))
      .filter(({ index }) => index !== one && index !== other);

  const added: Contour[] = [];
  for (let one = 0; one < samples.length; one++) {
    for (let other = one + 1; other < samples.length; other++) {
      let closest = Infinity;
      let where: Vec2 | null = null;
      let at: [number, number] = [0, 0];
      for (let i = 0; i < samples[one].length; i++) {
        for (let j = 0; j < samples[other].length; j++) {
          const a = samples[one][i];
          const b = samples[other][j];
          const between = Math.hypot(a.x - b.x, a.y - b.y);
          if (between < closest) {
            closest = between;
            where = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            at = [i, j];
          }
        }
      }
      if (closest >= near || where === null) continue;
      const arms = [
        ...armsOf(strokes[one], samples[one], at[0], where, strokes[other], 0, thirds(one, other)),
        ...armsOf(
          strokes[other],
          samples[other],
          at[1],
          where,
          strokes[one],
          1,
          thirds(one, other),
        ),
      ].sort((a, b) => a.angle - b.angle);
      for (let index = 0; index < arms.length; index++) {
        const from = arms[index];
        const to = arms[(index + 1) % arms.length];
        // Only the corners between the two strokes. A stroke that bends at the
        // join has a corner of its own there, and it is not a join.
        if (from.stroke === to.stroke) continue;
        const fillet = filletBetween(where, from, to, size, ink);
        if (fillet) added.push(fillet);
      }
    }
  }
  return added;
}

/** One stroke leaving a join: which way, how wide, and how far it runs. */
interface Arm {
  stroke: number;
  /** The way the stroke leaves the join. */
  direction: Vec2;
  angle: number;
  /** How far its edge stands from its spine, on either side. */
  half: number;
  /** How much of the stroke there is beyond the join. */
  length: number;
  /** The spine beyond the join, in order, for asking where it bends away. */
  path: Vec2[];
}

/**
 * The ways a stroke leaves a join: forward along its spine, and back.
 *
 * A stroke that ends at the join leaves it one way only, and one passing
 * through leaves it both -- but only if it comes out the other side. The stem
 * of an R carries on half a pen above where the bowl leaves it, and all of
 * that half pen is inside the bowl's own stroke: there is no corner there, and
 * reading the stub as an arm put a fillet on the outside of the letter, above
 * the bowl. So a way out counts only where it runs clear of the other stroke.
 *
 * The direction is the tangent at the join rather than a chord further out.
 * A chord cuts across the inside of a curve, and where two curves leave a join
 * side by side -- the two arches of an m, both rising from the middle stem --
 * the chords spread apart while the strokes themselves rise together, and the
 * fillet between the chords stood up out of the valley between the arches as
 * a spike. Taken off the tangent the two arches leave the same way, and there
 * is no corner to fill.
 *
 * How wide the stroke stands is the pen's reach across that direction, which
 * with contrast differs from stroke to stroke: the hairline arm of a Serif
 * `k` is thinner than the stem it leaves.
 */
function armsOf(
  stroke: Stroke,
  spine: Vec2[],
  index: number,
  join: Vec2,
  meeting: Stroke,
  which: number,
  thirds: Array<{ line: Vec2[]; stroke: Stroke }> = [],
): Arm[] {
  const reach = penReach(stroke.pen);
  const clear = penReach(meeting.pen).across * 1.2 + 1;
  const arms: Arm[] = [];
  const closed = stroke.spine.closed;
  const last = spine.length - 1;
  for (const step of [1, -1]) {
    let length = 0;
    let at = index;
    let toward: Vec2 | null = null;
    const path: Vec2[] = [];
    for (let walked = 0; walked < last; walked++) {
      let next = at + step;
      if (closed) next = (next + last) % last;
      else if (next < 0 || next > last) break;
      length += distance(spine[at], spine[next]);
      at = next;
      /*
       * Stopped where it runs into another stroke.
       *
       * The crossbar of an H runs from one stem to the other, and a fillet
       * sized against the whole crossbar -- the part buried in the far stem
       * and out the other side of it -- reached past the far stem's inside
       * edge. What is there to fill against is the run between the two.
       */
      const blocked = thirds.some(({ line, stroke: third }) => {
        const near = Math.min(...line.map((point) => distance(point, spine[at])));
        return near < penReach(third.pen).across;
      });
      if (blocked) break;
      path.push(spine[at]);
      // Far enough along for a direction to be read off, and no further.
      toward ??= length >= reach.across * 0.25 ? spine[at] : null;
    }
    if (length < clear || !toward) continue;
    const direction = away(join, toward);
    if (!direction) continue;
    const normal = { x: -direction.y, y: direction.x };
    const shift = reachAlong(normal, reach);
    arms.push({
      stroke: which,
      direction,
      angle: Math.atan2(direction.y, direction.x),
      half: Math.abs(shift.x * normal.x + shift.y * normal.y),
      length,
      path,
    });
  }
  return arms;
}

/**
 * How far along an arm its edge on one side still runs where the fillet
 * thinks it does.
 *
 * The fillet is built against the straight line the arm leaves the join
 * along, and a stroke that curves is only on that line for a while. Curving
 * into the corner does no harm -- the ink comes over the fillet and buries it
 * -- but curving away leaves the fillet's side standing in the air: the leg of
 * an R leaves the join beside the bottom of the bowl, the bowl turns up and
 * away from it, and a fillet run along the bowl's first heading came back as a
 * flag standing out past the bowl. So the length that counts stops where the
 * spine has fallen away from that line by more than a unit or a twentieth of
 * the pen, whichever is more, and ends where the stroke does otherwise.
 */
function straightFor(join: Vec2, arm: Arm, side: Vec2): number {
  const slack = Math.max(1, arm.half * 0.1);
  for (const point of arm.path) {
    const off = (point.x - join.x) * side.x + (point.y - join.y) * side.y;
    if (off < -slack) {
      return (point.x - join.x) * arm.direction.x + (point.y - join.y) * arm.direction.y;
    }
  }
  return arm.length;
}

/**
 * The fillet in the corner between two arms, turning anticlockwise from one to
 * the other; or nothing, where they meet too square-on to have a corner.
 *
 * The edges that face into the corner are the left side of the first arm and
 * the right side of the second. The arc touches both, and the shape is the
 * join, out along each spine to where the arc touches, across to the edge, and
 * round the arc -- so it overlaps the ink of both strokes instead of lying
 * exactly along their edges, which is the arrangement a union handles well.
 *
 * The radius is taken down where the arms are too short for it, so a fillet
 * never runs past the end of the stroke it is filling against.
 */
function filletBetween(
  join: Vec2,
  from: Arm,
  to: Arm,
  radius: number,
  ink?: (point: Vec2) => boolean,
): Contour | null {
  let opening = to.angle - from.angle;
  if (opening <= 0) opening += Math.PI * 2;
  // Nearly straight on is a stroke carrying on through, and nearly shut is two
  // strokes lying along each other; neither has a corner to fill.
  if (opening > (170 * Math.PI) / 180 || opening < (20 * Math.PI) / 180) return null;

  const u1 = from.direction;
  const u2 = to.direction;
  const n1 = { x: -u1.y, y: u1.x };
  const n2 = { x: u2.y, y: -u2.x };
  // Where the two inner edges cross, as a distance along each arm.
  const sin = Math.sin(opening);
  const cos = Math.cos(opening);
  const cornerAlong1 = (to.half + from.half * cos) / sin;
  const cornerAlong2 = (from.half + to.half * cos) / sin;
  const reachFromCorner = 1 / Math.tan(opening / 2);
  const room = Math.min(
    straightFor(join, from, n1) - cornerAlong1,
    straightFor(join, to, n2) - cornerAlong2,
  );
  let r = Math.min(radius, room / reachFromCorner);
  /*
   * Held to where both edges really are.
   *
   * The fillet is built against the straight lines the two arms leave along,
   * and the letter's ink does not always run along them as far as that: a
   * leg cut off square at the baseline, a bowl on a Black face whose inside
   * turns away sooner than its spine does. Where the arc would touch an edge
   * that is not there, the fillet stood out of the letter -- a lump hanging
   * under the crossbar of a Black A, a flag on the top of a Black e. So the
   * ink is looked for just inside each touching point -- part way in from the
   * edge, since the heading an arm is read off leans a unit or two over its
   * length -- and the radius halved until both are found, or the corner left
   * alone.
   */
  if (ink) {
    let found = false;
    for (let tries = 0; tries < 4 && r > 0.5; tries++) {
      const reach = r * reachFromCorner;
      const lean = (u: Vec2, n: Vec2, half: number, along: number): Vec2 => ({
        x: join.x + u.x * (along + reach) + n.x * half * 0.6,
        y: join.y + u.y * (along + reach) + n.y * half * 0.6,
      });
      if (ink(lean(u1, n1, from.half, cornerAlong1)) && ink(lean(u2, n2, to.half, cornerAlong2))) {
        found = true;
        break;
      }
      r /= 2;
    }
    if (!found) return null;
  }
  if (!(r > 0.5)) return null;

  const along1 = cornerAlong1 + r * reachFromCorner;
  const along2 = cornerAlong2 + r * reachFromCorner;
  const on = (u: Vec2, n: Vec2, half: number, along: number, off: number): Vec2 => ({
    x: join.x + u.x * along + n.x * half * off,
    y: join.y + u.y * along + n.y * half * off,
  });
  const spine1 = on(u1, n1, from.half, along1, 0);
  const touch1 = on(u1, n1, from.half, along1, 1);
  const touch2 = on(u2, n2, to.half, along2, 1);
  const spine2 = on(u2, n2, to.half, along2, 0);
  // The arc turns through what the corner does not, and a quarter of that
  // sets how far its handles reach.
  const pull = (4 / 3) * Math.tan((Math.PI - opening) / 4) * r;
  const corner = (point: Vec2): GlyphNode => ({
    point,
    handleIn: null,
    handleOut: null,
    type: "corner",
  });
  const shape: Contour = {
    closed: true,
    nodes: [
      corner({ ...join }),
      corner(spine1),
      {
        point: touch1,
        handleIn: null,
        handleOut: { x: touch1.x - u1.x * pull, y: touch1.y - u1.y * pull },
        type: "corner",
      },
      {
        point: touch2,
        handleIn: { x: touch2.x - u2.x * pull, y: touch2.y - u2.y * pull },
        handleOut: null,
        type: "corner",
      },
      corner(spine2),
    ],
  };
  return contourArea(shape) < 0 ? reverseContour(shape) : shape;
}

// ---------------------------------------------------------------------------
// Shapes and small arithmetic
// ---------------------------------------------------------------------------

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
