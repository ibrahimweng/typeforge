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
  clearance,
  contourContainsPoint,
  contoursBounds,
  contourArea,
  contourSegments,
  crossesMoreThan,
  cubicAt,
  FINE_STEPS,
  splitCubic,
  cubicDerivativeAt,
  distance,
  flattenContour,
  inkRunsAt,
  type Layouts,
  lerp,
  normalize,
  overlapsMoreThan,
  rayHitDistance,
  sub,
  type Segment,
} from "./geometry";
import { resolveComponents } from "./composite";
import { classifyContours } from "./outline";
import { shiftCrossbar, shiftShoulders } from "./anatomy";
import { pixelate } from "./pixel";
import { addSlabs, weighSlabs } from "./slab";
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
  const drawn = contoursBounds(contours);
  if (params.crossbar !== 0) contours = shiftCrossbar(contours, params.crossbar);
  if (params.shoulder !== 0) contours = shiftShoulders(contours, params.shoulder);
  /*
   * And spaced by any ink they put beside the letter. Lowering the bar of
   * Geist's 4 runs its diagonal on down to meet it, and the corner came out
   * sixty units into the side bearing. Only what they put out: a part
   * moved in leaves the letter its drawn spacing.
   */
  let partsGrowth = { left: 0, right: 0 };
  if (params.crossbar !== 0 || params.shoulder !== 0) {
    const moved = sideGrowth(drawn, contoursBounds(contours), 0);
    partsGrowth = { left: Math.max(0, moved.left), right: Math.max(0, moved.right) };
    if (partsGrowth.left > 0) {
      contours = contours.map((contour) =>
        mapContour(contour, (point) => ({ x: point.x + partsGrowth.left, y: point.y })),
      );
    }
  }
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
  // The letter and its slabs as they were before the weight, point for point.
  let unweightedContours: Contour[] | undefined;
  // The slabs, kept to one side until the letter has its weight.
  let slabs: Contour[] = [];
  let slabbedLetter: Contour[] = [];
  if (params.slab > 0) {
    const slabbed = withSlabs(contours, params, typeface, glyph);
    slabs = slabbed.contours.slice(contours.length);
    /*
     * And moved over by what the slabs put past the letter on the left, as
     * `resolveAdvanceWidth` makes room for what they put past it on either
     * side. Left inside the advance they took the side bearings: at the
     * longest slab Geist's H, A, E, n and m ran together along the baseline
     * and the tops of x, y, z and w made one bar. A slab serif is spaced from
     * the tips of its serifs.
     */
    if (slabbed.left > 0) {
      const over = (contour: Contour) =>
        mapContour(contour, (point) => ({ x: point.x + slabbed.left, y: point.y }));
      contours = contours.map(over);
      slabs = slabs.map(over);
    }
    slabbedLetter = contours;
  }
  /*
   * What the counters' walls, following them, took off or added beside the
   * letter -- see `followCounters` -- is its side bearings' to keep, as the
   * weight's is: a narrower o is spaced as an o, not left with gaps round it.
   */
  let counterGrowth = { ...partsGrowth };
  if (params.counterScale !== 1) {
    const unscaled = contoursBounds(contours);
    contours = applyCounterScale(contours, params.counterScale, typeface.unitsPerEm * MIN_STROKE);
    const followed = sideGrowth(unscaled, contoursBounds(contours), 0);
    counterGrowth = {
      left: counterGrowth.left + followed.left,
      right: counterGrowth.right + followed.right,
    };
    if (followed.left !== 0) {
      const over = (contour: Contour) =>
        mapContour(contour, (point) => ({ x: point.x + followed.left, y: point.y }));
      contours = contours.map(over);
      slabs = slabs.map(over);
      slabbedLetter = slabbedLetter.map(over);
    }
  }
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
    unweightedContours = [...contours, ...slabs];
    const unweighted = contoursBounds(unweightedContours);
    const drawnLetter = contours;
    contours = keptApart(
      drawnLetter,
      contours.map((contour, index) => applyWeight(contour, params.weight, index, around)),
      (index, share) => applyWeight(drawnLetter[index], params.weight * share, index, around),
    );
    slabs = weighSlabs(slabs, slabbedLetter, params.weight, typeface.unitsPerEm, contours);
    /*
     * And the letter moved over by what the weight added on its left, so it
     * keeps its side bearings.
     *
     * Adding weight grows a letter outwards on both sides, into the space
     * between it and its neighbours. Left there, every side bearing lost the
     * weight: at the heavy end of Geist the H ran into the a and the f into the
     * o, and a paragraph set in it read as letters pressed together rather
     * than as a bolder face. The advance grows by what was added on both sides
     * to match -- see `resolveAdvanceWidth` -- which is how a bold cut is
     * spaced.
     *
     * Measured, not taken to be the weight. A stem grows by the weight, but
     * the level-cut foot of a diagonal runs out on its mitre by more: the
     * sample font's k at the heaviest reached a tenth of an em past its
     * advance into the next letter, and x and v into both of theirs.
     */
    const growth = sideGrowth(unweighted, contoursBounds([...contours, ...slabs]), params.weight);
    growths.set(glyph, {
      key: growthKey(glyph, typeface, params),
      left: growth.left + counterGrowth.left,
      right: growth.right + counterGrowth.right,
    });
    const shift = growth.left;
    contours = contours.map((contour) =>
      mapContour(contour, (point) => ({ x: point.x + shift, y: point.y })),
    );
    slabs = slabs.map((slab) => mapContour(slab, (point) => ({ x: point.x + shift, y: point.y })));
  }
  if (
    params.weight === 0 &&
    (params.counterScale !== 1 || params.crossbar !== 0 || params.shoulder !== 0)
  )
    growths.set(glyph, { key: growthKey(glyph, typeface, params), ...counterGrowth });
  /*
   * The slabs are weighted apart from the letter and join it here -- see
   * `weighSlabs` -- and it is the letter alone that the weight measured.
   */
  if (slabs.length) {
    if (params.weight === 0) slabs = weighSlabs(slabs, slabbedLetter, 0, typeface.unitsPerEm);
    contours = [...contours, ...slabs];
  }
  if (params.weight !== 0 && unweightedContours) {
    contours = keepHeights(contours, params.weight, glyph, typeface, unweightedContours);
    contours = keptClear(unweightedContours, contours, typeface.unitsPerEm);
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
    contours = applyXHeight(contours, params.xHeightScale, glyph, typeface);
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
      /*
       * Closing little of the white it faces, though. The same strokes
       * do not always fit in less room: Lora's e condensed to 0.7 at the
       * heaviest weight is narrower than two of its stems, and given them
       * whole, its eye and the bowl of its a closed to specks and every
       * aperture to a crack. A condensed heavy cut is drawn with thinner stems
       * for that reason; its counters keep their share of the letter. Where
       * there is room -- any counter wider than the stems -- this changes
       * nothing, and the stems come back whole.
       */
      const scaled = contoursBounds(contours);
      const narrow = contours;
      const putBack = (index: number, share: number): Contour =>
        applyWeight(
          narrow[index],
          give * share,
          index,
          around,
          SIDEWAYS,
          CONDENSED_WHITE,
          (trial) => unfold(narrow[index], trial, params.slant),
        );
      contours = keptClear(
        narrow,
        keptApart(
          narrow,
          narrow.map((_, index) => putBack(index, 1)),
          putBack,
        ),
        typeface.unitsPerEm,
        1,
      );
      /*
       * Moved over by what the strokes put back added on the left, and the
       * advance grows by both sides -- measured, as for the weight. A stem
       * grows by the give, but the level-cut feet of a diagonal run out on
       * their mitres by more: Geist's v and w at the heaviest weight
       * condensed to 0.6 reached a tenth of an em past their advances on
       * both sides, into the letters beside them.
       */
      const growth = sideGrowth(scaled, contoursBounds(contours), give);
      gives.set(glyph, { key: growthKey(glyph, typeface, params), ...growth });
      contours = contours.map((contour) =>
        mapContour(contour, (point) => ({ x: point.x + growth.left, y: point.y })),
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
    (glyph.advanceWidth + weightRoom(glyph, typeface, params) + slabRoom(glyph, typeface, params)) *
      params.width +
      params.tracking * 2 +
      widthRoom(glyph, typeface, params),
  );
}

