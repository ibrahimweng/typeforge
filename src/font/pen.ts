/**
 * The gesture that makes a curve, and the two edits that let a curve survive
 * being changed.
 *
 * The pen here could not draw a curve at all. Every point it made was a corner
 * with no handles, so it drew polygons and a curve had to be pressed in
 * afterwards from the points panel. Click-and-drag to pull a handle out of the
 * point you are placing is the pen gesture -- Illustrator 88, and unchanged in
 * every editor a type designer has used since.
 *
 * The arithmetic lives here rather than in the canvas because it is the part
 * worth holding to account. Whether a drag produced the handles it should have,
 * whether a point inserted on a segment left the curve where it was, whether a
 * point removed took the shape with it -- those are claims about numbers, and a
 * canvas is a bad place to ask them.
 *
 * Handles are absolute coordinates, as everywhere else in this document model.
 */

import { cubicAt, splitCubic } from "./geometry";
import { fitCubics } from "@/quill/curve";
import type { Contour, GlyphNode, Vec2 } from "./types";

/** How far a press has to travel before it counts as pulling a handle out. */
export const A_DRAG = 3;

/** The angles shift holds a handle to. */
const EIGHTH = Math.PI / 4;

/** A handle held to the nearest eighth turn, at whatever length it had. */
export function heldToAngle(from: Vec2, to: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return to;
  const angle = Math.round(Math.atan2(dy, dx) / EIGHTH) * EIGHTH;
  return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
}

/**
 * The point a pen drag has made, so far.
 *
 * `to` is where the pointer is. The handle out follows it and the handle in is
 * its mirror, which is what makes the point smooth -- the curve arrives and
 * leaves along one line, so there is no corner in it.
 *
 * Broken instead when `alt` is held: the outgoing handle follows the pointer
 * and the incoming one stays where the last drag left it, which is how every
 * editor lets you put a curve into one side of a point and a straight or a
 * different curve into the other.
 */
export function draggedPoint(
  at: Vec2,
  to: Vec2,
  options: { alt?: boolean; shift?: boolean; keepIn?: Vec2 | null } = {},
): GlyphNode {
  const pulled = options.shift ? heldToAngle(at, to) : to;
  const mirror = { x: at.x - (pulled.x - at.x), y: at.y - (pulled.y - at.y) };
  return {
    point: at,
    handleIn: options.alt ? (options.keepIn ?? null) : mirror,
    handleOut: pulled,
    type: options.alt ? "corner" : "smooth",
  };
}

/**
 * Take the outgoing handle off the last point, so the next segment runs
 * straight out of a curve.
 *
 * Clicking the point you have just placed is how every editor says "the curve
 * ends here": the handle you pulled stays on the segment arriving, and the one
 * leaving goes. Without it a curve can only be followed by another curve.
 */
export function retracted(node: GlyphNode): GlyphNode {
  return { ...node, handleOut: null, type: node.handleIn ? "corner" : node.type };
}

/**
 * Where on a contour a point is, if the pointer is near enough to one.
 *
 * Walks the flattened curve rather than solving it: a cubic's nearest point to
 * an arbitrary position is a fifth-degree root-find, and a hundred samples of a
 * segment answers the same question to well inside the reach a pointer has.
 */
export function segmentAt(
  contour: Contour,
  at: Vec2,
  within: number,
  samples = 60,
): { index: number; t: number } | null {
  const { nodes, closed } = contour;
  const last = closed ? nodes.length : nodes.length - 1;
  let best: { index: number; t: number; distance: number } | null = null;

  for (let index = 0; index < last; index++) {
    const a = nodes[index];
    const b = nodes[(index + 1) % nodes.length];
    const c1 = a.handleOut ?? a.point;
    const c2 = b.handleIn ?? b.point;
    for (let step = 1; step < samples; step++) {
      const t = step / samples;
      const on = cubicAt(a.point, c1, c2, b.point, t);
      const distance = Math.hypot(on.x - at.x, on.y - at.y);
      if (!best || distance < best.distance) best = { index, t, distance };
    }
  }
  return best && best.distance <= within ? { index: best.index, t: best.t } : null;
}

