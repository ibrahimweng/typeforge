/**
 * Named parts of a letter.
 *
 * The parameters so far reshape a letter as a whole -- heavier, wider, more
 * slanted. These reach into it and move one named part, which is how a type
 * designer talks about the work: raise the crossbar, square up the shoulder.
 *
 * Both parts are found from the drawing rather than from a list of which
 * letters have them, so they hold for glyphs nobody thought about. That makes
 * the finding the hard part, and the rule throughout is that a letter the
 * finder is not sure about is left exactly as drawn. A crossbar control that
 * does nothing to an s is a small disappointment; one that bends its spine is
 * a broken font.
 *
 * The crossbar is the horizontal stroke nearest the middle of the letter --
 * the bar of an H or an A, the middle arm of an E, the eye of an e, the bar of
 * a 4. Bars sitting at the very top or bottom are left out: they are the ends
 * of the letter rather than something crossing it, and moving them would
 * change its height.
 *
 * The shoulder is where an arch springs from a stem. That is a junction
 * between a straight upright edge and the curve leaving it, but only some of
 * those are shoulders: an n has four such junctions, two where the arch leaves
 * the left stem and two where it comes down into the right one. Only the first
 * pair is the shoulder, and moving the other pair drags the far side of the
 * letter about instead.
 *
 * They are told apart by what the stem does past the junction. A shoulder sits
 * partway up a stem that carries on above and below it -- on DejaVu's n the
 * left stem runs from the baseline to 633, the arch leaves, and the stem
 * resumes from 946 to the x-height. Where the arch lands, the stem simply
 * stops: at x=1124 the only upright run is 0 to 676 and there is nothing above
 * it, because that stem exists only as the arch coming down.
 */

import {
  contourContainsPoint,
  contourSegments,
  contoursBounds,
  cubicAt,
  cubicParametersAtY,
  inkRunsAt,
  splitCubic,
  type Segment,
} from "./geometry";
import { contoursIntersect } from "./outline";
import type { Contour, GlyphNode, Vec2 } from "./types";

/** How far from horizontal a segment may run and still count as one. */
const HORIZONTAL_TOLERANCE = 0.12;
/**
 * How close two edges have to be in height to be the same edge of a bar, as a
 * fraction of the letter's height.
 *
 * This was two font units, which only holds for fonts drawn on a grid of round
 * numbers. Lora's 4 has the top of its bar at 253 right of the stem and 256.5
 * inside the triangle, and with two units those were two different levels 3.5
 * apart -- which the finder then took for a bar three and a half units thick,
 * sitting on top of the real one.
 */
const SAME_LEVEL = 0.015;
/** How near the top or bottom of a letter a bar stops being a crossbar. */
const EXTREME_MARGIN = 0.06;
/**
 * Thickest band still read as one bar, as a fraction of the letter's height.
 *
 * It was 0.4, which is not a bar but most of a letter: it let the two flat
 * tips of Geist's s, 200 units apart, pass for the top and bottom of a
 * crossbar, and moving them bent the spine. A real crossbar is a stroke, and a
 * stroke is thin next to the letter -- Geist's H bar is 86 units of 710, and a
 * black weight does not get near a fifth.
 */
const MAX_BAR_DEPTH = 0.22;
/** Thinnest band read as a bar rather than two edges that happen to be close. */
const MIN_BAR_DEPTH = 0.02;
/**
 * The least a bar edge must turn where it meets what holds it up.
 *
 * A bar ends in a corner: it runs into a stem, or the diagonal of an A, or the
 * bowl of an e, and the outline turns sharply there. A horizontal edge that
 * runs on smoothly into a curve is not a bar at all but the flat bottom of a
 * bowl -- the lower stroke of P, R and B, where Geist draws a straight piece
 * from the stem and lets it bend round into the bowl without a break.
 */
const MIN_CORNER = Math.cos((30 * Math.PI) / 180);
/**
 * How far a terminal may reach beyond the bar it ends, in bar thicknesses.
 *
 * Lora ends the middle arm of its E in a serif that hangs 85 units below a bar
 * 40 thick and rises as far above it. All of that is the end of the bar and
 * moves with it.
 */
const CAP_REACH = 2.5;
/**
 * How nearly a stem above a bar and the one below must line up to be one
 * stroke passing through it: the cosine of the angle between them, which is -1
 * for a straight stem and 0 for two strokes leaving at right angles.
 */
const MAX_THROUGH = Math.cos((135 * Math.PI) / 180);
/** The most segments a terminal is walked through before giving up. */
const CAP_STEPS = 16;

/** The band a crossbar occupies. */
export interface Crossbar {
  bottom: number;
  top: number;
}

/** Which way to walk a contour's nodes. */
type Walk = "forward" | "backward";

function isHorizontal(from: Vec2, to: Vec2): boolean {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  return dx > 0 && dy <= dx * HORIZONTAL_TOLERANCE;
}

/**
 * The segment that leaves a node in the given direction, and the node it
 * arrives at. Null past the end of an open contour.
 */
function step(
  contour: Contour,
  segments: Segment[],
  node: number,
  walk: Walk,
): { segment: Segment; index: number; next: number } | null {
  const count = contour.nodes.length;
  if (walk === "forward") {
    if (!contour.closed && node >= count - 1) return null;
    return { segment: segments[node], index: node, next: (node + 1) % count };
  }
  if (!contour.closed && node <= 0) return null;
  const index = (node - 1 + count) % count;
  return { segment: segments[index], index, next: index };
}

/** The point a segment reaches when walked in the given direction. */
function farEnd(segment: Segment, walk: Walk): Vec2 {
  return walk === "forward" ? segment.to : segment.from;
}

/** Unit direction a segment sets off in when walked from its near end. */
function leaving(segment: Segment, walk: Walk): Vec2 {
  const points =
    segment.kind === "line"
      ? [segment.from, segment.to]
      : [segment.from, segment.c1, segment.c2, segment.to];
  if (walk === "backward") points.reverse();
  const [start, ...rest] = points;
  for (const point of rest) {
    const dx = point.x - start.x;
    const dy = point.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length > 1e-6) return { x: dx / length, y: dy / length };
  }
  return { x: 0, y: 0 };
}

