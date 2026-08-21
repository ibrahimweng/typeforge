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
  contourArea,
  contourSegments,
  cubicAt,
  cubicDerivativeAt,
  distance,
  flattenContour,
  isClockwise,
  lerp,
  normalize,
  rayHitDistance,
  sub,
  type Segment,
} from "./geometry";
import { resolveComponents } from "./composite";
import { classifyContours, contoursIntersect } from "./outline";
import { shiftCrossbar, shiftShoulders } from "./anatomy";
import { pixelate } from "./pixel";
import { addSlabs } from "./slab";
import { anyCut, type Cuts } from "./cuts";
import { cutInk, type CutScale } from "@/forge/cut";
import { measuredStem } from "./stem";
import { DEFAULT_PARAMS, type Contour, type Glyph, type GlyphNode, type GlyphParams, type Typeface, type Vec2 } from "./types";

/** Merge family parameters with a glyph's overrides. */
export function effectiveParams(glyph: Glyph, typeface: Typeface): GlyphParams {
  return { ...DEFAULT_PARAMS, ...typeface.params, ...glyph.params };
}

/**
 * How this glyph is cut: its own way if it says so, the font's way otherwise.
 *
 * An exception rather than an override, unlike every numeric parameter above.
 * Half a font's cuts merged with half a letter's own is not a description
 * anybody wrote, so a letter either goes along with the font or is cut its
 * own way.
 */
export function effectiveCuts(glyph: Glyph, typeface: Typeface): Cuts | undefined {
  return glyph.cuts ?? typeface.cuts;
}

/** Whether anything anywhere in the font is switched on. */
export function anythingCut(typeface: Typeface): boolean {
  if (anyCut(typeface.cuts)) return true;
  return typeface.glyphs.some((glyph) => anyCut(glyph.cuts));
}

/**
 * The stem of the font, measured once and kept.
 *
 * Held against the typeface object rather than recomputed, because every glyph
 * being cut asks the same question and the answer is a property of the font.
 * A new typeface object -- which is what every edit produces here -- measures
 * again, which is what makes the stem follow a font the weight slider has
 * made heavier.
 */
const stems = new WeakMap<Typeface, number>();

export function cutScaleOf(typeface: Typeface): CutScale {
  let stem = stems.get(typeface);
  if (stem === undefined) {
    stem = measuredStem(
      typeface.glyphs.map((glyph) => ({ name: glyph.name, contours: glyph.contours })),
      { xHeight: typeface.metrics.xHeight, unitsPerEm: typeface.unitsPerEm },
    );
    stems.set(typeface, stem);
  }
  return {
    stem,
    ascender: typeface.metrics.ascender,
    descender: typeface.metrics.descender,
    xHeight: typeface.metrics.xHeight,
  };
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
  const cuts = effectiveCuts(glyph, typeface);
  if (paramsAreDefault(params) && !anyCut(cuts)) return composed;

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
    // The letter as it stands, for measuring how much room each point has.
    const obstacles = contours.map((contour) => flattenContour(contour, 8));
    const floor = typeface.unitsPerEm * MIN_STROKE;
    contours = contours.map((contour, index) =>
      applyWeight(contour, params.weight, outer[index], obstacles, floor),
    );
  }
  if (params.cornerRadius > 0)
    contours = contours.map((contour) => applyCornerRadius(contour, params.cornerRadius));
  /*
   * The cuts go on once the letter is the shape it is going to be, and before
   * anything turns or squashes it.
   *
   * After the shape controls, because a slot is a third of a stem wide and the
   * weight slider is what decides how wide a stem is -- cut first, the same
   * setting would be a nick on the Black and a severed letter on the Light.
   * Before the slant, because a band cut square and then sheared leans with
   * the letter, which is what a cut through a leaning letter looks like; cut
   * after the shear it would stand upright in a leaning face. And before the
   * pixel grid, which has to see the letter exactly as it will finally be
   * drawn or it quantises a shape that no longer exists.
   *
   * Nesting rather than winding, because these outlines came off a font file
   * or a pen tool and nothing here has promised which way a counter is wound.
   */
  if (cuts && anyCut(cuts)) {
    contours = cutInk(contours, [], cutScaleOf(typeface), cuts, "nesting").contours;
  }
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
/**
 * The thinnest a stroke is allowed to become, as a fraction of the em.
 *
 * Somewhere for the ink to still be, rather than a mathematically valid
 * nothing.
 */