/**
 * A small inside corner the strokes put back folded, laid back along them.
 *
 * Putting the strokes back moves each point by how much it faces sideways,
 * so round an inside corner the stem moves the whole give and a little
 * fillet joining it to a bar only part of it, or none at its level end.
 * Where the fillet is narrower than the give, the stem went past it: the
 * corner where the tail of Geist's j meets its stem, and of its y, folded
 * into a notch at the heaviest weight condensed. Wherever a piece of
 * outline now runs the other way across from how it was drawn, the end
 * that moved less is taken the rest of the way, with its handles, until
 * none does: the fillet lies flat against the stem, as the corner of a
 * condensed heavy cut is drawn.
 */
function unfold(drawn: Contour, moved: Contour, slant: number): Contour {
  const count = moved.nodes.length;
  if (drawn.nodes.length !== count || count < 3) return moved;
  const nodes = moved.nodes.map((node) => ({ ...node }));
  let touched = false;
  const shift = (at: number) => nodes[at].point.x - drawn.nodes[at].point.x;
  const ring = (at: number) => (at + count) % count;
  // Drawn as one point: a corner the weight swallowed, or where the tail of
  // a y meets its diagonal.
  const coincident = (a: number, b: number) =>
    Math.abs(drawn.nodes[a].point.x - drawn.nodes[b].point.x) < 0.5 &&
    Math.abs(drawn.nodes[a].point.y - drawn.nodes[b].point.y) < 0.5;
  const clustered = (at: number) => coincident(at, ring(at - 1)) || coincident(at, ring(at + 1));
  const take = (at: number, by: number) => {
    touched = true;
    const along = (point: Vec2 | null): Vec2 | null =>
      point ? { x: point.x + by, y: point.y } : null;
    const node = nodes[at];
    nodes[at] = {
      ...node,
      point: along(node.point) as Vec2,
      handleIn: along(node.handleIn),
      handleOut: along(node.handleOut),
    };
  };
  for (let pass = 0; pass < count; pass++) {
    let changed = false;
    for (let index = 0; index < count; index++) {
      const next = ring(index + 1);
      const was = drawn.nodes[next].point.x - drawn.nodes[index].point.x;
      const now = nodes[next].point.x - nodes[index].point.x;
      if (Math.abs(now) < 0.5) continue;
      const [here, there] = [shift(index), shift(next)];
      const lagging = Math.abs(here) < Math.abs(there) ? index : next;
      const reversed = Math.abs(was) >= 0.5 && Math.sign(was) !== Math.sign(now);
      // Pulled apart, or an upright edge leaned over by a swallowed corner
      // at one end that did not move with it.
      const parted = coincident(index, next) || (Math.abs(was) < 0.5 && clustered(lagging));
      if (!reversed && !parted) continue;
      // Back to running the way it was drawn, by a unit: laid exactly in
      // line, a rounded corner's handles touched the outline beside them.
      const target = reversed ? Math.sign(was) * Math.min(Math.abs(was), 1) : 0;
      const gap = now - target;
      if (here * there < 0) {
        // Moved towards each other, past: both go to the middle.
        take(index, gap / 2);
        take(next, -gap / 2);
      } else {
        take(lagging, lagging === index ? gap : -gap);
      }
      changed = true;
    }
    if (!changed) break;
  }
  /*
   * And a piece brought down to nothing takes its handles with it. Two points
   * laid on one spot with a handle still reaching out between them are a
   * spike running out and back along itself -- the heavy widened n of Lora
   * had one where the tail of its arch meets the stem, and Lora's A one in its
   * counter. Brought down by the weight or by the repair above alike: those
   * two, and one in Geist's ordfeminine, were pieces drawn as a single point
   * with no handles, which the weight pulled apart and gave handles ten to
   * seventeen units long and the repair laid back on one spot. Only a piece
   * drawn that short with handles of its own -- a small loop, a ball drawn
   * as one curve -- keeps them, however the weight has grown them.
   */
  for (let index = 0; index < count; index++) {
    const next = ring(index + 1);
    const a = nodes[index].point;
    const b = nodes[next].point;
    if (Math.hypot(b.x - a.x, b.y - a.y) > 0.5) continue;
    const out = nodes[index].handleOut;
    const into = nodes[next].handleIn;
    const off = (handle: Vec2 | null, at: Vec2) => (handle ? distance(handle, at) : 0);
    if (off(out, a) <= 1e-9 && off(into, b) <= 1e-9) continue;
    const drawnFrom = drawn.nodes[index];
    const drawnTo = drawn.nodes[next];
    const drawnReach = Math.max(
      off(drawnFrom.handleOut, drawnFrom.point),
      off(drawnTo.handleIn, drawnTo.point),
    );
    if (distance(drawnFrom.point, drawnTo.point) <= 0.5 && drawnReach > 0.5) continue;
    touched = true;
    nodes[index] = { ...nodes[index], handleOut: out && { ...a } };
    nodes[next] = { ...nodes[next], handleIn: into && { ...b } };
  }
  if (!touched) return moved;
  const result = { closed: moved.closed, nodes };
  /*
   * Not where it would cross itself, upright or at the letter's slant. On the
   * crotch of Lora's x it laid three points of a curve on one upright line,
   * and the check then in use saw that cross only leaning; leaving a unit of
   * the drawn direction keeps points off one line, and a shear neither makes
   * nor unmakes a crossing, so upright and the letter's own slant are all
   * that is asked.
   */
  const lean = (contour: Contour, degrees: number) =>
    degrees === 0 ? contour : applySlant(contour, degrees);
  const worse = [...new Set([0, slant])].some((degrees) =>
    crossesMoreThan(lean(moved, degrees), FINE_STEPS)(lean(result, degrees)),
  );
  return worse ? moved : result;
}

/**
 * And the letter's contours kept off each other where the weight took one
 * through another it did not cross as drawn.
 *
 * Each contour is weighed on its own, measured against the letter as drawn,
 * so neither side of a thin join knows the other is moving: at the lightest
 * weight the crotch where the bowl of Geist's ordfeminine leaves its stem ran
 * out along its mitre into the counter, which had grown towards it, and cut
 * the join through. Where two contours cross, both are weighed again with
 * the weight taken down together, as far as keeps them apart; and failing
 * that, as drawn.
 */
function keptApart(
  drawn: Contour[],
  weighed: Contour[],
  weigh: (index: number, share: number) => Contour,
): Contour[] {
  const overlapsMore = overlapsMoreThan(drawn, FINE_STEPS);
  let result = weighed;
  for (let round = 0; round < drawn.length; round++) {
    const pairs: Array<[number, number]> = [];
    if (!overlapsMore(result, pairs)) return result;
    const [one, other] = pairs[0];
    const at = (share: number): Contour[] =>
      result.map((contour, which) => {
        if (which !== one && which !== other) return contour;
        return share === 0 ? drawn[which] : weigh(which, share);
      });
    // Clear of the others, the two of them, as well as of each other.
    const clear = (trial: Contour[]): boolean => {
      const still: Array<[number, number]> = [];
      overlapsMore(trial, still);
      return still.every((pair) => !pair.includes(one) && !pair.includes(other));
    };
    let low = 0;
    let high = 1;
    for (let step = 0; step < BACK_OFF_STEPS; step++) {
      const middle = (low + high) / 2;
      if (clear(at(middle))) low = middle;
      else high = middle;
    }
    result = at(low);
  }
  return result;
}

/**
 * The white a piece of ink standing above another keeps under it, as a share
 * of what it had as drawn -- or of an opening, the narrowest white the
 * weight leaves between walls, where it had more.
 */
const CLEAR_KEPT = 0.5;
const CLEAR_OPENING = 0.036;

/**
 * And a piece of ink standing above another -- an accent over its letter,
 * the chevron of a ≥ over its bar -- kept clear of it.
 *
 * Each is weighed against the other as drawn, and a pointed end runs out
 * along its mitre by more than the weight: the lower end of the acute on
 * Lora's heaviest Á came down onto the top of the A, which had grown up to
 * meet it, and the end of the lower arm of Geist's ≥ onto the bar under it,
 * which had grown up and out beneath it. The piece above is lifted, whole, as
 * far as keeps its share of the white; nothing about either shape changes,
 * and what stands on the baseline stays there. The strokes put back
 * sideways into a condensed letter are asked to keep all of it: they move
 * across, and closed the white under the arm of the heaviest condensed ≥ by
 * half again, as the slope of the arm carried its edge down.
 */