/** Lowest and highest a segment's control polygon reaches. */
function reach(segment: Segment): { low: number; high: number } {
  const ys =
    segment.kind === "line"
      ? [segment.from.y, segment.to.y]
      : [segment.from.y, segment.c1.y, segment.c2.y, segment.to.y];
  return { low: Math.min(...ys), high: Math.max(...ys) };
}

/** Whether there is ink at a point, by the even-odd rule. */
function inkAt(contours: Contour[], x: number, y: number): boolean {
  return inkRunsAt(contours, y).some(([from, to]) => x > from && x < to);
}

/** Move a point and the handles that belong to it. */
function moveNode(node: GlyphNode, dx: number, dy: number): GlyphNode {
  const move = (point: Vec2 | null): Vec2 | null =>
    point ? { x: point.x + dx, y: point.y + dy } : null;
  return {
    ...node,
    point: { x: node.point.x + dx, y: node.point.y + dy },
    handleIn: move(node.handleIn),
    handleOut: move(node.handleOut),
  };
}

/**
 * Apply a move, backing off until it no longer tears the letter.
 *
 * Both parts are moved by reasoning about the outline near them, and that
 * reasoning runs out at large settings: a bar raised further than the stem
 * above it is long, a shoulder lowered past the foot of its stem. Rather than
 * hand back a letter that crosses itself there, the move goes as far as it
 * cleanly can and stops, which on a slider reads as the part reaching the end
 * of its travel. A letter that already crossed itself as drawn -- some fonts
 * are built from overlapping pieces -- cannot be judged that way, and is moved
 * on trust.
 */
function asFarAsClean(
  contours: Contour[],
  shift: number,
  attempt: (shift: number) => Contour[] | null,
): Contour[] {
  const crossedAlready = contoursIntersect(contours);
  const clean = (moved: Contour[] | null): moved is Contour[] =>
    moved !== null && (crossedAlready || !contoursIntersect(moved));

  const full = attempt(shift);
  if (clean(full)) return full;

  let best: Contour[] | null = null;
  let low = 0;
  let high = 1;
  for (let round = 0; round < 7; round++) {
    const middle = (low + high) / 2;
    const moved = attempt(shift * middle);
    if (clean(moved)) {
      best = moved;
      low = middle;
    } else {
      high = middle;
    }
  }
  return best ?? contours;
}

// ---------------------------------------------------------------------------
// Crossbar
// ---------------------------------------------------------------------------

/**
 * A straight horizontal edge that is one side of a stroke.
 *
 * A floor has ink above it and a ceiling has ink below, which is found by
 * looking rather than from the direction the contour runs: TrueType and CFF
 * wind their outlines opposite ways, and Lora and Geist between them use both.
 */
interface FlatEdge {
  contour: number;
  /** Index of the segment, which runs from this node to the next. */
  segment: number;
  y: number;
  xMin: number;
  xMax: number;
}

/**
 * How one end of a bar edge is held.
 *
 * A cap is a terminal: walking on from the floor's end comes round to the
 * ceiling's without leaving the neighbourhood of the bar, as at the free end
 * of an E's arm. Anything else is attached to some other part of the letter,
 * and `direction` says whether that part rises from the bar or falls from it.
 */
type BarEnd =
  | { kind: "cap"; contour: number; chain: number[] }
  | {
      kind: "attached";
      contour: number;
      /** Nodes that move as one with this end, from the edge's own point out. */
      chain: number[];
      /** Direction walked out of the bar to reach the attachment. */
      walk: Walk;
      direction: "up" | "down";
      /** Which way the attachment sets off from the bar. */
      tangent: Vec2;
      /**
       * The edge runs on into a curve without a corner: the flat of a bowl
       * meeting the stem, as at the waist of B, P and R.
       */
      smooth?: boolean;
    };

/** One horizontal stroke: a floor and the ceiling above it, and how each end is held. */
interface BarPiece {
  ends: BarEnd[];
}

interface BarPlan extends Crossbar {
  pieces: BarPiece[];
  /** How far a reshaped join may overshoot its own ends, in font units. */
  slack: number;
}

/**
 * Follow a bar edge out of one of its ends.
 *
 * First for a terminal, which comes back round to the partner edge; failing
 * that, past any short pieces that stay level with the bar -- the stub Geist
 * draws where the eye of the e meets the outer edge -- to the first segment
 * that leaves it, which is what the bar is attached to.
 */
function followEnd(
  contours: Contour[],
  contour: number,
  node: number,
  walk: Walk,
  outward: Vec2,
  partner: number | null,
  band: Crossbar,
  tolerance: number,
): BarEnd | null {
  const shape = contours[contour];
  const segments = contourSegments(shape);
  const thickness = band.top - band.bottom;

  if (partner !== null) {
    const slack = thickness * CAP_REACH;
    const chain = [node];
    let at = node;
    for (let count = 0; count < CAP_STEPS; count++) {
      const next = step(shape, segments, at, walk);
      if (!next) break;
      const { low, high } = reach(next.segment);
      if (low < band.bottom - slack || high > band.top + slack) break;
      chain.push(next.next);
      if (next.next === partner) return { kind: "cap", contour, chain };
      at = next.next;
    }
  }

  // Attached, so the edge has to turn a real corner into whatever holds it.
  const first = step(shape, segments, node, walk);
  if (!first) return null;
  const tangent = leaving(first.segment, walk);
  if (tangent.x * outward.x + tangent.y * outward.y > MIN_CORNER) {
    // No corner: the edge is the flat of a bowl carrying on into its curve.
    // That is the waist of a B, P or R rather than a bar crossing anything,
    // and it is kept as such so the letter can be judged as a whole; the
    // curve itself is the attachment, and the move has to reshape it cleanly
    // or not happen (see `reshapeJoin`).
    if (first.segment.kind !== "cubic") return null;
    const far = farEnd(first.segment, walk);
    // Which way the bowl goes from here does not matter to a waist, and after
    // a move the join may run almost level, so it is not asked to go anywhere.
    const rise = far.y - shape.nodes[node].point.y;
    return {
      kind: "attached",
      contour,
      chain: [node],
      walk,
      direction: rise > 0 ? "up" : "down",
      tangent,
      smooth: true,
    };
  }

  const chain = [node];
  let at = node;
  for (let count = 0; count < 4; count++) {
    const next = step(shape, segments, at, walk);
    if (!next) return null;
    const { low, high } = reach(next.segment);
    const inBand = low >= band.bottom - tolerance && high <= band.top + tolerance;
    if (!inBand) {
      const far = farEnd(next.segment, walk);
      let direction: "up" | "down";
      if (far.y > band.top + tolerance) direction = "up";
      else if (far.y < band.bottom - tolerance) direction = "down";
      else if (high > band.top + tolerance && low >= band.bottom - tolerance) direction = "up";
      else if (low < band.bottom - tolerance && high <= band.top + tolerance) direction = "down";
      else return null;
      return {
        kind: "attached",
        contour,
        chain,
        walk,
        direction,
        tangent: leaving(next.segment, walk),
      };
    }
    chain.push(next.next);
    at = next.next;
  }
  return null;
}

