/**
 * Bending what is selected: the box, its corners, and the named warps.
 *
 * `reshape.ts` holds the transforms that are straight lines through a matrix:
 * scale, rotate, slant, mirror. These are the ones that are not, and they come
 * in two kinds that behave very differently on an outline.
 *
 * A **quad** map takes the four corners of the selection's box somewhere else
 * and works out where everything inside goes. Two of them: `bilinear`, which
 * is what a corner dragged freely does, and `perspective`, which is a true
 * projective map and gives the foreshortening that makes a shape look laid
 * back in space. Both are exact on points.
 *
 * A **field** map bends the inside of the box without moving its corners at
 * all: a bulge, an arc, a flag, a twist. These are not linear, and that is the
 * whole difficulty below.
 *
 * ## What a warp does to a curve, honestly
 *
 * An outline is cubic beziers, and only a straight line through a matrix takes
 * a cubic to a cubic. Everything here is an approximation, and the two kinds
 * fail differently:
 *
 *   - A quad map moves the four control points of a segment and leaves it a
 *     cubic. That is what every vector tool does and it is close enough to be
 *     invisible at the sizes a letter is drawn, because a projective map of a
 *     cubic is a rational cubic and the difference lives in the weights.
 *
 *   - A field map is not close at all over a long segment. The field varies
 *     across the segment and the control points only know about its ends, so a
 *     bulge applied to a stem drawn with two points moves the two points and
 *     leaves the line between them straight -- which is precisely the shape
 *     somebody asked it to bend.
 *
 * So a field map subdivides first. A segment is cut until the field is near
 * enough constant across each piece, and then the pieces are moved. That adds
 * points, which is a real cost on a letter somebody is going to ship, and
 * `warpNeeds` says how many before anything is done so it can be said out loud
 * rather than discovered in the paths panel afterwards.
 */

import { splitCubic } from "./geometry";
import type { Contour, GlyphNode, Vec2 } from "./types";

/** Where something sits inside the box being transformed, nought to one. */
export interface Within {
  u: number;
  v: number;
}

/** The four corners of a box, in the order a quad map wants them. */
export interface Quad {
  /** (0,0) in the box: its left and bottom, since y runs up in font units. */
  bottomLeft: Vec2;
  bottomRight: Vec2;
  topRight: Vec2;
  topLeft: Vec2;
}

export interface Box {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

/** Where a point sits in a box, as a fraction along each side. */
export function withinBox(box: Box, point: Vec2): Within {
  const wide = box.right - box.left;
  const tall = box.top - box.bottom;
  return {
    // A box with no width is a row of points on one line, and everything in it
    // sits at the same place along that axis rather than at infinity.
    u: wide === 0 ? 0 : (point.x - box.left) / wide,
    v: tall === 0 ? 0 : (point.y - box.bottom) / tall,
  };
}

/** The point a fraction of the way across a box. */
export function pointInBox(box: Box, at: Within): Vec2 {
  return {
    x: box.left + at.u * (box.right - box.left),
    y: box.bottom + at.v * (box.top - box.bottom),
  };
}

/** The box a quad started as, for the corner maps below. */
export const unitQuad = (box: Box): Quad => ({
  bottomLeft: { x: box.left, y: box.bottom },
  bottomRight: { x: box.right, y: box.bottom },
  topRight: { x: box.right, y: box.top },
  topLeft: { x: box.left, y: box.top },
});

// ---------------------------------------------------------------------------
// Quad maps: the four corners go somewhere, and the inside follows
// ---------------------------------------------------------------------------

/**
 * The corners moved freely, with the inside mixed between them.
 *
 * What a corner dragged on its own does. Straight lines across the box stay
 * straight along each axis, so a rectangle pulled by one corner becomes the
 * quadrilateral you drew rather than a trapezoid the maths preferred.
 */
export function bilinear(quad: Quad, at: Within): Vec2 {
  const { u, v } = at;
  const bottom = {
    x: quad.bottomLeft.x + (quad.bottomRight.x - quad.bottomLeft.x) * u,
    y: quad.bottomLeft.y + (quad.bottomRight.y - quad.bottomLeft.y) * u,
  };
  const top = {
    x: quad.topLeft.x + (quad.topRight.x - quad.topLeft.x) * u,
    y: quad.topLeft.y + (quad.topRight.y - quad.topLeft.y) * u,
  };
  return { x: bottom.x + (top.x - bottom.x) * v, y: bottom.y + (top.y - bottom.y) * v };
}

/** The eight numbers of a projective map from the unit square to a quad. */
export interface Projective {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  g: number;
  h: number;
}

/**
 * The projective map taking the unit square to four corners.
 *
 * The closed form for the square-to-quad case rather than an eight-by-eight
 * solve, because there is one and it is exact. When the quad is a
 * parallelogram there is no perspective in it at all, the two denominators
 * vanish, and the map is the affine one -- which is the branch below rather
 * than a division by nothing.
 */
export function perspective(quad: Quad): Projective {
  const [p0, p1, p2, p3] = [quad.bottomLeft, quad.bottomRight, quad.topRight, quad.topLeft];
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;

  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    return {
      a: p1.x - p0.x,
      b: p2.x - p1.x,
      c: p0.x,
      d: p1.y - p0.y,
      e: p2.y - p1.y,
      f: p0.y,
      g: 0,
      h: 0,
    };
  }

  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const under = dx1 * dy2 - dx2 * dy1;
  // A quad flattened onto a line has no map to give. The caller is dragging a
  // corner through the opposite side, and holding still is the honest answer.
  if (Math.abs(under) < 1e-9) return { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0, g: 0, h: 0 };

