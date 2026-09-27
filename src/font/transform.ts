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
  splitCubic,
  cubicDerivativeAt,
  distance,
  flattenContour,
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
import { applyWeight, SIDEWAYS } from "./embolden";
import { anyCast, type Cast } from "./cast";
import { anyCut, type Cuts } from "./cuts";
import type { CutScale } from "@/forge/cut";
import { shapedInk } from "@/forge/layers";
import { measuredStem } from "./stem";
import {
  DEFAULT_PARAMS,
  type Contour,
  type Glyph,
  type GlyphNode,
  type GlyphParams,
  type Typeface,
  type Vec2,
} from "./types";

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

/** And the same for the cast, on the same terms and for the same reason. */
export function effectiveCast(glyph: Glyph, typeface: Typeface): Cast | undefined {
  return glyph.cast ?? typeface.cast;
}

/** Whether anything anywhere in the font is switched on. */
export function anythingCut(typeface: Typeface): boolean {
  if (anyCut(typeface.cuts) || anyCast(typeface.cast)) return true;
  return typeface.glyphs.some((glyph) => anyCut(glyph.cuts) || anyCast(glyph.cast));
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
 * Whether anything in the stack would change this letter from how it was drawn.
 *
 * Asked as a question, because the answer used to be inferred from whether
 * `resolveGlyphContours` handed back the same array it was given -- which is
 * true of a letter drawn from its own outlines and never true of one built from
 * parts, since composing them makes a new array every time. So every composite
 * looked reshaped whether or not a single parameter had moved. Anywhere that
 * wants to know should ask here rather than compare.
 */
export function isReshaped(glyph: Glyph, typeface: Typeface): boolean {
  return (
    !paramsAreDefault(effectiveParams(glyph, typeface)) ||
    anyCut(effectiveCuts(glyph, typeface)) ||
    anyCast(effectiveCast(glyph, typeface))
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
  if (!isReshaped(glyph, typeface)) return composed;

  const params = effectiveParams(glyph, typeface);
  const cuts = effectiveCuts(glyph, typeface);
  const cast = effectiveCast(glyph, typeface);

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
      weight: params.weight,
    });
  }
  if (params.counterScale !== 1)
    contours = applyCounterScale(contours, params.counterScale, typeface.unitsPerEm * MIN_STROKE);
  if (params.weight !== 0) {
    // Whether a contour is ink or a hole decides which way it has to move, and
    // that cannot be read off its winding: DejaVu winds the outer contour of I
    // clockwise and the outer contour of o the other way.
    const outer = classifyContours(contours);
    // The letter as it stands, for measuring how much room each point has.
    const around = {
      obstacles: contours.map((contour) => flattenContour(contour, 12)),
      roles: outer,
      unitsPerEm: typeface.unitsPerEm,
    };
    contours = contours.map((contour, index) => applyWeight(contour, params.weight, index, around));
    /*
     * And the letter moved over by the weight, so it keeps its sidebearings.
     *
     * Adding weight grows a letter outwards on both sides, into the space
     * between it and its neighbours. Left there, every side bearing lost the
     * weight: at the heavy end of Geist the H ran into the a and the f into the
     * o, and a paragraph set in it read as letters pressed together rather
     * than as a bolder face. The advance grows by twice the weight to match --
     * see `resolveAdvanceWidth` -- which is how a bold cut is spaced.
     */
    const shift = params.weight;
    contours = contours.map((contour) =>
      mapContour(contour, (point) => ({ x: point.x + shift, y: point.y })),
    );
  }
  if (params.cornerRadius > 0) {
    const outer = classifyContours(contours);
    contours = contours.map((contour, index) =>
      applyCornerRadius(contour, params.cornerRadius, outer[index]),
    );
  }
  /*
   * The cuts and the cast go on once the letter is the shape it is going to
   * be, and before anything turns or squashes it.
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
  if (anyCut(cuts) || anyCast(cast)) {
    contours = shapedInk(contours, [], cutScaleOf(typeface), cuts, cast, "nesting").contours;
  }
  if (params.xHeightScale !== 1)
    contours = contours.map((contour) => applyVerticalScale(contour, params.xHeightScale));
  if (params.width !== 1) {
    contours = contours.map((contour) => applyHorizontalScale(contour, params.width));
    /*
     * And the strokes a change of width thinned or thickened, put back.
     *
     * Scaling sideways scales a stem with the letter while a bar lying across
     * it keeps its thickness, so a condensed H had stems thinner than its
     * crossbar and a widened one had stems like slabs: the width control made
     * every letter uneven. What a condensed cut actually has is the same
     * strokes in less room. So each side of every stroke is pushed back out by
     * however much the scaling took off it -- sideways only, in proportion to
     * how much that bit of outline faces sideways -- which gives a stem back
     * its whole width and leaves a bar alone.
     */
    const give = widthGive(typeface, params);
    if (Math.abs(give) > 0.5) {
      const outer = classifyContours(contours);
      const around = {
        obstacles: contours.map((contour) => flattenContour(contour, 12)),
        roles: outer,
        unitsPerEm: typeface.unitsPerEm,
      };
      contours = contours.map((contour, index) =>
        applyWeight(contour, give, index, around, SIDEWAYS),
      );
      contours = contours.map((contour) =>
        mapContour(contour, (point) => ({ x: point.x + give, y: point.y })),
      );
    }
  }
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