/**
 * A point put on a segment, with the curve either side left exactly where it
 * was.
 *
 * De Casteljau rather than "add a point and re-guess the handles": splitting a
 * cubic at a parameter gives two cubics whose union is the original, to the
 * last decimal place. Anything else moves the outline while claiming to add to
 * it, which on a letter somebody has spaced is a change they did not ask for.
 */
export function withPointOn(contour: Contour, index: number, t: number): Contour {
  const nodes = contour.nodes;
  const a = nodes[index];
  const b = nodes[(index + 1) % nodes.length];
  if (!a || !b) return contour;

  const [left, right] = splitCubic(
    a.point,
    a.handleOut ?? a.point,
    b.handleIn ?? b.point,
    b.point,
    t,
  );
  const straight = !a.handleOut && !b.handleIn;

  const before: GlyphNode = { ...a, handleOut: straight ? null : left[1] };
  const made: GlyphNode = {
    point: left[3],
    handleIn: straight ? null : left[2],
    handleOut: straight ? null : right[1],
    type: straight ? "corner" : "smooth",
  };
  const after: GlyphNode = { ...b, handleIn: straight ? null : right[2] };

  const out = [...nodes];
  out[index] = before;
  out[(index + 1) % nodes.length] = after;
  out.splice(index + 1, 0, made);
  return { ...contour, nodes: out };
}

/** How closely a re-fit has to follow what it replaces, in font units. */
export const KEEPS_THE_SHAPE = 4;

/**
 * A contour with one point gone and the curve through its neighbours put back.
 *
 * Removing a node and leaving the rest alone is what this did, and the shape
 * jumps: the two segments the point joined become one straight line between
 * their far ends. Every editor a type designer has used re-fits instead, so
 * losing a point costs a little accuracy rather than the whole curve -- which
 * is the difference between an outline you can thin out and one you cannot.
 *
 * The fit is Schneider's, the same one the pencil runs a hand-drawn trail
 * through. It has been in this codebase since the quill and nothing that
 * already had an outline could reach it.
 */
export function withoutPoint(contour: Contour, index: number): Contour {
  const nodes = contour.nodes;
  if (nodes.length <= 2) return contour;
  const gone = nodes[index];
  if (!gone) return contour;

  const beforeIndex = (index - 1 + nodes.length) % nodes.length;
  const afterIndex = (index + 1) % nodes.length;
  // An open contour's ends have nothing on one side to re-fit through, so they
  // simply go.
  if (!contour.closed && (index === 0 || index === nodes.length - 1)) {
    return { ...contour, nodes: nodes.filter((_, at) => at !== index) };
  }

  const a = nodes[beforeIndex];
  const b = nodes[afterIndex];

  /*
   * The curve as it actually runs, sampled through the point being removed, and
   * fitted again without it. Sampled rather than reasoned about because the two
   * segments may be a line and a curve, or two curves of quite different
   * lengths, and the fit only wants to know where the outline goes.
   */
  const through: Vec2[] = [];
  const walk = (from: GlyphNode, to: GlyphNode) => {
    const c1 = from.handleOut ?? from.point;
    const c2 = to.handleIn ?? to.point;
    for (let step = 0; step <= 16; step++) {
      through.push(cubicAt(from.point, c1, c2, to.point, step / 16));
    }
  };
  walk(a, gone);
  walk(gone, b);

  /*
   * One cubic, whatever it costs in accuracy.
   *
   * Asked with a tolerance nothing can exceed, because the question here is not
   * "describe this run well" -- it is "describe this run with one segment,
   * since one point has just gone". Asked with a real tolerance the fit answers
   * with two curves for anything much bent, which is one point fewer than
   * nothing, and the first version then gave up and left the handles alone: a
   * quarter circle became a straight line, which is the very jump this exists
   * to prevent.
   */
  const fitted = fitCubics(through, Number.POSITIVE_INFINITY);
  const out = nodes.filter((_, at) => at !== index);
  const put = out.indexOf(a);
  const next = (put + 1) % out.length;

  const only = fitted.curves[0];
  if (only && put >= 0) {
    out[put] = { ...a, handleOut: only.c1 };
    out[next] = { ...b, handleIn: only.c2 };
  }
  return { ...contour, nodes: out };
}