  const g = (sx * dy2 - dx2 * sy) / under;
  const h = (dx1 * sy - sx * dy1) / under;
  return {
    a: p1.x - p0.x + g * p1.x,
    b: p3.x - p0.x + h * p3.x,
    c: p0.x,
    d: p1.y - p0.y + g * p1.y,
    e: p3.y - p0.y + h * p3.y,
    f: p0.y,
    g,
    h,
  };
}

/** A place in the unit square through a projective map. */
export function project(map: Projective, at: Within): Vec2 {
  const under = map.g * at.u + map.h * at.v + 1;
  // Behind the horizon: the point has been dragged past the vanishing line and
  // has no image in front of it. Left where it was rather than flung to the
  // far side, which is what dividing by a negative would do.
  if (Math.abs(under) < 1e-9) return { x: at.u, y: at.v };
  return {
    x: (map.a * at.u + map.b * at.v + map.c) / under,
    y: (map.d * at.u + map.e * at.v + map.f) / under,
  };
}

// ---------------------------------------------------------------------------
// Field maps: the corners stay and the inside bends
// ---------------------------------------------------------------------------

/** Every warp that bends the inside of the box, by the name it is offered as. */
export type WarpName =
  | "arc"
  | "arch"
  | "bulge"
  | "flag"
  | "wave"
  | "fisheye"
  | "rise"
  | "inflate"
  | "squeeze"
  | "twist";

/**
 * What each one does, said in a sentence, and where the sentence is shown.
 *
 * Not a comment: this is the hint on the control, because "squeeze" and
 * "inflate" are two words nobody can tell apart until they have watched both.
 */
export const WARPS: ReadonlyArray<{ id: WarpName; name: string; hint: string }> = [
  { id: "arc", name: "Arc", hint: "Bows the whole selection along a curve, both edges together." },
  { id: "arch", name: "Arch", hint: "Bows the top and leaves the bottom standing on its line." },
  {
    id: "bulge",
    name: "Bulge",
    hint: "Fattens the middle and pinches the ends, in both directions.",
  },
  { id: "flag", name: "Flag", hint: "One wave across the selection, as a flag hangs." },
  { id: "wave", name: "Wave", hint: "Two waves across the selection, one riding on the other." },
  {
    id: "fisheye",
    name: "Fisheye",
    hint: "Pushes everything out from the middle, hardest at the centre.",
  },
  { id: "rise", name: "Rise", hint: "Lifts the far side and leaves the near side where it is." },
  { id: "inflate", name: "Inflate", hint: "Pushes everything out towards the edges of the box." },
  { id: "squeeze", name: "Squeeze", hint: "Pinches the middle in and leaves the ends alone." },
  { id: "twist", name: "Twist", hint: "Turns the middle further than the edges." },
];