/**
 * Advance width after weight, width scaling and tracking.
 *
 * Weight widens the letter by what it adds on each side, so the space between
 * letters stays what it was; `resolveGlyphContours` moves the ink over by the
 * same amount. This is also the advance a font file is written with -- the
 * exporter used to write the drawn advance, so a font condensed to eight
 * tenths in the app kept its full widths in the file and set loose, and a
 * widened one set with its letters overlapping.
 */
export function resolveAdvanceWidth(glyph: Glyph, typeface: Typeface): number {
  const params = effectiveParams(glyph, typeface);
  return Math.max(
    0,
    (glyph.advanceWidth + params.weight * 2) * params.width +
      params.tracking * 2 +
      widthGive(typeface, params) * 2,
  );
}

/**
 * How far each side of a stroke is pushed back out after the width scaling:
 * half of what the scaling took off the font's stem, which is the stem as the
 * weight left it. Negative when the letter was widened.
 */
function widthGive(typeface: Typeface, params: GlyphParams): number {
  if (params.width === 1) return 0;
  const stem = cutScaleOf(typeface).stem + params.weight * 2;
  return (stem * (1 - params.width)) / 2;
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
 * The thinnest a stroke is allowed to become, as a fraction of the em.
 *
 * Somewhere for the ink to still be, rather than a mathematically valid
 * nothing.
 */
const MIN_STROKE = 0.012;

function scaleVec(vector: Vec2, by: number): Vec2 {
  return { x: vector.x * by, y: vector.y * by };
}

/** A point partway along a drawn segment, straight or curved. */
function pointOnSegment(segment: Segment, t: number): Vec2 {
  return segment.kind === "line"
    ? lerp(segment.from, segment.to, t)
    : cubicAt(segment.from, segment.c1, segment.c2, segment.to, t);
}

/**
 * Which way the outline is travelling partway along a segment. A cubic's
 * derivative vanishes at an end whose handle sits on its own point, which is
 * how a straight run is written; the chord stands in for it there.
 */
function segmentDirection(segment: Segment, t: number): Vec2 {
  if (segment.kind === "line") return normalize(sub(segment.to, segment.from));
  const derivative = cubicDerivativeAt(segment.from, segment.c1, segment.c2, segment.to, t);
  const direction = normalize(derivative);
  if (direction.x !== 0 || direction.y !== 0) return direction;
  return normalize(sub(segment.to, segment.from));
}

/** How finely the retreat below is searched. Six steps resolve a sixty-fourth. */
const BACK_OFF_STEPS = 6;

/**
 * Counters are the enclosed white shapes inside letters such as o, e and a.
 * Scaling them about their own centre opens or closes those spaces without
 * moving the outside of the letter, which is the "middle space" control.
 *
 * Only the enclosed counters. The open ones -- the space inside n, h, u, the
 * aperture of c -- have no contour of their own to scale, and reaching them
 * would mean moving the strokes that bound them, which is a different control.
 */
function applyCounterScale(contours: Contour[], factor: number, floor: number): Contour[] {
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
  const walls = contours.map((contour) => flattenContour(contour, 8));
  const amount = Math.abs(factor - 1);
  const opening = factor > 1;

  /*
   * How far a wall of ink may give way to the counter beside it, or grow into
   * it, for a movement that would like to be `wanted`.
   *
   * Scaling about the centre moves every point by its distance from the
   * centre, which has nothing to do with how much ink lies beyond it. A big
   * counter moved a long way and a small one hardly at all, whatever the
   * strokes around them were like. At 1.3 the counters of Lora's o, b, B, g
   * and 8 went straight through their hairlines and out the other side --
   * white gaps across the stroke -- and Geist's round letters came out a third
   * of the weight of its straight ones. At 0.7 the same distances went the
   * other way and every round letter turned bold beside an H that, having no
   * counter, had not changed at all.
   *
   * So the movement is held to a share of the wall it moves into: about as
   * much of the wall as the setting is away from 1, so at 1.3 a wall keeps
   * roughly two thirds of itself and at 0.7 gains roughly a third. A wall is
   * ink, and ink is what an H is made of too; a limit in proportion to the
   * wall rather than to the counter is what keeps the round letters in the
   * same colour as the straight ones, as near as a control that only touches
   * counters can. Opening, the wall is also never taken below the stroke floor
   * weight keeps to, so nothing tears whatever the numbers.
   *
   * Eased rather than cut off. Where there is plenty of wall -- a counter
   * small for its strokes, or a gentle setting -- the plain scaling comes
   * through untouched, so a counter keeps its drawn proportions; past a knee
   * the movement bends over smoothly towards the limit and never reaches it,
   * so the slider never stops dead and nothing jumps between two settings a
   * step apart.
   */
  const allowed = (wanted: number, wall: number): number => {
    if (wanted <= 0 || !Number.isFinite(wall)) return wanted;
    let limit = COUNTER_REACH * amount * wall;
    if (opening) limit = Math.min(limit, wall - floor);
    if (limit <= 0) return 0;
    const knee = limit * COUNTER_KNEE;
    if (wanted <= knee) return wanted;
    const rest = limit - knee;
    return limit - (rest * rest) / (wanted - knee + rest);
  };

  return contours.map((contour, index) => {
    if (outer[index]) return contour;
    const segments = contourSegments(contour);
    if (segments.length === 0) return contour;
    const middle = centroid(contour);
    /*
     * How much wall lies ahead of a point, going one way.
     *
     * Up to the outside of the letter, or halfway to the next counter. The bar
     * across the middle of a B and the waist of an 8 are walls two counters
     * share, and both of them move into it at once; each measuring the whole
     * bar and taking its share of that took the bar down to a thread between
     * them. Half is each counter's own side of it.
     */
    const inks = walls.filter((_, which) => which !== index && outer[which]);
    const holes = walls.filter((_, which) => which !== index && !outer[which]);
    const wallAhead = (from: Vec2, heading: Vec2): number =>
      Math.min(rayHitDistance(inks, from, heading), rayHitDistance(holes, from, heading) / 2);
    const samples: Vec2[] = [];
    for (const segment of segments) {
      for (const t of [0, 0.25, 0.5, 0.75]) samples.push(pointOnSegment(segment, t));
    }

    /*
     * Each side of the counter separately, and each axis on its own.
     *
     * One scale for each of the four sides -- left, right, below and above the
     * centre -- rather than one for the whole counter or one for every point.
     * One for the whole counter let its thinnest wall decide for all of it:
     * Lora's o, whose hairlines are a third of its sides, hardly opened at all.
     * One for every point opened each part of a counter by what its own wall
     * could spare, and the straight edges of B, R and 4 leaned over, because
     * the two ends of an edge had different walls behind them. Four sides,
     * each moved along its own axis, keep a flat edge flat and square -- a
     * horizontal edge only ever moves up or down, and all of it by the same
     * amount -- while a heavy side still gives more than a hairline.
     *
     * Each side is asked at every sample on its half of the counter, looking
     * straight out along the axis it moves on, and takes the tightest answer.
     */
    const sides = { left: 1, right: 1, below: 1, above: 1 };
    for (const at of samples) {
      const dx = at.x - middle.x;
      const dy = at.y - middle.y;
      if (dx !== 0) {
        const wanted = amount * Math.abs(dx);
        const wall = wallAhead(at, { x: Math.sign(dx), y: 0 });
        const key = dx > 0 ? "right" : "left";
        sides[key] = Math.min(sides[key], allowed(wanted, wall) / wanted);
      }
      if (dy !== 0) {
        const wanted = amount * Math.abs(dy);
        const wall = wallAhead(at, { x: 0, y: Math.sign(dy) });
        const key = dy > 0 ? "above" : "below";
        sides[key] = Math.min(sides[key], allowed(wanted, wall) / wanted);
      }
    }

    const scaleOf = (share: number): number => 1 + (factor - 1) * share;
    const place = (point: Vec2, by: number): Vec2 => {
      const dx = point.x - middle.x;
      const dy = point.y - middle.y;
      const across = scaleOf((dx > 0 ? sides.right : sides.left) * by);
      const up = scaleOf((dy > 0 ? sides.above : sides.below) * by);
      return { x: middle.x + dx * across, y: middle.y + dy * up };
    };

    /*
     * Then the diagonals. A wall can be thinner on the slant than straight
     * out along either axis -- the stress of a humanist o runs at an angle --
     * and a point on the shoulder of a counter moves on the slant. Where one
     * would go through more wall than it may, the two sides it belongs to are
     * both drawn back until it does not.
     */
    for (let pass = 0; pass < 2; pass++) {
      for (const at of samples) {
        const moved = sub(place(at, 1), at);
        const length = Math.hypot(moved.x, moved.y);
        if (length === 0) continue;
        const heading = { x: moved.x / length, y: moved.y / length };
        const outward = opening ? heading : scaleVec(heading, -1);
        const wall = wallAhead(at, outward);
        const most = allowed(length, wall);
        if (most >= length) continue;
        const cut = most / length;
        const dx = at.x - middle.x;
        const dy = at.y - middle.y;
        if (dx > 0) sides.right *= cut;
        else if (dx < 0) sides.left *= cut;
        if (dy > 0) sides.above *= cut;
        else if (dy < 0) sides.below *= cut;
      }
    }

    // Every point of the counter, handles included, goes through the same
    // map, so a curve is carried along whole rather than rebuilt.
    const build = (by: number): Contour => ({
      ...contour,
      nodes: contour.nodes.map((node) => ({
        ...node,
        point: place(node.point, by),
        handleIn: node.handleIn ? place(node.handleIn, by) : null,
        handleOut: node.handleOut ? place(node.handleOut, by) : null,
      })),
    });

    /*
     * And a last check that the counter has crossed nothing it did not cross
     * already. The rulers above see a flattened outline and ask at a handful
     * of places; a stroke is a continuous thing. Where a counter would cut a
     * wall anyway it is backed off evenly, as weight backs off a contour,
     * rather than piece by piece, which would tear it.
     */
    const crossedBefore = contours.map((other, which) =>
      which === index ? contoursIntersect([contour]) : contoursIntersect([contour, other]),
    );
    const sound = (trial: Contour): boolean =>
      contours.every((other, which) => {
        if (crossedBefore[which]) return true;
        return which === index ? !contoursIntersect([trial]) : !contoursIntersect([trial, other]);
      });

    const full = build(1);
    if (sound(full)) return full;
    let low = 0;
    let high = 1;
    for (let step = 0; step < BACK_OFF_STEPS; step++) {
      const half = (low + high) / 2;
      if (sound(build(half))) low = half;
      else high = half;
    }
    return low === 0 ? contour : build(low);
  });
}

/**
 * How much of a counter's wall the middle-space control may take or give, as
 * a multiple of how far the setting is from 1. At 1.3 a wall loses at most
 * 1.25 x 0.3 of itself, and in practice a little less because of the easing.
 */
const COUNTER_REACH = 1.25;
/**
 * Where the easing starts, as a share of that limit; below it the counter is
 * scaled exactly as before. It sits just past the point where the limit and
 * plain scaling agree on a counter whose walls are as thick as it is wide, so
 * such a counter -- the fat counters of a Black -- is scaled exactly.
 */
const COUNTER_KNEE = 0.85;

/**
 * Round sharp corners.
 *
 * Every corner: wherever the outline changes direction at a point rather than
 * turning through it, whatever either side of it is. It used to round only a
 * corner between two straight runs, which on a letter somebody else drew is a
 * minority of them -- the H of a serif face meets its brackets with curves, an
 * e has no straight run at all -- so the control that says it rounds corners
 * left most of the corners of most fonts exactly as sharp as they were.
 *
 * Each side of the corner is cut back by the radius, measured along the
 * outline, and the two cut ends joined by a circular arc, drawn as one cubic
 * leaving and arriving in the directions the outline had there. The radius is
 * held to less than half of either side, so two corners at the ends of a short
 * stretch cannot eat through it and each other.
 */
function applyCornerRadius(contour: Contour, radius: number, isOuter = true): Contour {
  /*
   * And held back where it would make the outline cross itself. That happens
   * at the Black, where the weight has folded a stretch of outline in an
   * inside corner down to a few units and a rounding cut back along it runs
   * into the one beside it. A smaller radius on that one contour is the whole
   * of the answer; the letter is never handed back crossed.
   */
  const was = contoursIntersect([contour]);
  for (const share of [1, 0.5, 0.25]) {
    const rounded = roundCorners(contour, radius * share, isOuter);
    if (was || !contoursIntersect([rounded])) return rounded;
  }
  return contour;
}

function roundCorners(contour: Contour, radius: number, isOuter: boolean): Contour {
  /*
   * Points written on top of each other first become one. Weight leaves them
   * where it collapsed a stretch of outline it ran over, and a corner whose
   * neighbour is itself has no direction on that side: it was left sharp
   * while the corners beside it were rounded towards it, which stood up as a
   * burr in the notch of a heavy n and on the counter of a 4.
   */
  const nodes: GlyphNode[] = [];
  for (const node of contour.nodes) {
    const last = nodes[nodes.length - 1];
    if (last && distance(last.point, node.point) < 1e-6) {
      nodes[nodes.length - 1] = { ...last, handleOut: node.handleOut };
      continue;
    }
    nodes.push(node);
  }
  while (
    contour.closed &&
    nodes.length > 1 &&
    distance(nodes[0].point, nodes[nodes.length - 1].point) < 1e-6
  ) {
    const last = nodes.pop() as GlyphNode;
    nodes[0] = { ...nodes[0], handleIn: last.handleIn };
  }
  if (!contour.closed || nodes.length < 2 || radius <= 0) return contour;

  const settled: Contour = { closed: true, nodes };
  const segments = contourSegments(settled);
  const count = segments.length;
  if (count !== nodes.length) return contour;
  const pieces = segments.map(asPiece);
  const lengths = pieces.map(pieceLength);
  // Which way round the ink is, so a corner can be told to be an outside one.
  const winding = Math.sign(contourArea(settled)) * (isOuter ? 1 : -1);

  // How far each corner is cut back; nought where there is no corner.
  const cut = nodes.map((_, index) => {
    const arriving = segmentDirection(segments[(index - 1 + count) % count], 1);
    const leaving = segmentDirection(segments[index], 0);
    if (!(arriving.x || arriving.y) || !(leaving.x || leaving.y)) return 0;
    const cos = arriving.x * leaving.x + arriving.y * leaving.y;
    // Turning by less than this is a point on a curve drawn slightly off, not
    // a corner anybody meant.
    if (cos > Math.cos((CORNER_TURN * Math.PI) / 180)) return 0;
    /*
     * An inside corner -- where a crossbar meets a stem, the throat of a
     * counter -- is softened, not rounded as far as an outside one. Given the
     * whole radius the H grew webs under its bar and the counter of an A went
     * round: a rounded face rounds what sticks out and only eases what goes in.
     */
    const turn = arriving.x * leaving.y - arriving.y * leaving.x;
    const outside = turn * winding > 0;
    const r = Math.min(
      outside ? radius : radius * INSIDE_SHARE,
      lengths[(index - 1 + count) % count] * 0.49,
      lengths[index] * 0.49,
    );
    return r < 1 ? 0 : r;
  });
  if (cut.every((r) => r === 0)) return settled;

  // Each piece with its two ends cut back.
  const trimmed = pieces.map((piece, index) => {
    const next = (index + 1) % count;
    const from = cut[index] > 0 ? paramAt(piece, cut[index]) : 0;
    const to = cut[next] > 0 ? paramAt(piece, lengths[index] - cut[next]) : 1;
    return subPiece(piece, from, Math.max(from, to));
  });

  const out: Piece[] = [];
  for (let index = 0; index < count; index++) {
    if (cut[index] > 0) {
      const arriving = trimmed[(index - 1 + count) % count];
      const leaving = trimmed[index];
      out.push(arcBetween(arriving, leaving));
    }
    out.push(trimmed[index]);
  }
  return piecesToContour(
    out.filter((piece) => distance(piece.from, piece.to) > 1e-6 || piece.curved),
  );
}

/** How much of the radius an inside corner gets. */
const INSIDE_SHARE = 0.3;

/** Degrees the outline has to turn at a point before it counts as a corner. */
const CORNER_TURN = 12;

/** One stretch of outline as a cubic, a straight run written as one. */
interface Piece {
  from: Vec2;
  c1: Vec2;
  c2: Vec2;
  to: Vec2;
  curved: boolean;
}

function asPiece(segment: Segment): Piece {
  return segment.kind === "line"
    ? { from: segment.from, c1: segment.from, c2: segment.to, to: segment.to, curved: false }
    : { from: segment.from, c1: segment.c1, c2: segment.c2, to: segment.to, curved: true };
}

function pieceLength(piece: Piece): number {
  if (!piece.curved) return distance(piece.from, piece.to);
  let total = 0;
  let last = piece.from;
  for (let i = 1; i <= 24; i++) {
    const point = cubicAt(piece.from, piece.c1, piece.c2, piece.to, i / 24);
    total += distance(last, point);
    last = point;
  }
  return total;
}

/** The parameter a given distance along a piece. */
function paramAt(piece: Piece, along: number): number {
  if (!piece.curved) {
    const length = distance(piece.from, piece.to);
    return length > 0 ? Math.min(1, Math.max(0, along / length)) : 0;
  }
  const STEPS = 48;
  let total = 0;
  let last = piece.from;
  for (let i = 1; i <= STEPS; i++) {
    const point = cubicAt(piece.from, piece.c1, piece.c2, piece.to, i / STEPS);
    const step = distance(last, point);
    if (total + step >= along) {
      return (i - 1 + (step > 0 ? (along - total) / step : 0)) / STEPS;
    }
    total += step;
    last = point;
  }
  return 1;
}

/** The part of a piece between two parameters. */
function subPiece(piece: Piece, from: number, to: number): Piece {
  if (!piece.curved) {
    const a = lerp(piece.from, piece.to, from);
    const b = lerp(piece.from, piece.to, to);
    return { from: a, c1: a, c2: b, to: b, curved: false };
  }
  let curve: [Vec2, Vec2, Vec2, Vec2] = [piece.from, piece.c1, piece.c2, piece.to];
  if (to < 1) curve = splitCubic(curve[0], curve[1], curve[2], curve[3], to)[0];
  if (from > 0) {
    const t = to > 0 ? from / to : 0;
    curve = splitCubic(curve[0], curve[1], curve[2], curve[3], t)[1];
  }
  return { from: curve[0], c1: curve[1], c2: curve[2], to: curve[3], curved: true };
}

/**
 * A circular arc from the end of one piece to the start of the next, leaving
 * and arriving the way the outline was going there.
 */
function arcBetween(arriving: Piece, leaving: Piece): Piece {
  const heading = (piece: Piece, t: 0 | 1): Vec2 => {
    const d = piece.curved
      ? normalize(cubicDerivativeAt(piece.from, piece.c1, piece.c2, piece.to, t))
      : normalize(sub(piece.to, piece.from));
    return d.x || d.y ? d : normalize(sub(piece.to, piece.from));
  };
  const from = arriving.to;
  const to = leaving.from;
  const a = heading(arriving, 1);
  const b = heading(leaving, 0);
  const chord = distance(from, to);
  const turn = Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y)));
  // A circle's arc through this turn: its radius from the chord, its handles
  // four thirds of the tangent of a quarter of the turn.
  const half = Math.sin(turn / 2);
  const handle = half > 1e-6 ? ((4 / 3) * Math.tan(turn / 4) * chord) / (2 * half) : chord / 3;
  return {
    from,
    c1: { x: from.x + a.x * handle, y: from.y + a.y * handle },
    c2: { x: to.x - b.x * handle, y: to.y - b.y * handle },
    to,
    curved: true,
  };
}

/** A closed contour through a chain of pieces, each ending where the next begins. */
function piecesToContour(pieces: Piece[]): Contour {
  const count = pieces.length;
  const nodes: GlyphNode[] = pieces.map((piece, index) => {
    const before = pieces[(index - 1 + count) % count];
    return {
      point: { ...piece.from },
      handleIn: before.curved ? { ...before.c2 } : null,
      handleOut: piece.curved ? { ...piece.c1 } : null,
      type: before.curved || piece.curved ? "smooth" : "corner",
    };
  });
  return { closed: true, nodes };
}