const MIN_STROKE = 0.012;

function applyWeight(
  contour: Contour,
  amount: number,
  isOuter: boolean,
  obstacles: Vec2[][],
  floor: number,
): Contour {
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

  // Where each point is going, and the furthest it may go before it runs into
  // something. Both are worked out for the whole contour before anything moves,
  // because the second pass below has to compare a point's allowance with its
  // neighbours'.
  const travels: Array<Vec2 | null> = [];
  const limits: number[] = [];
  const segments = contourSegments(contour);
  if (segments.length !== nodes.length) return contour;

  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    const before = segments[(index - 1 + segments.length) % segments.length];
    const after = segments[index];

    /*
     * Which way this point faces.
     *
     * Taken from the curves either side of it rather than from the straight
     * lines to its neighbours. On the bottom of an a's bowl the chord to the
     * next point runs nowhere near the direction the outline is actually
     * travelling, and a normal built from it leans back into the letter --
     * which both pushed the point the wrong way and made the measurement below
     * read the letter's own edge as an obstacle two units away.
     */
    const tangent = normalize({
      x: segmentDirection(before, 1).x + segmentDirection(after, 0).x,
      y: segmentDirection(before, 1).y + segmentDirection(after, 0).y,
    });
    if (tangent.x === 0 && tangent.y === 0) {
      travels.push(null);
      limits.push(0);
      continue;
    }
    const travel = facing(tangent, sign, amount);

    /*
     * How far this point may actually travel.
     *
     * Offsetting every point by the same amount is fine until the space ahead
     * of it runs out. Thinning past half a stroke's width sends its two sides
     * through each other, which on DejaVu happened to seven of ten letters
     * tested at the light end of the slider -- n, o, e, a, s, g and m all
     * crossed themselves with stems down to twenty units. The same thing
     * happens to white space at the heavy end: the aperture of an s closed and
     * inverted, two points ninety units apart ending up on top of each other.
     *
     * So each point asks how much room lies ahead of it before it meets the
     * outline again, whether that room is ink or paper. Both walls close at
     * once, so half the gap is the most it may take, less the width that has to
     * survive. Points in the tight places stop while the rest carry on, which
     * is what keeps the letter looking like itself instead of pinching shut all
     * over.
     *
     * The question is asked partway along the neighbouring curves as well as at
     * the point itself, because a gap is usually at its narrowest between two
     * points rather than on one: asking only at the points let the middle of a
     * curve close while its ends still had room, and o, a and g went on
     * crossing themselves with stems of 36 units against a floor of 25. Each
     * sample uses the outline's direction where it stands rather than the
     * node's, or the ray sets off at a slant and grazes the curve it started
     * from -- which read as a wall three units away and froze eleven of the
     * twenty points on a's outer contour while the six beside them moved the
     * full amount, tearing the outline between them.
     */
    let room = rayHitDistance(obstacles, node.point, travel);
    for (const [segment, along] of SAMPLES) {
      const at = segment === "before" ? before : after;
      const local = segmentDirection(at, along);
      if (local.x === 0 && local.y === 0) continue;
      room = Math.min(
        room,
        rayHitDistance(obstacles, pointOnSegment(at, along), facing(local, sign, amount)),
      );
    }

    const allowed = Number.isFinite(room) ? Math.max(0, (room - floor) / 2) : Infinity;
    travels.push(travel);
    limits.push(Math.min(Math.abs(amount), allowed));
  }

  const build = (scaleAt: (index: number) => number): Contour => ({
    closed: contour.closed,
    nodes: nodes.map((node, index) => {
      const travel = travels[index];
      if (!travel) return node;
      const magnitude = limits[index] * scaleAt(index);
      if (magnitude === 0) return node;
      const offset = { x: travel.x * magnitude, y: travel.y * magnitude };
      return mapNode(node, (point) => ({ x: point.x + offset.x, y: point.y + offset.y }));
    }),
  });

  const facingBefore = Math.sign(contourArea(contour));
  const intact = (trial: Contour): boolean =>
    // Turned inside out. A superscript minus is only forty units thick, and
    // taking eighty off it did not cross anything -- it simply came out the
    // other side, wound the wrong way, which makes ink into a hole.
    Math.sign(contourArea(trial)) === facingBefore && !contoursIntersect([trial]);

  const full = build(() => 1);
  if (intact(full)) return full;
  // The letter already crossed itself before anything moved -- some fonts ship
  // outlines like that -- so there is nothing here to preserve.
  if (contoursIntersect([contour])) return full;
  return backOff(build, intact, nodes.length, contour);
}

