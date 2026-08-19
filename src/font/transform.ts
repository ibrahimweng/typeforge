/**
 * The parametric layer.
 *
 * Parameters are stored, never baked into the outlines. Every render and every
 * export re-evaluates them from the pristine curves, so a value set an hour ago
 * is still a live control rather than damage that has to be undone.
 *
 * Family values apply to every glyph; a glyph's own value wins where it sets
 * one. That is what makes it possible to round the whole typeface and then tell
 * a single letter to stay sharp.
 */

import {
  centroid,
  distance,
  isClockwise,
  normalize,
  sub,
} from "./geometry";
import { resolveComponents } from "./composite";
import { classifyContours } from "./outline";
import { shiftCrossbar, shiftShoulders } from "./anatomy";
import { pixelate } from "./pixel";
import { addSlabs } from "./slab";
import { DEFAULT_PARAMS, type Contour, type Glyph, type GlyphNode, type GlyphParams, type Typeface, type Vec2 } from "./types";

/** Merge family parameters with a glyph's overrides. */
export function effectiveParams(glyph: Glyph, typeface: Typeface): GlyphParams {
  return { ...DEFAULT_PARAMS, ...typeface.params, ...glyph.params };
}

export function paramsAreDefault(params: GlyphParams): boolean {
  return (
    params.cornerRadius === DEFAULT_PARAMS.cornerRadius &&
    params.weight === DEFAULT_PARAMS.weight &&
    params.width === DEFAULT_PARAMS.width &&
    params.slant === DEFAULT_PARAMS.slant &&
    params.xHeightScale === DEFAULT_PARAMS.xHeightScale &&
    params.counterScale === DEFAULT_PARAMS.counterScale &&
    params.tracking === DEFAULT_PARAMS.tracking &&
    params.pixelGrid === DEFAULT_PARAMS.pixelGrid &&
    params.slab === DEFAULT_PARAMS.slab &&
    params.crossbar === DEFAULT_PARAMS.crossbar &&
    params.shoulder === DEFAULT_PARAMS.shoulder
  );
}

/**
 * Apply the parameter stack to a glyph's outlines.
 *
 * Order matters. Shape-level changes come first, while the outline still means
 * what it did when it was drawn, and the whole-glyph affine transforms come
 * last so they act on the finished shape.
 */
export function resolveGlyphContours(glyph: Glyph, typeface: Typeface): Contour[] {
  // Components first: a composite draws nothing of its own, so its outline is
  // whatever its parts contribute. Parameters then apply to the finished shape,
  // which keeps a family-wide change from being applied twice to a component.
  const composed = resolveComponents(glyph, typeface);

  const params = effectiveParams(glyph, typeface);
  if (paramsAreDefault(params)) return composed;

  let contours = composed.map(cloneContour);
  // The named parts move first, while the letter is still as it was drawn.
  // Weight and width then apply to the adjusted shape rather than the other
  // way round, which is the order a designer works in.
  if (params.crossbar !== 0) contours = shiftCrossbar(contours, params.crossbar);
  if (params.shoulder !== 0) contours = shiftShoulders(contours, params.shoulder);
  /*
   * Slabs go on while the letter is still as drawn, and are then carried
   * through everything else with it.
   *
   * Adding them last meant deciding where the stroke ends were on a shape the
   * other controls had already moved, and that decision is not stable: sweeping
   * the weight slider took n and m from three stroke ends to none, and the
   * x-height slider took a slab off t. Serifs appeared and vanished while
   * dragging something else entirely.
   *
   * It was wrong the other way round as well. A slab pasted on at the end kept
   * its size no matter how heavy the letter became, so a bold cut had the
   * serifs of a light one. Put on first, they thicken with the stems, stretch
   * with the width and lean with the slant, which is what they should do.
   */
  if (params.slab > 0) {
    contours = addSlabs(contours, {
      projection: params.slab,
      // A slab reaches further across the stroke than back along it; much
      // thicker and it reads as a box on the end rather than a serif.
      thickness: params.slab * 0.55,
      maxWidth: typeface.unitsPerEm * 0.35,
    });
  }
  if (params.counterScale !== 1) contours = applyCounterScale(contours, params.counterScale);
  if (params.weight !== 0) {
    // Whether a contour is ink or a hole decides which way it has to move, and
    // that cannot be read off its winding: DejaVu winds the outer contour of I
    // clockwise and the outer contour of o the other way.
    const outer = classifyContours(contours);
    contours = contours.map((contour, index) =>
      applyWeight(contour, params.weight, outer[index]),
    );
  }
  if (params.cornerRadius > 0)
    contours = contours.map((contour) => applyCornerRadius(contour, params.cornerRadius));
  if (params.xHeightScale !== 1)
    contours = contours.map((contour) => applyVerticalScale(contour, params.xHeightScale));
  if (params.width !== 1)
    contours = contours.map((contour) => applyHorizontalScale(contour, params.width));
  if (params.slant !== 0) contours = contours.map((contour) => applySlant(contour, params.slant));
  // Quantising comes last. It has to see the letter as it will finally be
  // drawn, or a stem that weight or width moved would land on a different cell
  // than the one the finished shape sits on.
  if (params.pixelGrid > 0) {
    contours = pixelate(contours, {
      pixelsPerEm: params.pixelGrid,
      unitsPerEm: typeface.unitsPerEm,
    });
  }
  return contours;
}