/**
 * The bend itself, on coordinates running minus one to one from the middle.
 *
 * Centred rather than nought-to-one because every one of these is about a
 * middle and a distance from it, and written the other way each would carry
 * the same two subtractions.
 */
/**
 * How much of a radial warp is felt at a distance from the middle.
 *
 * One at the centre, a half at the edge of the unit circle, a third at the
 * corner of the box. Smooth, and never nought -- which is the property that
 * matters, because the points somebody selected define the box and therefore
 * lie on its rim.
 */
const falloff = (radius: number): number => 1 / (1 + radius * radius);

function bend(name: WarpName, amount: number, u: number, v: number): Within {
  const radius = Math.hypot(u, v);
  switch (name) {
    case "arc":
      return { u, v: v + amount * (1 - u * u) };
    case "arch":
      // Weighted by height, so the bottom of the selection does not move.
      return { u, v: v + amount * (1 - u * u) * ((v + 1) / 2) };
    case "bulge":
      return { u: u + amount * u * (1 - v * v), v: v + amount * v * (1 - u * u) };
    case "flag":
      return { u, v: v + amount * Math.sin(((u + 1) / 2) * Math.PI * 2) };
    case "wave":
      return {
        u,
        v:
          v +
          amount *
            (Math.sin(((u + 1) / 2) * Math.PI * 2) * 0.6 +
              Math.sin(((u + 1) / 2) * Math.PI * 4) * 0.4),
      };
    case "fisheye": {
      /*
       * Strongest in the middle and still real at the rim.
       *
       * The first version fell to nothing at a radius of one so that the box
       * would keep its shape, and that made it do nothing at all. The box here
       * is drawn round what is selected, so the selection's own extremes sit
       * on its rim by definition -- a stem picked at its four corners has
       * every point at a radius of one or more, and a falloff that is zero
       * there moves none of them. A warp that quietly does nothing is worse
       * than one that is too strong.
       */
      const push = 1 + amount * falloff(radius);
      return { u: u * push, v: v * push };
    }
    case "rise":
      return { u, v: v + amount * ((u + 1) / 2) * 2 };
    case "inflate": {
      // The same idea as the fisheye with a far gentler falloff, which is what
      // makes the two different things: this pushes the rim nearly as hard as
      // the middle, so the whole selection swells rather than its centre.
      const push = 1 + amount * falloff(radius / 2);
      return { u: u * push, v: v * push };
    }
    case "squeeze":
      return { u, v: v * (1 - amount * (1 - u * u)) };
    case "twist": {
      // Turned most in the middle, and still turned at the rim, for the reason
      // under the fisheye above.
      const turn = amount * falloff(radius) * Math.PI;
      const cos = Math.cos(turn);
      const sin = Math.sin(turn);
      return { u: u * cos - v * sin, v: u * sin + v * cos };
    }
  }
}

/** One place in the box, bent. */
export function warpWithin(name: WarpName, amount: number, at: Within): Within {
  const bent = bend(name, amount, at.u * 2 - 1, at.v * 2 - 1);
  return { u: (bent.u + 1) / 2, v: (bent.v + 1) / 2 };
}

// ---------------------------------------------------------------------------
// Putting one of them through an outline
// ---------------------------------------------------------------------------

/** Where a point goes. Everything above is turned into one of these. */
export type Move = (point: Vec2) => Vec2;

/** A quad map as a move, for the corner drags. */
export function quadMove(box: Box, quad: Quad, kind: "distort" | "perspective"): Move {
  const map = kind === "perspective" ? perspective(quad) : null;
  return (point) => {
    const at = withinBox(box, point);
    return map ? project(map, at) : bilinear(quad, at);
  };
}