/**
 * Where the clearance is measured, besides at the node itself: partway along
 * the curve arriving and partway along the one leaving.
 */
const SAMPLES: Array<[side: "before" | "after", t: number]> = [
  ["before", 0.5],
  ["before", 0.75],
  ["after", 0.25],
  ["after", 0.5],
];

/** A point partway along a drawn segment, straight or curved. */
function pointOnSegment(segment: Segment, t: number): Vec2 {
  return segment.kind === "line"
    ? lerp(segment.from, segment.to, t)
    : cubicAt(segment.from, segment.c1, segment.c2, segment.to, t);
}

/**
 * Which way the outline is travelling partway along a segment.
 *
 * A cubic's derivative vanishes at an end whose handle sits on its own point,
 * which is how a straight run is written; the chord stands in for it there.
 */
function segmentDirection(segment: Segment, t: number): Vec2 {
  if (segment.kind === "line") return normalize(sub(segment.to, segment.from));
  const derivative = cubicDerivativeAt(segment.from, segment.c1, segment.c2, segment.to, t);
  const direction = normalize(derivative);
  if (direction.x !== 0 || direction.y !== 0) return direction;
  return normalize(sub(segment.to, segment.from));
}

/** The way ink moves for a given heading along the outline. */
function facing(tangent: Vec2, sign: number, amount: number): Vec2 {
  const direction = { x: tangent.y * sign, y: -tangent.x * sign };
  return amount >= 0 ? direction : { x: -direction.x, y: -direction.y };
}

/** How finely the retreat below is searched. Five steps resolve a thirtieth. */
const BACK_OFF_STEPS = 5;

/**
 * Retreat until the outline stops crossing itself, then let go again where it
 * can.
 *
 * The measurement above stops a point before it reaches whatever is in front of
 * it, and that covers the ordinary case -- a stem closing, a counter closing --
 * but it cannot cover every shape, because from a single point a spike and a
 * notch look the same. Both are two walls a short way apart; on a spike they
 * must be allowed to move apart and on a notch they must not be allowed to
 * meet. Told apart wrongly, y's tail folded over itself at full weight and so
 * did the trap where an a's bowl meets its stem.
 *
 * So the result is checked rather than predicted. The whole movement is scaled
 * back until the outline is sound, which is a guarantee instead of an estimate:
 * a letter may run out of weight before the slider runs out of travel, but it
 * cannot turn inside out.
 *
 * Holding the whole contour back for one bad corner costs too much, though --
 * it left a's stem at 241 units while every other letter reached 325, so the
 * one letter stopped getting bolder while the rest carried on. Each point is
 * therefore offered its full movement back afterwards and keeps it if the
 * outline survives, so the retreat ends up confined to the few points that
 * caused it. Only a contour that actually failed pays for any of this.
 */
function backOff(
  build: (scaleAt: (index: number) => number) => Contour,
  intact: (trial: Contour) => boolean,
  count: number,
  original: Contour,
): Contour {
  let safe = 0;
  let low = 0;
  let high = 1;
  for (let step = 0; step < BACK_OFF_STEPS; step++) {
    const middle = (low + high) / 2;
    if (intact(build(() => middle))) {
      low = middle;
      safe = middle;
    } else {
      high = middle;
    }
  }
  if (safe === 0) return original;

  const scales = new Array<number>(count).fill(safe);
  const at = (index: number): number => scales[index];
  for (let index = 0; index < count; index++) {
    scales[index] = 1;
    if (!intact(build(at))) scales[index] = safe;
  }
  return build(at);
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