/** Advance width after width scaling and tracking. */
export function resolveAdvanceWidth(glyph: Glyph, typeface: Typeface): number {
  const params = effectiveParams(glyph, typeface);
  return Math.max(0, glyph.advanceWidth * params.width + params.tracking * 2);
}

function cloneContour(contour: Contour): Contour {
  return {
    closed: contour.closed,
    nodes: contour.nodes.map((node) => ({
      point: { ...node.point },
      handleIn: node.handleIn ? { ...node.handleIn } : null,
      handleOut: node.handleOut ? { ...node.handleOut } : null,
      type: node.type,
    })),
  };
}

/** Apply a function to a node's point and both of its handles. */
function mapNode(node: GlyphNode, fn: (point: Vec2) => Vec2): GlyphNode {
  return {
    point: fn(node.point),
    handleIn: node.handleIn ? fn(node.handleIn) : null,
    handleOut: node.handleOut ? fn(node.handleOut) : null,
    type: node.type,
  };
}

function mapContour(contour: Contour, fn: (point: Vec2) => Vec2): Contour {
  return { closed: contour.closed, nodes: contour.nodes.map((node) => mapNode(node, fn)) };
}

/** Horizontal scale about the origin. Narrows or widens the letterform. */
function applyHorizontalScale(contour: Contour, factor: number): Contour {
  return mapContour(contour, (point) => ({ x: point.x * factor, y: point.y }));
}

/**
 * Vertical scale of everything above the baseline, which is how x-height and
 * cap-height are adjusted. Descenders sit below the baseline and are left alone.
 */
function applyVerticalScale(contour: Contour, factor: number): Contour {
  return mapContour(contour, (point) => ({
    x: point.x,
    y: point.y > 0 ? point.y * factor : point.y,
  }));
}

/** Shear about the baseline, the transform that makes an oblique. */
function applySlant(contour: Contour, degrees: number): Contour {
  const shear = Math.tan((degrees * Math.PI) / 180);
  return mapContour(contour, (point) => ({ x: point.x + point.y * shear, y: point.y }));
}

/**
 * Emboldening: push each point along the outline's outward normal.
 *
 * Direction comes from winding. An outer contour grows and a counter shrinks,
 * and both of those make the letter look heavier. This is an approximation
 * rather than a true outline offset, which is what keeps it fast enough to run
 * on every frame while a slider moves; at the magnitudes a designer uses for
 * weight it holds up.
 */
function applyWeight(contour: Contour, amount: number, isOuter: boolean): Contour {
  const nodes = contour.nodes;
  if (nodes.length < 2) return contour;
  /*
   * Which way this contour has to move to add weight.
   *
   * The offset below is built as (tangent.y, -tangent.x), which leaves a
   * counter-clockwise contour and enters a clockwise one, so a clockwise
   * contour has to be negated. That much was simply inverted before, and every
   * letter whose outer contour is wound clockwise -- which is the TrueType
   * convention -- got thinner as the weight went up. On DejaVu the stem of an n
   * measured 184 units at rest, 315 at weight -80 and 37 at weight +80, very
   * nearly disappearing under a control labelled "positive is bolder".
   *
   * A hole then has to go the other way again: thickening the stroke around a
   * counter means closing the counter, not opening it with the outline. Fixing
   * only the winding left o unchanged at 206, 205, 204 units across the whole
   * range, because its counter was growing exactly as fast as its outside.
   */
  const outward = isClockwise(contour) ? -1 : 1;
  const sign = isOuter ? outward : -outward;

  const moved = nodes.map((node, index) => {
    const previous = nodes[(index - 1 + nodes.length) % nodes.length];
    const next = nodes[(index + 1) % nodes.length];

    // Average the directions either side of the node so the normal follows the
    // outline rather than one arbitrary segment.
    const incoming = normalize(sub(node.point, previous.point));
    const outgoing = normalize(sub(next.point, node.point));
    const tangent = normalize({ x: incoming.x + outgoing.x, y: incoming.y + outgoing.y });
    if (tangent.x === 0 && tangent.y === 0) return node;

    const offset = { x: tangent.y * amount * sign, y: -tangent.x * amount * sign };
    return mapNode(node, (point) => ({ x: point.x + offset.x, y: point.y + offset.y }));
  });

  return { closed: contour.closed, nodes: moved };
}