/**
 * The same contour described in fewer points.
 *
 * Sampled and re-fitted whole, which is what "reduce the vertices" actually
 * means and what `Tidy up` never did: tidying drops points that are exactly
 * redundant, so a curve carried by forty points none of which is redundant
 * stays at forty. This asks instead how few points describe the same run to
 * within a tolerance, which on an imported or traced outline is usually a great
 * many fewer.
 *
 * Corners are kept and split the run. A fit that is allowed to round off a stem
 * end is a fit that has redrawn the letter, so every corner point becomes a
 * boundary the fit is not permitted to cross.
 */
export function simplified(contour: Contour, tolerance = KEEPS_THE_SHAPE): Contour {
  const nodes = contour.nodes;
  if (nodes.length < 4) return contour;

  const runs: number[][] = [];
  let run: number[] = [];
  const count = contour.closed ? nodes.length + 1 : nodes.length;
  for (let step = 0; step < count; step++) {
    const index = step % nodes.length;
    run.push(index);
    if (nodes[index].type === "corner" && run.length > 1) {
      runs.push(run);
      run = [index];
    }
  }
  if (run.length > 1) runs.push(run);
  if (runs.length === 0) return contour;

  /*
   * Rebuilt by carrying the arriving handle forward.
   *
   * A fitted cubic gives the handle leaving its start and the handle arriving
   * at its end, and that second one belongs to the *next* point -- which on the
   * last curve of a run is the first point of the run after it. Written as
   * "set it when the next node is made" the chain is one line and cannot lose a
   * link; the first version reset it to null at every run boundary, which threw
   * away one handle per corner and only failed to show because a straight run's
   * handles are collinear anyway.
   */
  const made: GlyphNode[] = [];
  let arriving: Vec2 | null = null;
  for (const one of runs) {
    const sampled: Vec2[] = [];
    for (let at = 0; at < one.length - 1; at++) {
      const from = nodes[one[at]];
      const to = nodes[one[at + 1]];
      const c1 = from.handleOut ?? from.point;
      const c2 = to.handleIn ?? to.point;
      const steps = 12;
      for (let step = 0; step < steps; step++) {
        sampled.push(cubicAt(from.point, c1, c2, to.point, step / steps));
      }
    }
    sampled.push(nodes[one[one.length - 1]].point);

    const fitted = fitCubics(sampled, tolerance);
    if (fitted.curves.length === 0) continue;

    const start = nodes[one[0]];
    for (const [at, curve] of fitted.curves.entries()) {
      made.push({
        point: curve.from,
        handleIn: arriving,
        handleOut: curve.c1,
        // The point a run starts from keeps whatever it was -- a corner stays a
        // corner, which is what keeps a stem end square.
        type: at === 0 ? start.type : "smooth",
      });
      arriving = curve.c2;
    }
  }
  if (made.length === 0) return contour;

  if (contour.closed) {
    // The last handle arrives at the point the contour started from.
    made[0].handleIn = arriving;
  } else {
    const last = nodes[nodes.length - 1];
    made.push({
      point: last.point,
      handleIn: arriving,
      handleOut: last.handleOut,
      type: last.type,
    });
  }

  /*
   * Never heavier than it arrived.
   *
   * At a tight tolerance the fit subdivides to hit it, and a four-point circle
   * asked to stay within a hundredth of a unit comes back as twenty-six points
   * -- a "simplify" that made the outline five times heavier, and told the
   * person twenty-two points had come out by reporting a negative. The honest
   * answer to "describe this in fewer points" when there are no fewer is the
   * drawing they already have.
   */
  if (made.length >= nodes.length) return contour;
  return made.length >= 2 ? { ...contour, nodes: made } : contour;
}

/** How many points a simplify would take out, for saying so before it runs. */
export function simplifyWouldRemove(contours: Contour[], tolerance = KEEPS_THE_SHAPE): number {
  let saved = 0;
  for (const contour of contours) {
    saved += contour.nodes.length - simplified(contour, tolerance).nodes.length;
  }
  return Math.max(0, saved);
}