function keptClear(drawn: Contour[], weighed: Contour[], em: number, kept = CLEAR_KEPT): Contour[] {
  const outer = classifyContours(drawn);
  const boxes = drawn.map((contour) => contoursBounds([contour]));
  const stacks: Array<{ above: number; below: number; need: number }> = [];
  drawn.forEach((top, above) => {
    drawn.forEach((bottom, below) => {
      if (above === below || !outer[above] || !outer[below]) return;
      const a = boxes[above];
      const b = boxes[below];
      // Above it and over it, not beside it; and not inside it.
      if (a.yMin < b.yMax - 1) return;
      if (Math.min(a.xMax, b.xMax) - Math.max(a.xMin, b.xMin) <= 0) return;
      if (a.yMin - b.yMax > em * CLEAR_OPENING * 4) return;
      if (contourContainsPoint(bottom, top.nodes[0].point)) return;
      const gap = clearance(top, bottom);
      if (!(gap > 1)) return;
      stacks.push({ above, below, need: Math.min(gap * kept, CLEAR_KEPT * em * CLEAR_OPENING) });
    });
  });
  if (stacks.length === 0) return weighed;
  const lifted = (contour: Contour, by: number): Contour =>
    by === 0 ? contour : mapContour(contour, (point) => ({ x: point.x, y: point.y + by }));
  let result = weighed;
  // From the bottom up, so that what stands on a lifted piece is lifted with it.
  stacks.sort((one, other) => boxes[one.below].yMin - boxes[other.below].yMin);
  for (const { above, below, need } of stacks) {
    const clear = (by: number) => clearance(lifted(result[above], by), result[below]) >= need;
    if (clear(0)) continue;
    let high = need;
    for (let tries = 0; tries < 8 && !clear(high); tries++) high *= 2;
    if (!clear(high)) continue;
    let low = 0;
    for (let step = 0; step < 8; step++) {
      const middle = (low + high) / 2;
      if (clear(middle)) high = middle;
      else low = middle;
    }
    const by = high;
    result = result.map((contour, which) => (which === above ? lifted(contour, by) : contour));
  }
  return result;
}

/** The share of the white across a condensed letter that putting its strokes back leaves. */
const CONDENSED_WHITE = 0.7;

/**
 * How far the weight moved a letter's ink out on the left and on the right:
 * the weight itself for a letter with nothing in it, as the space between
 * words grows with the face.
 */
function sideGrowth(
  before: ReturnType<typeof contoursBounds>,
  after: ReturnType<typeof contoursBounds>,
  weight: number,
): { left: number; right: number } {
  const finite = [before.xMin, before.xMax, after.xMin, after.xMax].every(Number.isFinite);
  if (!finite || before.xMax <= before.xMin) return { left: weight, right: weight };
  return { left: before.xMin - after.xMin, right: after.xMax - before.xMax };
}

/**
 * What the weight added beside each letter, kept for setting the line, which
 * asks for every advance far more often than the outlines change.
 */
const growths = new WeakMap<Glyph, { key: string; left: number; right: number }>();

function growthKey(glyph: Glyph, typeface: Typeface, params: GlyphParams): string {
  const contours = resolveComponents(glyph, typeface);
  return [
    JSON.stringify(params),
    typeface.unitsPerEm,
    contours.reduce(
      (sum, contour) =>
        contour.nodes.reduce((total, node) => total + node.point.x * 3 + node.point.y, sum),
      contours.length,
    ),
  ].join("|");
}

/** And what putting back the strokes a change of width took added, likewise. */
const gives = new WeakMap<Glyph, { key: string; left: number; right: number }>();

function widthRoom(glyph: Glyph, typeface: Typeface, params: GlyphParams): number {
  const give = widthGive(typeface, params);
  if (Math.abs(give) <= 0.5) return 0;
  const key = growthKey(glyph, typeface, params);
  let known = gives.get(glyph);
  if (known?.key !== key) {
    resolveGlyphContours(glyph, typeface);
    known = gives.get(glyph);
  }
  return known?.key === key ? known.left + known.right : give * 2;
}

function weightRoom(glyph: Glyph, typeface: Typeface, params: GlyphParams): number {
  if (
    params.weight === 0 &&
    params.counterScale === 1 &&
    params.crossbar === 0 &&
    params.shoulder === 0
  )
    return 0;
  const key = growthKey(glyph, typeface, params);
  let known = growths.get(glyph);
  if (known?.key !== key) {
    resolveGlyphContours(glyph, typeface);
    known = growths.get(glyph);
  }
  return known?.key === key ? known.left + known.right : params.weight * 2;
}

/**
 * Slabs laid across a letter's stroke ends, and how far they reach past its
 * ink on the left and on the right.
 */
function withSlabs(
  contours: Contour[],
  params: GlyphParams,
  typeface: Typeface,
  glyph: Glyph,
): { contours: Contour[]; left: number; right: number } {
  /*
   * Letters and figures only. The stroke of an ! or the stem of a ? has the
   * same flat ends as an I and got the same bars, which no slab serif puts
   * on its punctuation.
   */
  if (!takesSlabs(glyph)) return { contours, left: 0, right: 0 };
  const slabbed = addSlabs(contours, {
    // The lowercase and the figures: the 1 of a slab serif has its flag
    // and its foot, and no bar across its top.
    flagTops: isLowercase(glyph) || isFigure(glyph),
    projection: params.slab,
    /*
     * A slab reaches further across the stroke than back along it; much
     * thicker and it reads as a box on the end rather than a serif. But
     * not much thinner than the stems either: a slab serif's slabs are
     * most of a stem thick, and at half the projection Geist's came out a
     * third of its stems, hairlines under an H.
     */
    thickness: Math.min(
      params.slab * 1.2,
      Math.max(params.slab * 0.55, cutScaleOf(typeface).stem * 0.7),
    ),
    maxWidth: typeface.unitsPerEm * 0.35,
    stem: cutScaleOf(typeface).stem,
    weight: params.weight,
  });
  if (slabbed === contours || contours.length === 0) return { contours, left: 0, right: 0 };
  const before = contoursBounds(contours);
  const after = contoursBounds(slabbed);
  return {
    contours: slabbed,
    left: Math.max(0, before.xMin - after.xMin),
    right: Math.max(0, after.xMax - before.xMax),
  };
}

/**
 * The room a letter's slabs need beside it, both sides together. Asked for
 * every letter every time the line is set, so kept against the glyph for the
 * settings and the outline it was worked out for.
 */
const slabRooms = new WeakMap<Glyph, { key: string; room: number }>();