/**
 * Counters are the enclosed white shapes inside letters such as o, e and a.
 * Scaling them about their own centre opens or closes those spaces without
 * moving the outside of the letter, which is the "middle space" control.
 */
function applyCounterScale(contours: Contour[], factor: number): Contour[] {
  if (contours.length < 2) return contours;

  /*
   * A contour is a counter when it is enclosed by an odd number of others.
   *
   * This used to ask only whether a contour's centroid fell inside some other
   * contour, which cannot tell a counter from the shape around it: in an o the
   * two contours are concentric, so the outer ring's centre sits inside the
   * counter just as surely as the counter's centre sits inside the ring. Both
   * were therefore scaled, and opening the counter of an o quietly scaled the
   * whole letter instead -- leaving the counter exactly the same size relative
   * to the letter, which is the one thing the control exists to change.
   */
  const outer = classifyContours(contours);
  return contours.map((contour, index) => {
    if (outer[index]) return contour;
    const middle = centroid(contour);
    return mapContour(contour, (point) => ({
      x: middle.x + (point.x - middle.x) * factor,
      y: middle.y + (point.y - middle.y) * factor,
    }));
  });
}

/**
 * Round sharp corners.
 *
 * A corner between two straight segments is replaced by two nodes set back
 * along each segment and joined by a curve. Only genuine corners are touched:
 * a node already sitting on a curve, or one whose segments are nearly in line,
 * is left as it is. The radius is clamped so that adjacent corners on a short
 * segment cannot overrun each other.
 */
function applyCornerRadius(contour: Contour, radius: number): Contour {
  const nodes = contour.nodes;
  if (nodes.length < 3 || radius <= 0) return contour;

  // Circular arcs approximated by cubics need their handles at this fraction
  // of the distance to the original corner.
  const HANDLE_RATIO = 0.5523;
  const out: GlyphNode[] = [];

  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    const previous = nodes[(index - 1 + nodes.length) % nodes.length];
    const next = nodes[(index + 1) % nodes.length];

    // Both sides must be straight, otherwise this is part of a curve already.
    const straightBefore = !node.handleIn && !previous.handleOut;
    const straightAfter = !node.handleOut && !next.handleIn;
    if (!straightBefore || !straightAfter) {
      out.push(node);
      continue;
    }

    const incoming = normalize(sub(node.point, previous.point));
    const outgoing = normalize(sub(next.point, node.point));

    // A node that barely turns is not a corner worth rounding.
    const turn = incoming.x * outgoing.y - incoming.y * outgoing.x;
    const alignment = incoming.x * outgoing.x + incoming.y * outgoing.y;
    if (Math.abs(turn) < 0.02 && alignment > 0) {
      out.push(node);
      continue;
    }

    // Never take more than half of either neighbouring segment.
    const limit = Math.min(
      distance(node.point, previous.point) / 2,
      distance(node.point, next.point) / 2,
    );
    const r = Math.min(radius, limit);
    if (r < 1) {
      out.push(node);
      continue;
    }

    const start: Vec2 = { x: node.point.x - incoming.x * r, y: node.point.y - incoming.y * r };
    const end: Vec2 = { x: node.point.x + outgoing.x * r, y: node.point.y + outgoing.y * r };

    out.push({
      point: start,
      handleIn: null,
      handleOut: {
        x: start.x + (node.point.x - start.x) * HANDLE_RATIO,
        y: start.y + (node.point.y - start.y) * HANDLE_RATIO,
      },
      type: "tangent",
    });
    out.push({
      point: end,
      handleIn: {
        x: end.x + (node.point.x - end.x) * HANDLE_RATIO,
        y: end.y + (node.point.y - end.y) * HANDLE_RATIO,
      },
      handleOut: null,
      type: "tangent",
    });
  }

  return { closed: contour.closed, nodes: out };
}