/**
 * How both ends of one side of a bar piece are held: a cap, a stem passing
 * through, or the bar turning into something.
 */
function classifySide(
  contours: Contour[],
  floor: FlatEdge,
  ceiling: FlatEdge,
  side: "left" | "right",
  band: Crossbar,
  tolerance: number,
): { kind: "cap" | "through" | "turning" | "bowl"; ends: BarEnd[] } | null {
  const endOf = (edge: FlatEdge) => {
    const nodes = contours[edge.contour].nodes;
    const count = nodes.length;
    const fromNode = edge.segment;
    const toNode = (edge.segment + 1) % count;
    const fromIsLeft = nodes[fromNode].point.x <= nodes[toNode].point.x;
    const node = (side === "left") === fromIsLeft ? fromNode : toNode;
    const other = node === fromNode ? toNode : fromNode;
    const walk: Walk = node === toNode ? "forward" : "backward";
    const dx = nodes[node].point.x - nodes[other].point.x;
    const dy = nodes[node].point.y - nodes[other].point.y;
    const length = Math.hypot(dx, dy) || 1;
    return { node, walk, outward: { x: dx / length, y: dy / length } };
  };

  const floorEnd = endOf(floor);
  const ceilingEnd = endOf(ceiling);
  const partner = floor.contour === ceiling.contour ? ceilingEnd.node : null;

  const fromFloor = followEnd(
    contours,
    floor.contour,
    floorEnd.node,
    floorEnd.walk,
    floorEnd.outward,
    partner,
    band,
    tolerance,
  );
  if (!fromFloor) return null;
  if (fromFloor.kind === "cap") {
    // A bar drawn as a piece of its own, laid against or into the stems, as
    // fonts built from overlapping parts do: its ends are capped, but the cap
    // is inside a stem, so something does pass through the bar there.
    const chain = fromFloor.chain.map((index) => contours[floor.contour].nodes[index].point);
    const xs = chain.map((point) => point.x);
    const probe = Math.max(1, (band.top - band.bottom) * 0.1);
    const beyond = {
      x: side === "left" ? Math.min(...xs) - probe : Math.max(...xs) + probe,
      y: (band.bottom + band.top) / 2,
    };
    const buried = contours.some(
      (other, index) => index !== floor.contour && contourContainsPoint(other, beyond),
    );
    return { kind: buried ? "through" : "cap", ends: [fromFloor] };
  }

  const fromCeiling = followEnd(
    contours,
    ceiling.contour,
    ceilingEnd.node,
    ceilingEnd.walk,
    ceilingEnd.outward,
    null,
    band,
    tolerance,
  );
  if (fromCeiling?.kind !== "attached") return null;

  if (fromFloor.smooth || fromCeiling.smooth) {
    // Both edges have to run into the bowl: one edge meeting a stem at a
    // corner while the other flows on is not a waist, and not a bar either.
    if (!fromFloor.smooth || !fromCeiling.smooth) return null;
    return { kind: "bowl", ends: [fromFloor, fromCeiling] };
  }

  if (fromFloor.direction === "down" && fromCeiling.direction === "up") {
    // Something going down from the bar and something going up from it are
    // one stroke passing through only if they carry on in a line. Lora's k
    // has a short flat joint where the arm and the leg meet the stem, and on
    // its right the arm leaves up and the leg down at right angles to each
    // other: a fork, not a stem, and the joint is not a bar.
    const { tangent: down } = fromFloor;
    const { tangent: up } = fromCeiling;
    if (down.x * up.x + down.y * up.y > MAX_THROUGH) return null;
    return { kind: "through", ends: [fromFloor, fromCeiling] };
  }
  if (fromFloor.direction === fromCeiling.direction) {
    return { kind: "turning", ends: [fromFloor, fromCeiling] };
  }
  return null;
}

/**
 * Find the crossbar and everything that has to move with it.
 *
 * The first version collected every straight horizontal edge and took the two
 * levels closest together around the middle as the bar. On a real font that
 * finds bars everywhere: the flat tips of an s, the crotch of a k and the
 * serif on its arm, the top of the 4's bar counted twice. What makes a
 * crossbar is not two flat edges but a stroke -- a floor with ink above it and
 * a ceiling with ink below, overlapping, thin, and filled between -- that is
 * held at each end in a way a bar is held.
 *
 * Something has to pass through it on at least one side: a stem runs on above
 * and below it, as in H and A and on the left of E. The other side may be the
 * same, or a terminal (the free end of E's arm, the tail of the 4's bar), or
 * the bar turning up into a bowl (the e, whose bar runs into the outer edge;
 * the 4, whose bar runs into the diagonal). A stroke with no side passing
 * through is something else -- the serif on the end of Lora's k is capped on
 * one side and turns down into the arm on the other, and is a serif.
 */