function slabRoom(glyph: Glyph, typeface: Typeface, params: GlyphParams): number {
  if (!(params.slab > 0)) return 0;
  let contours = resolveComponents(glyph, typeface);
  const key = [
    params.slab,
    params.crossbar,
    params.shoulder,
    params.weight,
    typeface.unitsPerEm,
    cutScaleOf(typeface).stem,
    contours.reduce(
      (sum, contour) =>
        contour.nodes.reduce((total, node) => total + node.point.x * 3 + node.point.y, sum),
      contours.length,
    ),
  ].join(",");
  const known = slabRooms.get(glyph);
  if (known?.key === key) return known.room;
  contours = contours.map(cloneContour);
  if (params.crossbar !== 0) contours = shiftCrossbar(contours, params.crossbar);
  if (params.shoulder !== 0) contours = shiftShoulders(contours, params.shoulder);
  const { left, right } = withSlabs(contours, params, typeface, glyph);
  slabRooms.set(glyph, { key, room: left + right });
  return left + right;
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

/**
 * Whether a glyph is a lowercase letter, by what it encodes or else its name.
 * By the letter's category rather than by having a capital: the dotless j
 * has none, was taken for a capital, and at the heaviest weight its top was
 * held to the cap height and rose past the x-height by twice the weight.
 */
function isLowercase(glyph: Glyph): boolean {
  const lower = (text: string) => /\p{Ll}/u.test(text);
  if (glyph.unicodes.length > 0)
    return glyph.unicodes.some((code) => lower(String.fromCodePoint(code)));
  const base = glyph.name.split(".")[0];
  return base.length === 1 && lower(base);
}

/** Whether a glyph is a figure, by what it encodes or else its name. */
function isFigure(glyph: Glyph): boolean {
  const figure = (text: string) => /\p{N}/u.test(text);
  if (glyph.unicodes.length > 0)
    return glyph.unicodes.some((code) => figure(String.fromCodePoint(code)));
  const base = glyph.name.split(".")[0];
  return base.length === 1 && figure(base);
}

/** Whether a glyph is a letter or a figure, by what it encodes or else its name. */
function takesSlabs(glyph: Glyph): boolean {
  const letter = (text: string) => /[\p{L}\p{N}]/u.test(text);
  if (glyph.unicodes.length > 0)
    return glyph.unicodes.some((code) => letter(String.fromCodePoint(code)));
  const base = glyph.name.split(".")[0];
  return base.length !== 1 || letter(base);
}

/**
 * Raise or lower the x-height.
 *
 * A plain vertical scale of everything above the baseline was the first
 * version of this, which is not an x-height change: the capitals and the
 * ascenders grew with it, and every horizontal stroke -- the top and bottom of
 * an o, the spine of an s, the arms of an E -- thickened or thinned with the
 * scale while the stems stayed as they were. What a designer changing the
 * x-height does is move the top of the lowercase: so on a lowercase letter the
 * band at the x-height, where the tops of its bowls and arches run, moves up
 * or down as it is; the band on the baseline stays; the stretch between them
 * takes the change; and above the x-height, an ascender gives it back, so the
 * top of a b or an l stays where it was. Capitals, figures and the rest keep
 * their height. A glyph with nothing to say what it is -- a probe with no
 * name, a font with no x-height -- is scaled as before.
 */
function applyXHeight(
  contours: Contour[],
  factor: number,
  glyph: Glyph,
  typeface: Typeface,
): Contour[] {
  const xHeight = typeface.metrics?.xHeight ?? 0;
  const named = glyph.unicodes.length > 0 || glyph.name.length > 0;
  if (!(xHeight > 0) || !named || glyph.name === "probe")
    return contours.map((contour) => applyVerticalScale(contour, factor));
  if (!isLowercase(glyph)) return contours;
  const em = typeface.unitsPerEm;
  const band = em * 0.08;
  let shift = (factor - 1) * xHeight;
  const low = Math.min(band, xHeight * 0.3);
  const high = xHeight - band;
  const over = xHeight + em * 0.03;
  // The letter's own top, where an ascender ends, stays where it is.
  const top = Math.max(contoursBounds(contours).yMax, over + band);
  if (high <= low) return contours;
  // Eased in and out, so a bowl passing from one band into the stretch bends
  // evenly rather than turning a corner where they meet.
  const ease = (u: number) => u * u * (3 - 2 * u);
  /*
   * And the stretch put where the letter is white across, not where a stroke
   * runs across it. Spread evenly, it stretched the bar of an e and the spine
   * of an s with everything else, and they thickened at 1.25 and thinned at
   * 0.8. Each height takes a share of the change by how little of the
   * letter's width is ink there: the sides of the bowl take it, the bar
   * rides up with them.
   */
  const box = contoursBounds(contours);
  const wide = Math.max(1, box.xMax - box.xMin);
  const steps = 64;
  const give: number[] = [];
  for (let k = 0; k <= steps; k++) {
    const y = low + ((high - low) * k) / steps;
    const ink = inkRunsAt(contours, y).reduce((sum, [from, to]) => sum + (to - from), 0);
    const open = Math.max(0, 1 - ink / wide);
    // Eased in at both ends, so the stretch comes in smoothly from the
    // bands, and even between: peaked in the middle, it squeezed the sides
    // of a bowl to points.
    const u = k / steps;
    // Leaning on the open heights, not all on them: a bowl's sides are
    // open across its middle, and given all of it the o came to points.
    give.push((0.35 + 0.65 * open) * ease(Math.min(1, 4 * u, 4 * (1 - u))));
  }
  // A little blur, so a thin stroke does not become a step.
  const soft = give.map((_, k) => {
    let sum = 0;
    let weight = 0;
    for (let j = -3; j <= 3; j++) {
      const at = k + j;
      if (at < 0 || at > steps) continue;
      const w = 4 - Math.abs(j);
      sum += give[at] * w;
      weight += w;
    }
    return sum / weight;
  });
  const running = [0];
  for (let k = 1; k <= steps; k++) running.push(running[k - 1] + (soft[k - 1] + soft[k]) / 2);
  const whole = running[steps];
  // How much of the stretch falls below a height, nought to one.
  const share = (y: number): number => {
    if (!(whole > 0)) return ease((y - low) / (high - low));
    const at = ((y - low) / (high - low)) * steps;
    const k = Math.min(steps - 1, Math.max(0, Math.floor(at)));
    const f = at - k;
    return (running[k] + (running[k + 1] - running[k]) * f) / whole;
  };
  const steepest = ((Math.max(...soft) / (whole > 0 ? whole : 1)) * steps) / (high - low);
  /*
   * Held short of folding the outline back: where the stretch is steepest,
   * and on an ascender, which gives the change back over its own length.
   */
  shift = Math.sign(shift) * Math.min(Math.abs(shift), 0.9 / Math.max(steepest, 1e-9));
  /*
   * An ascender gives the change back over its own length, at most by half:
   * squeezed further, the hook of an f was flattened. Past that the top of
   * the ascender moves by the rest.
   */
  const rise = Math.sign(shift) * Math.max(0, Math.abs(shift) - (top - over) * 0.5);
  const map = (y: number): number => {
    if (y <= low) return y;
    if (y < high) return y + shift * share(y);
    if (y <= over) return y + shift;
    // An ascender above: nothing runs across it, so it gives the change
    // back evenly.
    if (y < top) return y + shift + ((rise - shift) * (y - over)) / (top - over);
    return y + rise;
  };
  // Squeezed further than this, the easing would fold the outline back.
  return contours.map((contour) =>
    mapContour(contour, (point) => ({ x: point.x, y: map(point.y) })),
  );
}

/**
 * A letter made lighter or bolder brought back onto its baseline and to its
 * height.
 *
 * The weight moves the outline square to itself all round, so it moved the
 * bottom of every letter below the baseline and the top above the x-height
 * or the cap height by the weight: at the heaviest setting a line of Lora
 * sat sixty units low, its x-height a hundred and twenty taller, and a single
 * letter given a weight of its own dropped out of the line. A bolder cut is
 * drawn on the same baseline and to the same heights, its horizontals a
 * little lighter than its stems for the room. So the band from the moved
 * bottom to the moved top of the lowercase -- or of the capitals, for any
 * letter that is not lowercase -- is squeezed back to what it was, and what
 * lies above it and below it (ascenders, descenders, overshoots past the top)
 * moves back by the weight as it is. Handles are carried by how the squeeze
 * bends at their point, so a smooth point stays smooth.
 */
function keepHeights(
  contours: Contour[],
  weight: number,
  glyph: Glyph,
  typeface: Typeface,
  /** The same contours before the weight, point for point, where known. */
  before?: Contour[],
): Contour[] {
  const metrics = typeface.metrics;
  const top = isLowercase(glyph) ? metrics?.xHeight : metrics?.capHeight;
  if (!top || !(top > 0) || top + 2 * weight <= 0) return contours;
  /*
   * Only the edges the letter was drawn to. A period stands on the baseline
   * and a quote hangs from the top, and each goes back to the one it
   * touches; a hyphen, a bullet or an asterisk is placed by its middle and
   * touched neither, and squeezed or moved it would leave the middle of the
   * line: it keeps its place and grows all round.
   */
  const drawn = contoursBounds(resolveComponents(glyph, typeface));
  const near = top * 0.05;
  const onBaseline = drawn.yMin <= near;
  const toTop = drawn.yMax >= top - near;
  if (!onBaseline && !toTop) return contours;
  const matched =
    before?.length === contours.length &&
    before.every((contour, index) => contour.nodes.length === contours[index].nodes.length);
  const tolerance = typeface.unitsPerEm * 0.02;
  // A top edge moves up as the letter gets bolder and down as it gets
  // lighter; a bottom edge the other way.
  const along = (moved: number) => moved * Math.sign(weight);
  /*
   * Where the edges on the baseline and at the height went, as measured,
   * rather than taken to be the weight. A stem's end moves by the weight; a
   * serif made lighter keeps a third of itself and moves less, and squeezed
   * as if it had moved the whole weight, Lora's light H went twenty-eight
   * units below its baseline and past its cap height. The middle of what
   * the points on an edge did is taken as the edge's move.
   */
  /*
   * Whether the outline runs level at a point, either side of it: the top of
   * a stem, the bottom of a bowl. The sloped top of a wedge serif passes
   * near the height too, and counted as on it, it pulled the ascender of
   * Lora's light b eight units past where it was drawn.
   */
  const level = (contour: Contour, index: number): boolean => {
    const count = contour.nodes.length;
    const node = contour.nodes[index];
    const flat = (toward: Vec2 | null | undefined): boolean => {
      if (!toward) return false;
      const dx = Math.abs(toward.x - node.point.x);
      const dy = Math.abs(toward.y - node.point.y);
      return dx + dy > 1e-6 && dy <= dx * 0.2;
    };
    const previous = contour.nodes[(index - 1 + count) % count];
    const next = contour.nodes[(index + 1) % count];
    return (
      flat(node.handleIn ?? (previous.handleOut ? null : previous.point)) ||
      flat(node.handleOut ?? (next.handleIn ? null : next.point))
    );
  };
  const edgeMove = (line: number, upward: boolean): number => {
    const assumed = upward ? weight : -weight;
    if (!matched) return assumed;
    const found: Array<{ at: number; moved: number }> = [];
    for (const [which, contour] of (before as Contour[]).entries()) {
      for (const [index, node] of contour.nodes.entries()) {
        if (Math.abs(node.point.y - line) > tolerance || !level(contour, index)) continue;
        const moved = contours[which].nodes[index].point.y - node.point.y;
        if (upward ? along(moved) > 0.5 : along(moved) < -0.5)
          found.push({ at: node.point.y, moved });
      }
    }
    if (found.length === 0) return assumed;
    /*
     * The edge is what lies nearest the line. The flat tips of the flag
     * serifs on Lora's u lie seventeen units under its x-height and its
     * stems' tops ten over; the middle of them all was the tips', which made
     * lighter hardly move, and the u stood twenty units short.
     */
    const nearest = Math.min(...found.map((point) => Math.abs(point.at - line)));
    const moves = found
      .filter((point) => Math.abs(point.at - line) <= nearest + 2)
      .map((point) => point.moved)
      .sort((a, b) => a - b);
    return moves[Math.floor(moves.length / 2)];
  };
  /*
   * Pinned at each edge the letter was drawn to -- its own bottom where a
   * descender takes it below the baseline, the baseline, the x-height or cap
   * height, and its own top where an ascender takes it above -- each moved
   * back by what its own points did, and eased in straight lines between.
   * Pinned only at the x-height, a light b's ascender came back by what the
   * top of its bowl had moved and stood twenty-four units short.
   */
  const box = matched ? contoursBounds(before as Contour[]) : drawn;
  /*
   * Not at a line the letter only passes through. The stem of a dotless j
   * crosses the baseline with no point on it, and pinned there as if it
   * stood on it, the stem above was squeezed and the tail below moved whole.
   */
  const reference = matched ? (before as Contour[]) : contours;
  const touches = (line: number): boolean =>
    Math.abs(box.yMin - line) <= tolerance ||
    Math.abs(box.yMax - line) <= tolerance ||
    reference.some((contour) =>
      contour.nodes.some((node) => Math.abs(node.point.y - line) <= tolerance),
    );
  const pins: Array<{ from: number; to: number }> = [];
  if (onBaseline && box.yMin < -tolerance)
    pins.push({ from: box.yMin + edgeMove(box.yMin, false), to: box.yMin });
  if (onBaseline && touches(0)) pins.push({ from: edgeMove(0, false), to: 0 });
  if (toTop && touches(top)) pins.push({ from: top + edgeMove(top, true), to: top });
  if (toTop && box.yMax > top + tolerance)
    pins.push({ from: box.yMax + edgeMove(box.yMax, true), to: box.yMax });
  if (pins.length === 0) return contours;
  if (pins.some((pin, index) => index > 0 && pin.from <= pins[index - 1].from)) return contours;
  const map = (y: number): number => {
    const first = pins[0];
    const last = pins[pins.length - 1];
    if (y <= first.from) return y + first.to - first.from;
    if (y >= last.from) return y + last.to - last.from;
    for (let index = 1; index < pins.length; index++) {
      const [a, b] = [pins[index - 1], pins[index]];
      if (y <= b.from) return a.to + ((y - a.from) * (b.to - a.to)) / (b.from - a.from);
    }
    return y;
  };
  const slope = (y: number): number => {
    for (let index = 1; index < pins.length; index++) {
      const [a, b] = [pins[index - 1], pins[index]];
      if (y > a.from && y < b.from) return (b.to - a.to) / (b.from - a.from);
    }
    return 1;
  };
  const squeezed = contours.map((contour) => ({
    closed: contour.closed,
    nodes: contour.nodes.map((node) => {
      const at = node.point;
      const by = slope(at.y);
      const carry = (handle: Vec2 | null): Vec2 | null =>
        handle ? { x: handle.x, y: map(at.y) + (handle.y - at.y) * by } : null;
      return {
        point: { x: at.x, y: map(at.y) },
        handleIn: carry(node.handleIn),
        handleOut: carry(node.handleOut),
        type: node.type,
      };
    }),
  }));
  /*
   * Kept only where it crosses nothing the letter as it came did not: an
   * outline that would cross itself keeps the pins alone, or failing that
   * its heights as they came; and where one contour would be taken through
   * another -- the lighter letter's heights put back while its counters stood
   * open wider, the two loops of Lora's section sign met -- the two take
   * less of it together.
   */
  const settle = (whole: Contour[]): Contour[] => {
    const kept = whole.map((contour, which) => {
      const crossedMore = crossesMoreThan(contours[which], FINE_STEPS);
      if (!crossedMore(contour)) return contour;
      return contour !== squeezed[which] && !crossedMore(squeezed[which])
        ? squeezed[which]
        : contours[which];
    });
    return keptApart(contours, kept, (which, share) =>
      partway(contours[which], kept[which], share),
    );
  };
  if (!matched) return settle(squeezed);
  /*
   * And what the pins could not say, because one edge carries parts that
   * moved differently. The foot of a stem made lighter rises by the weight;
   * the thin bottom of the bowl beside it keeps a third of itself and rises
   * less, and brought back by the same amount the bowl of Geist's light b
   * hung fourteen units below where it was drawn. So every point on an edge
   * that moved outward says how far it now is from where it was drawn --
   * the foot nothing, the bowl its fourteen units -- and between them a
   * smooth field is drawn: each point of the outline, and each handle at
   * its own place, takes the weighted mean of what the edge points nearby
   * say, less the further it is from the edge. Moving points one at a time,
   * a handle carried along with its point, put a belly into the bowl; a
   * smooth field moves the curve as a whole.
   */
  const edges: Array<{ at: Vec2; by: number; up: boolean }> = [];
  for (const [which, contour] of (before as Contour[]).entries()) {
    for (const [index, node] of contour.nodes.entries()) {
      const was = node.point.y;
      const moved = contours[which].nodes[index].point.y - was;
      const along = moved * Math.sign(weight);
      /*
       * Which edge a point is on, by where it was drawn rather than which way
       * it went. Made lighter, the sharp corner where the diagonal of Lora's
       * N meets its serif went up, not down, and read by its movement as a
       * point on the baseline, it was never brought back: the N stood six
       * units over its cap height.
       */
      const atTop =
        (toTop && Math.abs(was - top) <= tolerance) || Math.abs(was - box.yMax) <= tolerance;
      const atBottom =
        (onBaseline && Math.abs(was) <= tolerance) || Math.abs(was - box.yMin) <= tolerance;
      if ((!atTop && !atBottom) || Math.abs(moved) <= 0.5) continue;
      const up = atTop && (!atBottom || along > 0);
      const now = squeezed[which].nodes[index].point;
      /*
       * A point on a slope near the edge -- the top of a wedge serif, the
       * join of the tail of a Q with its bowl -- is only set right where it
       * was pushed out past the edge: Lora's light b stood eight units
       * over its ascender from the thin top of its flag. Left inside, it is
       * where the letter's own shape put it, and corrected there it pulled
       * the Q's tail.
       */
      if (!level(contour, index)) {
        const past = up ? now.y > Math.max(was, box.yMax) : now.y < Math.min(was, box.yMin);
        if (!past) continue;
      }
      // A point the weight carried off the edge -- where the tail of a Q
      // leaves its bowl -- is no longer on it: a stroke that moved less than
      // the weight is out by part of the weight, and one that moved more
      // than the weight was carried along by something else.
      if (Math.abs(moved) > Math.abs(weight) * 1.1 || Math.abs(was - now.y) > Math.abs(weight))
        continue;
      /*
       * And only drawn back in. A point short of its edge is where the
       * letter's own strokes put it -- the bottom of a Q's bowl, held up by
       * the tail it runs into -- and pulled out to the edge it bent the
       * bowl; a point pushed past the edge is the fault being mended.
       */
      const by = was - now.y;
      // Made lighter, every edge moves in, and short of its line is the fault
      // itself: the tops of Lora's light u stood eighteen units under them.
      if (weight > 0 && (up ? by > 0 : by < 0)) continue;
      edges.push({ at: now, by, up });
    }
  }
  if (!edges.some((edge) => Math.abs(edge.by) > 0.5)) return settle(squeezed);
  const band = typeface.unitsPerEm * 0.1;
  const soft = (typeface.unitsPerEm * 0.01) ** 2;
  /*
   * The top and the bottom each on their own, and each fading away from its
   * own edges. One field over both carried the correction of the feet of
   * Lora's light N, twenty-eight units, up to the corner at its top with
   * nothing there to say otherwise, and lifted it six units past its cap
   * height.
   */
  const groups = [true, false].map((up) => ({
    edges: edges.filter((edge) => edge.up === up),
    lines: up ? [...(toTop ? [top] : []), box.yMax] : [...(onBaseline ? [0] : []), box.yMin],
  }));
  const field = (at: Vec2): number => {
    let total = 0;
    for (const group of groups) {
      if (group.edges.length === 0) continue;
      // Full strength as far from an edge as the corrections themselves
      // reach, and fading over a band beyond.
      const slack = Math.max(...group.edges.map((edge) => Math.abs(edge.by)));
      const off = Math.max(
        0,
        Math.min(...group.lines.map((line) => Math.abs(at.y - line))) - slack,
      );
      const envelope = Math.max(0, 1 - off / band);
      if (envelope === 0) continue;
      let sum = 0;
      let weights = 0;
      for (const edge of group.edges) {
        const weight = 1 / ((edge.at.x - at.x) ** 2 + (edge.at.y - at.y) ** 2 + soft);
        sum += edge.by * weight;
        weights += weight;
      }
      if (weights > 0) total += (sum / weights) * envelope;
    }
    return total;
  };
  /*
   * Never past where a point on an edge was drawn. Lifted with the level
   * edges beside it, the small spur at the top of Lora's light q, which had
   * moved less than they had, went twelve units past where it was drawn.
   * Only on the edges: inside the letter -- the bottom of a counter, above
   * the bottom of a bowl -- a point is carried along with the edge it is
   * across the stroke from, or the stroke between them changes weight.
   */
  const edgeLines = groups.flatMap((group) => group.lines);
  const onEdgeLine = (y: number) => edgeLines.some((line) => Math.abs(y - line) <= tolerance);
  const shift = (at: Vec2 | null, drawnAt: Vec2 | null | undefined): Vec2 | null => {
    if (!at) return null;
    const by = field(at);
    let y = at.y + by;
    if (drawnAt && onEdgeLine(drawnAt.y)) {
      if (by > 0) y = Math.min(y, Math.max(at.y, drawnAt.y));
      else if (by < 0) y = Math.max(y, Math.min(at.y, drawnAt.y));
    }
    return { x: at.x, y };
  };
  const drawnContours = before as Contour[];
  return settle(
    squeezed.map((contour, which) => ({
      closed: contour.closed,
      nodes: contour.nodes.map((node, index) => {
        const drawnNode = drawnContours[which].nodes[index];
        return {
          ...node,
          point: shift(node.point, drawnNode.point) as Vec2,
          handleIn: shift(node.handleIn, drawnNode.handleIn),
          handleOut: shift(node.handleOut, drawnNode.handleOut),
        };
      }),
    })),
  );
}

/** An outline `share` of the way to another point for point, every point and handle. */
function partway(from: Contour, to: Contour, share: number): Contour {
  if (share >= 1) return to;
  const mix = (was: Vec2 | null, now: Vec2 | null): Vec2 | null =>
    was && now ? lerp(was, now, share) : now;
  return {
    closed: to.closed,
    nodes: to.nodes.map((node, index) => {
      const was = from.nodes[index];
      return {
        ...node,
        point: mix(was.point, node.point) as Vec2,
        handleIn: mix(was.handleIn, node.handleIn),
        handleOut: mix(was.handleOut, node.handleOut),
      };
    }),
  };
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
  // Each outline laid out once for every check of every counter's trials.
  const layouts: Layouts = new WeakMap();
  const overlapsMore = overlapsMoreThan(contours, FINE_STEPS, layouts);
  const amount = Math.abs(factor - 1);
  const opening = factor > 1;
  const follow = COUNTER_FOLLOW;
  const upright = opening ? COUNTER_UPRIGHT : COUNTER_UPRIGHT_CLOSING;

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

  const scaled = contours.map((contour, index) => {
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
    /*
     * A side whose wall is a straight line of the drawing -- the stem of a b,
     * the legs of an A -- does not move: the wall cannot follow it without
     * bending, and moved alone into it the counter made the stem heavier.
     * The counter changes from its round sides.
     */
    const follows = {
      left: wallBeside(contours, outer, contour, -1) !== "leaning",
      right: wallBeside(contours, outer, contour, 1) !== "leaning",
    };
    const sides = { left: follows.left ? 1 : 0, right: follows.right ? 1 : 0, below: 1, above: 1 };
    for (const at of samples) {
      const dx = at.x - middle.x;
      const dy = at.y - middle.y;
      // A side whose wall follows it across takes only the rest from it.
      if (dx !== 0) {
        const key = dx > 0 ? "right" : "left";
        const share = follows[key] ? 1 - follow : 1;
        if (share > 0) {
          const wanted = amount * Math.abs(dx);
          const wall = wallAhead(at, { x: Math.sign(dx), y: 0 });
          sides[key] = Math.min(sides[key], allowed(wanted * share, wall) / (wanted * share));
        }
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
      const up = scaleOf((dy > 0 ? sides.above : sides.below) * by * upright);
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
        const shifted = sub(place(at, 1), at);
        // Only what goes into a wall that stays put.
        const followed = follows[at.x > middle.x ? "right" : "left"];
        const moved = { x: shifted.x * (followed ? 1 - follow : 1), y: shifted.y };
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
    const crossedMore = crossesMoreThan(contour, FINE_STEPS, layouts);
    // Against the walls where they will not follow; those that do are
    // checked once they have moved, in `followCounters`.
    const alone = !follows.left && !follows.right;
    const sound = (trial: Contour): boolean =>
      !crossedMore(trial) &&
      (!alone || !overlapsMore(contours.map((other, which) => (which === index ? trial : other))));

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
  return followCounters(contours, scaled, outer, follow);
}

/**
 * What kind of wall stands beyond one side of a counter: a straight line of
 * the drawing standing upright (a stem, the side of a square o), which can
 * move if all of that side moves with it; one leaning (the leg of an A, the
 * diagonal of a 4), which cannot move without bending or parting from the
 * stroke it meets; or a round one, which can follow its counter and ease
 * back along its length. A ray from the counter's side, at its middle
 * height, across the ink says which piece of outline it meets first.
 */
type Wall = "upright" | "leaning" | "round";
function wallBeside(contours: Contour[], outer: boolean[], counter: Contour, side: -1 | 1): Wall {
  const was = contoursBounds([counter]);
  const tall = was.yMax - was.yMin;
  const middle = (was.yMin + was.yMax) / 2;
  const from = { x: side < 0 ? was.xMin : was.xMax, y: middle };
  let hit = Infinity;
  let kind: Wall = "leaning";
  contours.forEach((other, which) => {
    if (!outer[which]) return;
    for (const segment of contourSegments(other)) {
      const points =
        segment.kind === "line"
          ? [segment.from, segment.to]
          : Array.from({ length: 25 }, (_, k) =>
              cubicAt(segment.from, segment.c1, segment.c2, segment.to, k / 24),
            );
      for (let k = 0; k + 1 < points.length; k++) {
        const [a, b] = [points[k], points[k + 1]];
        if ((a.y - middle) * (b.y - middle) > 0 || a.y === b.y) continue;
        const x = a.x + ((middle - a.y) / (b.y - a.y)) * (b.x - a.x);
        const ahead = (x - from.x) * side;
        if (ahead > 0.5 && ahead < hit) {
          hit = ahead;
          const long = segment.kind === "line" && distance(segment.from, segment.to) >= tall * 0.5;
          const upright =
            Math.abs(segment.to.x - segment.from.x) <=
            Math.abs(segment.to.y - segment.from.y) * 0.05;
          kind = !long ? "round" : upright ? "upright" : "leaning";
        }
      }
    }
  });
  return Number.isFinite(hit) ? kind : "leaning";
}

/**
 * The round walls of a letter moved with its counters, so its strokes keep
 * their weight.
 *
 * Closing a counter moved only the counter, so every wall round it grew by
 * what the counter lost: at 0.6 the letters with counters -- a, e, g, s, R,
 * B, b, o, 4, 8 -- set as a bold beside an H, an n and an m that have none,
 * and opened they set as a light. A type designer closing up the middle of
 * an o draws a narrower o with the same strokes. So wherever a counter's
 * side moved across, the wall beyond it moves the same way and keeps its
 * thickness: a round wall -- the outside of an o, the bowl of a b, d, p, a,
 * g, B or R -- and an upright one, the stem of a b or an R, which moves
 * across whole. A leaning wall -- the legs of an A -- stands where it is,
 * since moving part of it would bend it. Up and down there is nowhere for a
 * wall to go without changing the letter's height, so there the counter
 * changes as before.
 *
 * Each counter moves the ink beside it, points and handles alike, across its
 * own width in proportion and beyond each side by all that side moved.
 */
function followCounters(
  before: Contour[],
  after: Contour[],
  outer: boolean[],
  follow: number,
): Contour[] {
  const settled = alignSharedWalls(before, after, outer);
  const maps: Array<{ index: number; shiftAt: (point: Vec2) => number }> = [];
  before.forEach((contour, index) => {
    if (outer[index] || contour === settled[index]) return;
    const was = contoursBounds([contour]);
    const now = contoursBounds([settled[index]]);
    const tall = was.yMax - was.yMin;
    if (!(tall > 0) || !(was.xMax > was.xMin)) return;
    const leftWall = wallBeside(before, outer, contour, -1);
    const rightWall = wallBeside(before, outer, contour, 1);
    const dxLeft = leftWall === "leaning" ? 0 : now.xMin - was.xMin;
    const dxRight = rightWall === "leaning" ? 0 : now.xMax - was.xMax;
    if (Math.abs(dxLeft) < 0.5 && Math.abs(dxRight) < 0.5) return;
    /*
     * The ink beside a counter moves by the same map the counter did: across
     * the counter's own width in proportion, as the counter was scaled, and
     * beyond each side of it by all that side moved -- the walls keep their
     * thickness, and the letter stays one shape. Moved instead by what the
     * counter's edge did at each height, a sloping wall kept its thickness
     * only across and the shoulders of an e bulged; eased away above and
     * below the counter, the wall of an e bent back out below its eye and
     * the leg of an R kinked.
     *
     * At every height, but handed over to another counter above or below --
     * the two bowls of a B, the loops of an 8 or a g -- across the gap
     * between them, so that between them the two maps share the ink out
     * whole. Each eased to nothing halfway, the ink in the gap moved less
     * than above it and below it, and the serif on the arm of Lora's &,
     * which stands there, was sheared into a lozenge.
     */
    let above = Infinity;
    let below = Infinity;
    before.forEach((other, which) => {
      if (which === index || outer[which]) return;
      const them = contoursBounds([other]);
      const overlap = Math.min(them.xMax, was.xMax) - Math.max(them.xMin, was.xMin);
      if (overlap <= 0) return;
      if (them.yMin >= was.yMax) above = Math.min(above, Math.max(1, them.yMin - was.yMax));
      if (them.yMax <= was.yMin) below = Math.min(below, Math.max(1, was.yMin - them.yMax));
    });
    const ease = (u: number) => u * u * (3 - 2 * u);
    const hub = Math.min(was.xMax, Math.max(was.xMin, centroid(contour).x));
    const leftBy = dxLeft * follow;
    const rightBy = dxRight * follow;
    const shiftAt = (point: Vec2): number => {
      const off =
        point.y < was.yMin
          ? (was.yMin - point.y) / below
          : point.y > was.yMax
            ? (point.y - was.yMax) / above
            : 0;
      const eased = off >= 1 ? 0 : 1 - ease(off);
      if (eased === 0) return 0;
      const left = point.x < hub;
      const by = left ? leftBy : rightBy;
      const reach = Math.max(1e-9, left ? hub - was.xMin : was.xMax - hub);
      /*
       * Evenly across the counter, as it was scaled, and all of the side's
       * movement beyond it -- blended over a short run either side of the
       * counter's edge rather than meeting at a corner there. The corner
       * pointed the top and bottom of a closed o like a lemon.
       */
      const slope = by / reach;
      const blend = reach * FOLLOW_BLEND;
      const out = Math.abs(point.x - hub);
      if (out <= reach - blend) return slope * out * eased;
      if (out >= reach + blend) return by * eased;
      const into = out - (reach - blend);
      return slope * (reach - blend + into - (into * into) / (4 * blend)) * eased;
    };
    maps.push({ index, shiftAt });
  });
  const moveBy = (contours: Contour[], chosen: typeof maps): Contour[] =>
    contours.map((other, which) => {
      const by = chosen.filter((map) => map.index !== which);
      if (by.length === 0) return other;
      const shiftAt = (point: Vec2) => by.reduce((sum, map) => sum + map.shiftAt(point), 0);
      /*
       * A straight upright run of the outline moves across whole, by the
       * most any of its points is given. Between two counters one above the
       * other the ink moves by a blend of the two maps that changes with
       * height, and an upright edge standing in that gap -- the serif on the
       * arm of Lora's & -- leaned by nineteen units at 1.4. The most rather
       * than the middle: where one counter's map is tried alone, the middle
       * of a stem it shares with the counter above gets half of it, and the
       * wall beside it would change weight.
       */
      const runs = uprightRuns(other);
      const runShift = new Map<number, number>();
      runs.forEach((run) => {
        if (run < 0 || runShift.has(run)) return;
        const shifts = other.nodes
          .filter((_, at) => runs[at] === run)
          .map((node) => shiftAt(node.point));
        // The most, where they all go one way; pushed both ways at once, the
        // most one way less the most the other, however many points are at
        // each -- which goes smoothly over into the first as either push
        // goes to nothing, and to nothing for pushes equal and opposite.
        const oneWay = shifts.every((shift) => shift >= 0) || shifts.every((shift) => shift <= 0);
        runShift.set(
          run,
          oneWay
            ? shifts.reduce((most, next) => (Math.abs(next) > Math.abs(most) ? next : most), 0)
            : Math.max(...shifts) + Math.min(...shifts),
        );
      });
      return {
        closed: other.closed,
        nodes: other.nodes.map((node, index) => {
          const whole = runs[index] >= 0 ? runShift.get(runs[index]) : undefined;
          const move = (point: Vec2 | null): Vec2 | null =>
            point ? { x: point.x + (whole ?? shiftAt(point)), y: point.y } : null;
          return {
            ...node,
            point: move(node.point) as Vec2,
            handleIn: move(node.handleIn),
            handleOut: move(node.handleOut),
          };
        }),
      };
    });
  /*
   * Not where following would cross an outline, or two, anywhere the letter
   * as drawn did not. Asked against the drawing rather than the counters as
   * scaled: a counter can stand through a wall that is to follow it, and a
   * crossing that following failed to clear was let through as one already
   * there.
   */
  const layouts: Layouts = new WeakMap();
  const crossedMore = before.map((contour) => crossesMoreThan(contour, FINE_STEPS, layouts));
  const overlapsMore = overlapsMoreThan(before, FINE_STEPS, layouts);
  const crosses = (moved: Contour[]): boolean =>
    moved.some((other, which) => other !== before[which] && crossedMore[which](other)) ||
    overlapsMore(moved);
  /*
   * The counters chosen opened and the ink moved by their maps, the counters
   * without a map that are kept as scaled, and the rest of the counters as
   * drawn.
   */
  const mapped = new Set(maps.map((map) => map.index));
  const unmapped = before.flatMap((contour, which) =>
    !mapped.has(which) && settled[which] !== contour ? [which] : [],
  );
  const opened = (chosen: typeof maps, kept: Set<number>): Contour[] => {
    const open = new Set(chosen.map((map) => map.index));
    const start = settled.map((contour, which) =>
      (mapped.has(which) && !open.has(which)) || (unmapped.includes(which) && !kept.has(which))
        ? before[which]
        : contour,
    );
    return moveBy(start, chosen);
  };
  /*
   * All the counters at once, each moving the ink in its own band. One after
   * another, the two bowls of a B each moved one end of its stem, which is a
   * single straight line: halfway through, the stem leaned across the lower
   * bowl, the crossing check saw it, and the upper bowl was put back.
   */
  const all = new Set(unmapped);
  const together = opened(maps, all);
  if (!crosses(together)) return together;
  /*
   * Failing that, one at a time, and a counter that would cross a wall stays
   * as it was drawn: first those without a map -- moved too little across
   * for a wall to follow, or not across at all, and not always asked about
   * the walls round them when they were scaled -- then those with. Put back
   * all together, one counter scaled through a wall took every other
   * counter's change with it.
   */
  const kept = new Set<number>();
  for (const which of unmapped) {
    kept.add(which);
    if (crosses(opened([], kept))) kept.delete(which);
  }
  let chosen: typeof maps = [];
  for (const map of maps) {
    const trial = [...chosen, map];
    if (!crosses(opened(trial, kept))) chosen = trial;
  }
  return opened(chosen, kept);
}

/**
 * Which straight upright run of an outline each point belongs to, or -1.
 *
 * A run is one or more straight pieces one after another, each standing as
 * near upright as `wallBeside` counts a wall upright; a point in the middle
 * of a stem joins the two halves into one run. The last point runs on to
 * the first only on a closed outline.
 */
function uprightRuns(contour: Contour): number[] {
  const nodes = contour.nodes;
  const count = nodes.length;
  const runs = new Array<number>(count).fill(-1);
  const pieces = contour.closed ? count : count - 1;
  const upright = (index: number): boolean => {
    const a = nodes[index];
    const b = nodes[(index + 1) % count];
    if (a.handleOut || b.handleIn) return false;
    const dy = b.point.y - a.point.y;
    return Math.abs(dy) >= 1 && Math.abs(b.point.x - a.point.x) <= Math.abs(dy) * 0.05;
  };
  const straight = Array.from({ length: pieces }, (_, index) => upright(index));
  if (!straight.some(Boolean) || straight.every(Boolean)) return runs;
  // Start after a piece that is not upright, so a run across the join of a
  // closed outline is not cut in two.
  const start = contour.closed ? (straight.indexOf(false) + 1) % pieces : 0;
  let run = -1;
  let open = false;
  for (let step = 0; step < pieces; step++) {
    const index = (start + step) % pieces;
    if (!straight[index]) {
      open = false;
      continue;
    }
    if (!open) {
      run++;
      open = true;
    }
    runs[index] = run;
    runs[(index + 1) % count] = run;
  }
  return runs;
}

/**
 * Counters stacked on one straight wall moved alike along it.
 *
 * The two bowls of a B share its stem, and each opened by its own width: the
 * lower bowl, the wider, pushed the foot of the stem out further than the
 * upper one pushed its head, and the stem leaned. So where counters one above
 * another stand on the same upright wall, each moves that side by the least
 * any of them did, and the others give the difference back across their own
 * width, as they were scaled.
 */
function alignSharedWalls(before: Contour[], after: Contour[], outer: boolean[]): Contour[] {
  const result = after.map((contour) => contour);
  const counters = before.flatMap((contour, index) =>
    outer[index] || contour === after[index] ? [] : [index],
  );
  for (const side of [-1, 1] as const) {
    const upright = counters.filter(
      (index) => wallBeside(before, outer, before[index], side) === "upright",
    );
    const edge = (index: number, contours: Contour[]) => {
      const box = contoursBounds([contours[index]]);
      return side < 0 ? box.xMin : box.xMax;
    };
    for (const index of upright) {
      const was = contoursBounds([before[index]]);
      const own = edge(index, after) - edge(index, before);
      // Its neighbours on the same wall: over or under it, their edge on this
      // side within a stroke's hairline of its own.
      const least = upright
        .filter((other) => {
          const them = contoursBounds([before[other]]);
          const overlap = Math.min(them.xMax, was.xMax) - Math.max(them.xMin, was.xMin);
          return overlap > 0 && Math.abs(edge(other, before) - edge(index, before)) <= 2;
        })
        .map((other) => edge(other, after) - edge(other, before))
        .reduce((best, next) => (Math.abs(next) < Math.abs(best) ? next : best), own);
      const back = least - own;
      if (Math.abs(back) < 0.5) continue;
      const now = contoursBounds([after[index]]);
      const hub = Math.min(now.xMax, Math.max(now.xMin, centroid(after[index]).x));
      const reach = side < 0 ? hub - now.xMin : now.xMax - hub;
      if (!(reach > 0)) continue;
      const give = (point: Vec2 | null): Vec2 | null => {
        if (!point) return null;
        const share = Math.max(0, Math.min(1, ((point.x - hub) * side) / reach));
        return { x: point.x + back * share, y: point.y };
      };
      result[index] = {
        closed: after[index].closed,
        nodes: after[index].nodes.map((node) => ({
          ...node,
          point: give(node.point) as Vec2,
          handleIn: give(node.handleIn),
          handleOut: give(node.handleOut),
        })),
      };
    }
  }
  return result;
}

/**
 * How much of a counter's wall the middle-space control may take or give, as
 * a multiple of how far the setting is from 1. At 1.3 a wall loses at most
 * 1.25 x 0.3 of itself, and in practice a little less because of the easing.
 */
const COUNTER_REACH = 1.25;
/**
 * How much of a counter's change across its walls take by following it, the
 * rest by thinning or thickening within the limits above. All of it, either
 * way: a wider or a narrower o with the strokes of the rest. Walls thinned
 * alone set the opened round letters as a light, and thickened alone the
 * closed ones as a bold beside an H, an n and an m that have no counter.
 */
const COUNTER_FOLLOW = 1;
/**
 * How far either side of a counter's edge the ink beside it blends from
 * moving as the counter was scaled into moving with the side, as a share of
 * the counter's half-width. A wall at least this thick keeps its weight
 * exactly; a longer blend thinned the walls of an opened o.
 */
const FOLLOW_BLEND = 0.25;
/**
 * How much of the change a counter takes up and down, against across. A
 * wall can follow its counter across -- see `followCounters` -- but not up
 * or down without changing the letter's height, so there every unit of
 * counter is a unit of heavier stroke: taken in full, the bars of e, B and
 * R and the tops and bottoms of every bowl set as a bold. Opening, a little,
 * so an opened o is not only wider. Closing, none: even a third of it made
 * the tops and bottoms of the closed bowls a bold beside the stems.
 */
const COUNTER_UPRIGHT = 0.35;
const COUNTER_UPRIGHT_CLOSING = 0;
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
   * of the answer; the letter is never handed back crossed. A rounding
   * moves the outline by no more than its radius, and merges and adds points,
   * so a crossing the letter had is looked for within that of where it was.
   */
  const crossedMore = crossesMoreThan(contour, FINE_STEPS);
  for (const share of [1, 0.5, 0.25]) {
    const rounded = roundCorners(contour, radius * share, isOuter);
    if (!crossedMore(rounded, radius * share)) return rounded;
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

  const directions = nodes.map((_, index) => ({
    arriving: segmentDirection(segments[(index - 1 + count) % count], 1),
    leaving: segmentDirection(segments[index], 0),
  }));
  const isOutside = directions.map(({ arriving, leaving }) => {
    const turn = arriving.x * leaving.y - arriving.y * leaving.x;
    return turn * winding > 0;
  });
  const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
  /*
   * The inside of an elbow -- where the arm of an E turns down its stem --
   * is rounded to go round with the outside of it, less the stroke between
   * them, so the stroke keeps its thickness all the way round. Eased by only
   * a share of the radius like a junction, a large radius on a light letter
   * left the outside of every elbow a crescent far heavier than the stroke.
   */
  const elbow = (index: number): number | null => {
    const { arriving, leaving } = directions[index];
    const here = nodes[index].point;
    const half = Math.sin(Math.acos(Math.max(-1, Math.min(1, -dot(arriving, leaving)))) / 2);
    let best: number | null = null;
    nodes.forEach((other, at) => {
      if (at === index || !isOutside[at]) return;
      const them = directions[at];
      if (dot(arriving, them.leaving) > -0.95 || dot(leaving, them.arriving) > -0.95) return;
      const v = sub(other.point, here);
      if (dot(v, arriving) <= 0 || dot(v, leaving) >= 0) return;
      const stroke = Math.hypot(v.x, v.y) * half;
      if (stroke >= radius) return;
      const r = radius - stroke;
      if (best === null || r < best) best = r;
    });
    return best;
  };

  // How far each corner is cut back; nought where there is no corner.
  const cut = nodes.map((_, index) => {
    const { arriving, leaving } = directions[index];
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
    const outside = isOutside[index];
    const r = Math.min(
      outside ? radius : Math.max(radius * INSIDE_SHARE, elbow(index) ?? 0),
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