/** A named warp as a move. */
export function fieldMove(box: Box, name: WarpName, amount: number): Move {
  return (point) => pointInBox(box, warpWithin(name, amount, withinBox(box, point)));
}

/** A node with its point and both handles moved. */
function moveNode(node: GlyphNode, move: Move): GlyphNode {
  return {
    ...node,
    point: move(node.point),
    // Handles are absolute in this model, which is what lets a warp treat them
    // as ordinary points. Held as offsets they would need the field's gradient
    // at the node, and a bulge would leave every curve pointing the wrong way.
    handleIn: node.handleIn ? move(node.handleIn) : null,
    handleOut: node.handleOut ? move(node.handleOut) : null,
  };
}

/**
 * How far a field pulls a segment away from the curve its four points describe.
 *
 * Measured rather than assumed, because the answer depends on the warp, the
 * amount and where the segment happens to lie: a bulge does almost nothing to
 * a segment sitting against the edge of the box and a great deal to one across
 * its middle. Compared at the two places a cubic is least able to follow a
 * bend it was not told about.
 */
function strays(from: Vec2, c1: Vec2, c2: Vec2, to: Vec2, move: Move): number {
  let worst = 0;
  for (const t of [1 / 3, 2 / 3]) {
    const s = 1 - t;
    // Where the curve is now, and where its four moved points would put it.
    const on = (a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 => ({
      x: s * s * s * a.x + 3 * s * s * t * b.x + 3 * s * t * t * c.x + t * t * t * d.x,
      y: s * s * s * a.y + 3 * s * s * t * b.y + 3 * s * t * t * c.y + t * t * t * d.y,
    });
    const truly = move(on(from, c1, c2, to));
    const guessed = on(move(from), move(c1), move(c2), move(to));
    worst = Math.max(worst, Math.hypot(truly.x - guessed.x, truly.y - guessed.y));
  }
  return worst;
}

/** One segment of a contour, as the four points a cubic is made of. */
interface Piece {
  from: Vec2;
  c1: Vec2;
  c2: Vec2;
  to: Vec2;
  /** Whether the node this piece starts at was one somebody picked. */
  picked: boolean;
}

/**
 * A segment cut until a cubic can follow the field across each piece.
 *
 * Depth-limited, because a warp with a lot of amount in it has places where no
 * number of cuts would be enough and a letter is not improved by two hundred
 * points in one curve. Five levels is thirty-two pieces at the very worst and
 * one or two everywhere ordinary.
 */
function cutUntilItFollows(piece: Piece, move: Move, within: number, depth = 5): Piece[] {
  if (depth === 0 || strays(piece.from, piece.c1, piece.c2, piece.to, move) <= within) {
    return [piece];
  }
  const [left, right] = splitCubic(piece.from, piece.c1, piece.c2, piece.to, 0.5);
  return [
    ...cutUntilItFollows(
      { from: left[0], c1: left[1], c2: left[2], to: left[3], picked: piece.picked },
      move,
      within,
      depth - 1,
    ),
    ...cutUntilItFollows(
      { from: right[0], c1: right[1], c2: right[2], to: right[3], picked: piece.picked },
      move,
      within,
      depth - 1,
    ),
  ];
}

/**
 * Which nodes a move should reach, by the keys a selection is held in.
 *
 * A contour is walked as a ring of segments, and a segment is cut only when
 * both of its ends were picked. Cutting one with a loose end would put new
 * points into a curve running off towards a part of the letter nobody
 * selected, which is the one thing "act on what is selected" has to not do.
 */
export interface Picked {
  has: (contour: number, node: number) => boolean;
}

/** What warping would cost, before it is done. */
export interface Cost {
  /** How many points the letter has now. */
  before: number;
  /** How many it would have after. */
  after: number;
}

/**
 * Warp what is picked, and give back the contours and what it cost.
 *
 * `within` is how far a curve may stray from the field before it is cut, in
 * font units. A tolerance rather than a number of cuts, because the answer
 * differs per segment: the two ends of a stem need none and the middle of a
 * bulge needs three, and a fixed number would either miss the bend or fill the
 * letter with points that changed nothing.
 *
 * The rule about what moves is the one the whole feature is built on, and it
 * survives cutting: a node moves when it was picked, or when a cut made it --
 * and a cut is only made inside a segment whose two ends were both picked, so
 * every node a cut makes is one somebody asked for. An unpicked node keeps its
 * place exactly, even in a contour that was cut elsewhere.
 */
export function warpContours(
  contours: Contour[],
  picked: Picked,
  move: Move,
  { within = 2, cut = true }: { within?: number; cut?: boolean } = {},
): { contours: Contour[]; cost: Cost } {
  let before = 0;
  let after = 0;

  const out = contours.map((contour, index) => {
    const nodes = contour.nodes;
    before += nodes.length;
    if (nodes.length === 0) return contour;
    const wanted = nodes.map((_, node) => picked.has(index, node));

    /*
     * Every segment of the ring, cut where it needs cutting.
     *
     * Built as a list of pieces first and turned back into nodes afterwards,
     * because a node sits between two pieces: its incoming handle belongs to
     * the piece before it and its outgoing handle to the piece after. Built
     * the other way round -- a node at a time -- the handle arriving from a
     * segment that was cut has to be reached backwards, which is the version
     * of this that was wrong.
     */
    const pieces: Array<Piece & { original: GlyphNode | null; whole: boolean }> = [];
    const segments = contour.closed ? nodes.length : nodes.length - 1;
    for (let at = 0; at < segments; at++) {
      const here = nodes[at];
      const next = nodes[(at + 1) % nodes.length];
      const both = wanted[at] && wanted[(at + 1) % nodes.length];
      const piece: Piece = {
        from: here.point,
        c1: here.handleOut ?? here.point,
        c2: next.handleIn ?? next.point,
        to: next.point,
        picked: wanted[at],
      };
      const parts = cut && both ? cutUntilItFollows(piece, move, within) : [piece];
      for (const [which, part] of parts.entries()) {
        pieces.push({
          ...part,
          picked: which === 0 ? wanted[at] : true,
          original: which === 0 ? here : null,
          // Whether this piece is the whole of an original segment, so a
          // straight one can keep its handles null rather than gaining two
          // that sit exactly on their own points.
          whole: parts.length === 1,
        });
      }
    }

    /** The node between the piece before and the piece after it. */
    const nodeAt = (index: number, coming: (typeof pieces)[number] | null): GlyphNode => {
      const piece = pieces[index];
      const from = piece.original;
      return {
        ...(from ?? { type: "smooth" as const }),
        point: piece.from,
        handleIn:
          from && piece.whole && (coming === null || coming.whole)
            ? (from.handleIn ?? null)
            : (coming?.c2 ?? from?.handleIn ?? null),
        handleOut: from && piece.whole ? (from.handleOut ?? null) : piece.c1,
      };
    };

    const built: Array<{ node: GlyphNode; moves: boolean }> = [];
    for (let at = 0; at < pieces.length; at++) {
      const coming = contour.closed
        ? pieces[(at - 1 + pieces.length) % pieces.length]
        : at === 0
          ? null
          : pieces[at - 1];
      built.push({ node: nodeAt(at, coming), moves: pieces[at].picked });
    }

    /*
     * An open contour ends on a node no segment starts at, so it is pushed
     * here rather than by the loop. A closed one has no such node: its last
     * segment arrives back at the first, which the loop already put down.
     */
    if (!contour.closed) {
      const end = nodes[nodes.length - 1];
      const arriving = pieces[pieces.length - 1];
      built.push({
        node: {
          ...end,
          point: arriving.to,
          handleIn: arriving.whole ? (end.handleIn ?? null) : arriving.c2,
        },
        moves: wanted[nodes.length - 1],
      });
    }

    const moved = built.map(({ node, moves }) => (moves ? moveNode(node, move) : node));
    after += moved.length;
    return { ...contour, nodes: moved };
  });

  return { contours: out, cost: { before, after } };
}