function planCrossbar(contours: Contour[]): BarPlan | null {
  if (contours.length === 0) return null;
  const bounds = contoursBounds(contours);
  const height = bounds.yMax - bounds.yMin;
  if (height <= 0) return null;

  const margin = height * EXTREME_MARGIN;
  const tolerance = Math.max(2, height * SAME_LEVEL);
  const probe = Math.max(1, height * 0.005);
  const floors: FlatEdge[] = [];
  const ceilings: FlatEdge[] = [];

  contours.forEach((contour, ci) => {
    contourSegments(contour).forEach((segment, si) => {
      if (segment.kind !== "line") return;
      if (!isHorizontal(segment.from, segment.to)) return;
      const y = (segment.from.y + segment.to.y) / 2;
      // The ends of the letter are not something crossing it.
      if (y <= bounds.yMin + margin || y >= bounds.yMax - margin) return;
      const x = (segment.from.x + segment.to.x) / 2;
      const above = inkAt(contours, x, y + probe);
      const below = inkAt(contours, x, y - probe);
      if (above === below) return;
      const edge: FlatEdge = {
        contour: ci,
        segment: si,
        y,
        xMin: Math.min(segment.from.x, segment.to.x),
        xMax: Math.max(segment.from.x, segment.to.x),
      };
      (above ? floors : ceilings).push(edge);
    });
  });
  if (floors.length === 0 || ceilings.length === 0) return null;

  const levels = (edges: FlatEdge[]): FlatEdge[][] => {
    const groups: FlatEdge[][] = [];
    for (const edge of [...edges].sort((a, b) => a.y - b.y)) {
      const last = groups[groups.length - 1];
      if (last && edge.y - last[0].y <= tolerance) last.push(edge);
      else groups.push([edge]);
    }
    return groups;
  };
  const levelY = (group: FlatEdge[]) => group.reduce((sum, edge) => sum + edge.y, 0) / group.length;

  const middle = (bounds.yMin + bounds.yMax) / 2;
  let best: BarPlan | null = null;
  let bestDistance = Infinity;

  for (const floorLevel of levels(floors)) {
    for (const ceilingLevel of levels(ceilings)) {
      const bottom = levelY(floorLevel);
      const top = levelY(ceilingLevel);
      const thickness = top - bottom;
      if (thickness < height * MIN_BAR_DEPTH || thickness > height * MAX_BAR_DEPTH) continue;
      const distance = Math.abs((bottom + top) / 2 - middle);
      if (distance >= bestDistance) continue;

      const band = { bottom, top };
      const pieces: BarPiece[] = [];
      const paired = new Set<FlatEdge>();
      let broken = false;
      for (const floor of floorLevel) {
        // The ceiling this floor is the underside of: the one overlapping it most.
        let partner: FlatEdge | null = null;
        let overlap = 0;
        for (const ceiling of ceilingLevel) {
          const shared = Math.min(floor.xMax, ceiling.xMax) - Math.max(floor.xMin, ceiling.xMin);
          if (shared > overlap) {
            overlap = shared;
            partner = ceiling;
          }
        }
        const across = partner
          ? (Math.max(floor.xMin, partner.xMin) + Math.min(floor.xMax, partner.xMax)) / 2
          : 0;
        if (
          !partner ||
          overlap < Math.max(thickness * 0.5, height * 0.03) ||
          !inkAt(contours, across, (bottom + top) / 2)
        ) {
          // An edge at the bar's height that is not one side of it. Lora's t
          // draws its bar as a straight piece right of the stem and a curved
          // flag left of it whose underside is flat: moving the bar and not
          // the flag split the bar in two at the stem, so a level with
          // anything left over is not trusted.
          broken = true;
          break;
        }
        paired.add(partner);

        const left = classifySide(contours, floor, partner, "left", band, tolerance);
        const right = classifySide(contours, floor, partner, "right", band, tolerance);
        const kinds = [left?.kind, right?.kind];
        if (!left || !right || !kinds.includes("through")) {
          // A stroke at the bar's height that is not a bar. Moving the rest
          // without it would pull the letter apart, so the whole level goes.
          broken = true;
          break;
        }
        pieces.push({ ends: [...left.ends, ...right.ends] });
      }
      if (broken || pieces.length === 0) continue;
      if (ceilingLevel.some((ceiling) => !paired.has(ceiling))) continue;
      best = { bottom, top, pieces, slack: Math.max(1, height * 0.01) };
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Find the horizontal stroke crossing the middle of a letter.
 *
 * Returns null when a letter has no such stroke, which is most of them, and
 * also when something at that height looks like a bar but is not held like
 * one; see `planCrossbar`.
 */
export function findCrossbar(contours: Contour[]): Crossbar | null {
  const plan = planCrossbar(contours);
  return plan ? { bottom: plan.bottom, top: plan.top } : null;
}

/** What one node becomes; unset fields keep their value. */
interface NodeEdit {
  point?: Vec2;
  handleIn?: Vec2 | null;
  handleOut?: Vec2 | null;
}

/**
 * Where an attached end of the bar lands, and what that does to what it is
 * attached to.
 *
 * A straight attachment is easy: slide along it, which on a vertical stem is
 * straight up and on the diagonal of an A is along the diagonal. It must not
 * slide off the far end, which is what folded the right side of Geist's e: the
 * bar ends there on a stub 39 units tall, and raising the bar by 80 slid the
 * corner past the top of the stub. The stub is now carried with the bar (it
 * is level with it, so it is part of its end) and the slide happens on the
 * curve beyond.
 *
 * A curved attachment is solved for the height wanted and split there. The
 * point lands exactly on the curve, and the piece that remains is the original
 * curve's own tail rather than an approximation of it, so nothing outside the
 * join is disturbed. The bar naturally becomes shorter or longer as the bowl
 * narrows or widens, which is what the letter should do.
 *
 * When the curve does not reach that height, the end is moved to it anyway and
 * the curve stretches to follow, carrying its own handle with it and leaving
 * the far end alone. That is the ordinary result of dragging a point in any
 * editor. It is needed because an exact slide is often not available: the bar
 * of an e ends on a curve running down from it, so raising the bar has nowhere
 * on that curve to land -- the corner is the highest the aperture reaches.
 */
function moveEnd(
  contours: Contour[],
  end: Extract<BarEnd, { kind: "attached" }>,
  shift: number,
  edits: Map<string, NodeEdit>,
  slack: number,
): boolean {
  const contour = contours[end.contour];
  const segments = contourSegments(contour);
  let chain = end.chain;
  let near = chain[chain.length - 1];
  let attachment = step(contour, segments, near, end.walk);
  if (!attachment) return false;
  if (end.smooth) return reshapeJoin(contour, end, attachment, shift, slack, edits);

  // Moving away from a curved attachment, a straight stub between it and the
  // bar is better lengthened than carried. Geist's e ends its bar on a stub
  // under the curve of the bowl's outer edge; lowering the bar by carrying
  // the stub pulled the start of that curve down with it and flattened the
  // whole right side of the letter, where lengthening the stub leaves the
  // bowl exactly as drawn.
  const away = end.direction === "up" ? shift < 0 : shift > 0;
  const stub = chain.length > 1 ? step(contour, segments, chain[0], end.walk) : null;
  if (away && attachment.segment.kind === "cubic" && stub && stub.segment.kind === "line") {
    chain = [chain[0]];
    near = chain[0];
    attachment = stub;
  }
  const nearPoint = contour.nodes[near].point;
  const far = attachment.next;
  const wanted = nearPoint.y + shift;

  let vector: Vec2 = { x: 0, y: shift };
  let nearHandle: Vec2 | undefined;
  let farHandle: Vec2 | undefined;

  if (attachment.segment.kind === "line") {
    const farPoint = farEnd(attachment.segment, end.walk);
    const dx = farPoint.x - nearPoint.x;
    const dy = farPoint.y - nearPoint.y;
    if (Math.abs(dy) < 1e-6) return false;
    // Keep a little of the attachment: sliding right up to its far end would
    // leave a corner with nothing between it and the next.
    if (Math.sign(shift) === Math.sign(dy) && Math.abs(shift) > Math.abs(dy) * 0.85) return false;
    vector = { x: (dx / dy) * shift, y: shift };
  } else {
    const { from, c1, c2, to } = attachment.segment;
    const parameters = cubicParametersAtY(from, c1, c2, to, wanted).filter((t) => t > 0 && t < 1);
    if (parameters.length > 0) {
      // Nearest to the end being moved, so a curve doubling back cannot send
      // the bar to the far side of it.
      const home = end.walk === "forward" ? 0 : 1;
      const t = parameters.reduce((best, candidate) =>
        Math.abs(candidate - home) < Math.abs(best - home) ? candidate : best,
      );
      const [left, right] = splitCubic(from, c1, c2, to, t);
      if (end.walk === "forward") {
        vector = { x: right[0].x - nearPoint.x, y: right[0].y - nearPoint.y };
        nearHandle = right[1];
        farHandle = right[2];
      } else {
        vector = { x: left[3].x - nearPoint.x, y: left[3].y - nearPoint.y };
        nearHandle = left[2];
        farHandle = left[1];
      }
    }
  }

  for (const index of chain) {
    const moved = moveNode(contour.nodes[index], vector.x, vector.y);
    const key = `${end.contour}:${index}`;
    edits.set(key, {
      ...edits.get(key),
      point: moved.point,
      handleIn: moved.handleIn,
      handleOut: moved.handleOut,
    });
  }
  if (nearHandle) {
    const key = `${end.contour}:${near}`;
    const edit = edits.get(key) ?? {};
    if (end.walk === "forward") edit.handleOut = nearHandle;
    else edit.handleIn = nearHandle;
    edits.set(key, edit);
  }
  if (farHandle) {
    const key = `${end.contour}:${far}`;
    const edit = edits.get(key) ?? {};
    if (end.walk === "forward") edit.handleIn = farHandle;
    else edit.handleOut = farHandle;
    edits.set(key, edit);
  }
  return true;
}

/** How far a waist may pass the far end of its join, in multiples of the slack. */
const PASS_LIMIT = 3.5;
/** How far a join's handles may be drawn in to keep it from denting, longest first. */
const HANDLE_REACH = [1, 0.8, 0.6, 0.45, 0.3, 0.2];

/**
 * Move the end of a waist bar, where its flat edge flows on into the bowl.
 *
 * This is the move the first version made for B, P and R: the bar's point
 * travels straight up or down, its handle with it so the join stays smooth,
 * and the curve joining it to the bowl stretches while its far end stays put.
 * What it did not check is whether that curve still makes sense. Raise
 * DejaVu's P by 100 and the curve under the bowl, whose far handle still
 * points down towards where the bar used to be, sags 23 units below the new
 * bar before coming back up to it: a dent in the bottom of the bowl.
 *
 * So the handles are drawn in along their own directions -- which keeps the
 * curve smooth where it meets the bar and where it meets the rest of the bowl
 * -- until the curve stays between its two ends. If it cannot, the move is
 * refused, and the caller's back-off finds how far it can cleanly go. Lora's
 * bowls meet the stem without a flat edge at all, so it has no waist bar to
 * find and its B, P and R are left as drawn.
 */
function reshapeJoin(
  contour: Contour,
  end: Extract<BarEnd, { kind: "attached" }>,
  attachment: { segment: Segment; next: number },
  shift: number,
  slack: number,
  edits: Map<string, NodeEdit>,
): boolean {
  const nearIndex = end.chain[0];
  const farIndex = attachment.next;
  const nearNode = contour.nodes[nearIndex];
  const farNode = contour.nodes[farIndex];
  const forward = end.walk === "forward";
  const nearSide: "handleIn" | "handleOut" = forward ? "handleOut" : "handleIn";
  const farSide: "handleIn" | "handleOut" = forward ? "handleIn" : "handleOut";

  const from = { x: nearNode.point.x, y: nearNode.point.y + shift };
  const to = farNode.point;
  // The bar may go a little past the height of the join's far end, but only
  // a little. Past it, the far end becomes a new low or high point of the
  // bowl: a notch in the bottom of P's bowl when its waist is raised 164
  // units in DejaVu, a hook where R's leg leaves. Holding the bar short of it
  // altogether stopped B, P and R about halfway at settings that look fine:
  // moved by 100, DejaVu's R passes by 51 units of a letter 1493 tall, and
  // that is a soft S no one would call a dent.
  const before = to.y - nearNode.point.y;
  const after = to.y - from.y;
  if (Math.sign(after) !== Math.sign(before) && Math.abs(after) > slack * PASS_LIMIT) return false;

  const nearHandle = nearNode[nearSide];
  const farHandle = farNode[farSide];
  const nearReach = nearHandle ? { x: nearHandle.x, y: nearHandle.y + shift } : from;
  const farReach = farHandle ?? to;
  const along = (base: Vec2, handle: Vec2, k: number): Vec2 => ({
    x: base.x + (handle.x - base.x) * k,
    y: base.y + (handle.y - base.y) * k,
  });
  const low = Math.min(from.y, to.y) - slack;
  const high = Math.max(from.y, to.y) + slack;

  for (const farK of HANDLE_REACH) {
    for (const nearK of [1, farK]) {
      const c1 = along(from, nearReach, nearK);
      const c2 = along(to, farReach, farK);
      let clean = true;
      for (let i = 1; i < 16 && clean; i++) {
        const y = cubicAt(from, c1, c2, to, i / 16).y;
        if (y < low || y > high) clean = false;
      }
      if (!clean) continue;

      const moved = moveNode(nearNode, 0, shift);
      const nearKey = `${end.contour}:${nearIndex}`;
      edits.set(nearKey, {
        ...edits.get(nearKey),
        point: moved.point,
        handleIn: moved.handleIn,
        handleOut: moved.handleOut,
        [nearSide]: nearHandle ? c1 : null,
      });
      if (farHandle) {
        const farKey = `${end.contour}:${farIndex}`;
        edits.set(farKey, { ...edits.get(farKey), [farSide]: c2 });
      }
      return true;
    }
  }
  return false;
}

function applyEdits(contours: Contour[], edits: Map<string, NodeEdit>): Contour[] {
  return contours.map((contour, ci) => {
    // A contour nothing touched is handed back as it was.
    if (!contour.nodes.some((_, ni) => edits.has(`${ci}:${ni}`))) return contour;
    return {
      closed: contour.closed,
      nodes: contour.nodes.map((node, ni) => {
        const edit = edits.get(`${ci}:${ni}`);
        if (!edit) return node;
        return {
          ...node,
          point: edit.point ?? node.point,
          handleIn: edit.handleIn !== undefined ? edit.handleIn : node.handleIn,
          handleOut: edit.handleOut !== undefined ? edit.handleOut : node.handleOut,
        };
      }),
    };
  });
}

/**
 * Move the crossbar up or down.
 *
 * Only the bar moves: its two edges, the terminal on a free end (serifs and
 * all, so Lora's E keeps the spur on its middle arm), and each attached end
 * slides along whatever holds it -- up a stem, along the diagonal of an A or
 * a 4, or round the bowl of an e. Selecting points by height alone was the
 * first version of this, and it dragged whatever else happened to lie at that
 * height.
 *
 * Nothing moves unless every end can be placed, so a bar is never left
 * half-attached, and a move that would make the letter cross itself is cut
 * short where it stops being clean.
 */
export function shiftCrossbar(contours: Contour[], shift: number): Contour[] {
  if (shift === 0) return contours;
  const plan = planCrossbar(contours);
  if (!plan) return contours;

  return asFarAsClean(contours, shift, (amount) => {
    const edits = new Map<string, NodeEdit>();
    for (const piece of plan.pieces) {
      for (const end of piece.ends) {
        if (end.kind === "cap") {
          for (const index of end.chain) {
            const moved = moveNode(contours[end.contour].nodes[index], 0, amount);
            edits.set(`${end.contour}:${index}`, moved);
          }
        } else if (!moveEnd(contours, end, amount, edits, plan.slack)) {
          return null;
        }
      }
    }
    return edits.size === 0 ? null : applyEdits(contours, edits);
  });
}

// ---------------------------------------------------------------------------
// Shoulder
// ---------------------------------------------------------------------------

/**
 * An upright run of a stem's edge: consecutive segments that all run steeply
 * and straight in the same direction.
 *
 * Straight means straight to the eye rather than a line segment. TrueType
 * fonts arrive as quadratics, and Lora draws the top of its n's stem as three
 * short curves each flat to within a unit; counting only line segments, the
 * stem above the shoulder did not exist and the n had no shoulder at all.
 */
interface UprightRun {
  contour: number;
  /** Node indices in contour order from the run's start to its end. */
  nodes: number[];
  x: number;
  low: number;
  high: number;
}

/** Fraction of a letter's height a stem's edge must run to count as a stem. */
const MIN_STEM_RUN = 0.08;
/** How long both stems of an arch have to be when neither carries on past it. */
const LONG_STEM = 0.25;
/** How far a stem's edge may lean, as run over rise. */
const MAX_STEM_LEAN = 0.1;
/** How far apart in x two runs may be and still be one stem edge, of the height. */
const SAME_EDGE = 0.035;
/** Widest gap across a junction that a stem may resume after, of the height. */
const MAX_SPRING_GAP = 0.45;
/** How far an arch must climb, or come back down, to be one, of the height. */
const ARCH_RISE = 0.06;
const ARCH_FALL = 0.1;
/**
 * How far from the springing's height the far stem may start, of the height.
 * Lora's m springs its second arch at 414 and lands it on a stem whose
 * straight part starts at 292; Geist's b goes right round its bowl to land at
 * 74, which is not an arch coming down but a bowl closing.
 */
const ARCH_LANDING = 0.3;
/** Least angle above horizontal an arch leaves its stem at. */
const MIN_SPRING = Math.sin((25 * Math.PI) / 180);

/** Which way a segment runs upright, or 0 when it does not. */
function uprightSense(segment: Segment): number {
  const dx = segment.to.x - segment.from.x;
  const dy = segment.to.y - segment.from.y;
  if (dy === 0 || Math.abs(dy) <= Math.abs(dx) * 2.5) return 0;
  if (segment.kind === "cubic") {
    // Flat: both handles sit on the chord, so the curve is a straight run.
    const length = Math.hypot(dx, dy);
    const off = (point: Vec2) =>
      Math.abs((point.x - segment.from.x) * dy - (point.y - segment.from.y) * dx) / length;
    const allowed = Math.max(1.5, length * 0.03);
    if (off(segment.c1) > allowed || off(segment.c2) > allowed) return 0;
  }
  return Math.sign(dy);
}

function uprightRuns(contours: Contour[]): UprightRun[] {
  const runs: UprightRun[] = [];
  contours.forEach((contour, ci) => {
    const segments = contourSegments(contour);
    const count = segments.length;
    if (count === 0) return;
    const senses = segments.map(uprightSense);
    // Start just after a break, so no run is cut in two where a closed
    // contour wraps round.
    let start = 0;
    if (contour.closed) {
      const broken = senses.findIndex((sense, i) => sense !== senses[(i - 1 + count) % count]);
      if (broken === -1) return;
      start = broken;
    }
    const limit = count;
    let i = 0;
    while (i < limit) {
      const index = (start + i) % count;
      const sense = senses[index];
      if (sense === 0) {
        i++;
        continue;
      }
      const nodes = [index];
      let j = i;
      while (j < limit && senses[(start + j) % count] === sense) {
        nodes.push((start + j + 1) % contour.nodes.length);
        j++;
      }
      const points = nodes.map((node) => contour.nodes[node].point);
      const ys = points.map((point) => point.y);
      i = j;
      // Straight as a whole, not only piece by piece: the side of Lora's o is
      // a string of short curves each nearly flat, and together they are a
      // bowl, not a stem.
      const first = points[0];
      const last = points[points.length - 1];
      const chord = Math.hypot(last.x - first.x, last.y - first.y);
      const bends = points.some(
        (point) =>
          Math.abs(
            (point.x - first.x) * (last.y - first.y) - (point.y - first.y) * (last.x - first.x),
          ) /
            chord >
          Math.max(2, chord * 0.035),
      );
      if (bends) continue;
      // And upright as a whole. The stroke Lora's 6 curls out of leans ten
      // degrees and its bowl springs from it much as an arch does; a stem is
      // plumb. This gives up italic shoulders, which is the safe way round.
      if (Math.abs(last.x - first.x) > Math.abs(last.y - first.y) * MAX_STEM_LEAN) continue;
      runs.push({
        contour: ci,
        nodes,
        x: (points[0].x + points[points.length - 1].x) / 2,
        low: Math.min(...ys),
        high: Math.max(...ys),
      });
    }
  });
  return runs;
}

/** A shoulder: the junction, and the stem edge it sits at the end of. */
interface Springing {
  point: Vec2;
  run: UprightRun;
  /** Which end of the run the junction is. */
  at: "start" | "end";
  /** The highest the arch climbs from it. */
  crown: number;
}

/**
 * Where arches spring from their stems.
 *
 * A junction is the end of an upright run where a curve leaves it. It is a
 * shoulder when the curve rises away from the stem to the right -- an arch --
 * and one of two things shows it springs rather than lands. Either the stem
 * carries on past the junction, which is the left stem of an n; or the curve
 * goes up and over and comes back down, which is the second arch of an m,
 * springing from a middle stem that stops there because the first arch came
 * down on top of it.
 *
 * The first version counted any junction on an edge with upright runs above
 * and below it, however far away. Lora's H lines its serifs up down the left
 * edge at x=55, 623 units apart, so the bracket under each serif counted as a
 * shoulder, and the control put spikes on the serifs of H, E, R, B and P.
 */
function planShoulders(contours: Contour[]): Springing[] {
  if (contours.length === 0) return [];
  const bounds = contoursBounds(contours);
  const height = bounds.yMax - bounds.yMin;
  if (height <= 0) return [];
  const runs = uprightRuns(contours);
  if (runs.length === 0) return [];

  const springings: Springing[] = [];
  for (const run of runs) {
    if (run.high - run.low < height * MIN_STEM_RUN) continue;
    const contour = contours[run.contour];
    const segments = contourSegments(contour);

    for (const at of ["start", "end"] as const) {
      const node = at === "start" ? run.nodes[0] : run.nodes[run.nodes.length - 1];
      const walk: Walk = at === "start" ? "backward" : "forward";
      const out = step(contour, segments, node, walk);
      if (out?.segment.kind !== "cubic" || uprightSense(out.segment) !== 0) continue;
      const point = contour.nodes[node].point;

      // An arch leaves rising, and to the right.
      const tangent = leaving(out.segment, walk);
      if (tangent.y < MIN_SPRING) continue;
      if (farEnd(out.segment, walk).x <= point.x) continue;

      // Up and over: how far it climbs, and how far it comes down after.
      let top = point.y;
      let fall = 0;
      let along = node;
      let landsOnStem = false;
      for (let count = 0; count < 16; count++) {
        const next = step(contour, segments, along, walk);
        if (!next) break;
        if (uprightSense(next.segment) !== 0) {
          // Where the curve stops, a stem has to set off downward from about
          // the height the arch sprang from. Lora's E climbs from its stem
          // into the top arm and comes down the serif at its end, which is up
          // and over as well, but what it comes down to is the arm's end
          // running back up. And a stem is long: the inside of the bowl of
          // Lora's 9 is an arch too, standing on two short nearly-straight
          // stretches of its sides.
          const landing = contour.nodes[along].point;
          const stem = runs.find(
            (other) =>
              other.contour === run.contour &&
              other.nodes.includes(along) &&
              other.nodes.includes(next.next),
          );
          landsOnStem =
            stem !== undefined &&
            stem.high - stem.low >= height * LONG_STEM &&
            run.high - run.low >= height * LONG_STEM &&
            farEnd(next.segment, walk).y < landing.y &&
            Math.abs(landing.y - point.y) <= height * ARCH_LANDING;
          break;
        }
        const segment = next.segment;
        for (let k = 1; k <= 4; k++) {
          const t = walk === "forward" ? k / 4 : 1 - k / 4;
          const y =
            segment.kind === "line"
              ? segment.from.y + (segment.to.y - segment.from.y) * t
              : cubicAt(segment.from, segment.c1, segment.c2, segment.to, t).y;
          if (y > top) top = y;
          fall = Math.max(fall, top - y);
        }
        along = next.next;
        if (along === node) break;
      }
      if (top - point.y < height * ARCH_RISE) continue;
      const overTheTop = landsOnStem && fall >= height * ARCH_FALL;

      // The stem resuming on the other side of the junction.
      const otherEnd =
        contour.nodes[at === "start" ? run.nodes[run.nodes.length - 1] : run.nodes[0]];
      const runBelow = otherEnd.point.y < point.y;
      const resumes = runs.some((other) => {
        if (other === run) return false;
        if (Math.abs(other.x - point.x) > height * SAME_EDGE) return false;
        if (other.high - other.low < height * MIN_STEM_RUN * 0.5) return false;
        const near = runBelow ? other.low : other.high;
        const gap = runBelow ? near - point.y : point.y - near;
        if (gap < -2 || gap > height * MAX_SPRING_GAP) return false;
        // And the stem is solid across the gap: the arch leaves to the right,
        // so the stem is just to the left of the junction all the way to where
        // its edge resumes. Lora's G has a plumb spur under its crossbar and a
        // plumb upright above it, near enough in line, with the open mouth of
        // the letter between them.
        return inkAt(contours, point.x - height * 0.01, (point.y + near) / 2);
      });
      if (!resumes && !overTheTop) continue;

      springings.push({ point: { ...point }, run, at, crown: top });
    }
  }
  return springings;
}

/**
 * Where arches spring from their stems.
 *
 * Only the junctions the arch leaves from, not the ones it lands on, and none
 * on letters with no arch at all; see `planShoulders`.
 */
export function findShoulders(contours: Contour[]): Vec2[] {
  return planShoulders(contours).map((springing) => springing.point);
}

/**
 * Raise or lower where the arches spring.
 *
 * Moving the junction up carries the arch with it and squares the shoulder;
 * moving it down opens the letter out.
 *
 * The stem edge the junction ends is stretched or shortened to follow, pinned
 * at its far end, so it stays straight however many pieces it is drawn in.
 * Moving the junction alone was the first version, and it only worked while
 * the move was shorter than the segment next to it: Lora's n has a curve 25
 * units long just under the shoulder, and lowering by more than that folded
 * the stem back on itself.
 *
 * The arch's own handle travels with the junction but never past the arch's
 * top, so a raised shoulder squares up against the x-height instead of
 * bulging over it.
 */
export function shiftShoulders(contours: Contour[], shift: number): Contour[] {
  if (shift === 0) return contours;
  const springings = planShoulders(contours);
  if (springings.length === 0) return contours;

  return asFarAsClean(contours, shift, (amount) => {
    const edits = new Map<string, NodeEdit>();
    for (const springing of springings) {
      const { run, at } = springing;
      const contour = contours[run.contour];
      const segments = contourSegments(contour);
      const order = at === "end" ? [...run.nodes].reverse() : run.nodes;
      const junction = order[0];
      const anchor = order[order.length - 1];
      const bothEnds = springings.some(
        (other) => other !== springing && other.run === run && other.at !== at,
      );

      const from = contour.nodes[junction].point.y;
      const pinned = contour.nodes[anchor].point.y;
      const scale = (from + amount - pinned) / (from - pinned);
      if (!bothEnds && scale < 0.25) return null;
      // Nor may it climb to the top of its own arch. On an h the outer
      // junction sits under a stem that runs on to the ascender, so nothing
      // else stops it, and it went on up the stem trailing the arch after it
      // in a hook.
      if (amount > (springing.crown - from) * 0.75) return null;
      const remap = (point: Vec2 | null): Vec2 | null =>
        point === null
          ? null
          : bothEnds
            ? { x: point.x, y: point.y + amount }
            : { x: point.x, y: pinned + (point.y - pinned) * scale };

      // Each node's handle facing on along the run, away from the junction,
      // and the one facing back towards it. At the junction the one facing
      // back is the arch's, dealt with below; at the pinned end the one facing
      // on is outside the run and stays as it is.
      const onward: "handleIn" | "handleOut" = at === "end" ? "handleIn" : "handleOut";
      const back: "handleIn" | "handleOut" = at === "end" ? "handleOut" : "handleIn";
      order.forEach((index, position) => {
        const node = contour.nodes[index];
        const first = position === 0;
        const last = position === order.length - 1;
        const key = `${run.contour}:${index}`;
        const edit: NodeEdit = { ...edits.get(key) };
        if (!last || bothEnds) edit.point = remap(node.point) ?? node.point;
        if (!last) edit[onward] = remap(node[onward]);
        if (!first) edit[back] = remap(node[back]);
        edits.set(key, edit);
      });

      // The arch's handle at the junction rides along, held inside the
      // height the arch already spans.
      const arch = step(contour, segments, junction, at === "start" ? "backward" : "forward");
      const handle = contour.nodes[junction][back];
      const key = `${run.contour}:${junction}`;
      const edit = edits.get(key) ?? {};
      if (arch && handle) {
        const { low, high } = reach(arch.segment);
        edit[back] = {
          x: handle.x,
          y: Math.min(high, Math.max(low, handle.y + amount)),
        };
      }
      edits.set(key, edit);
    }
    return applyEdits(contours, edits);
  });
}
