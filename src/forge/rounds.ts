/**
 * A heavy geometric face's round strokes, thinned where they face the counter.
 *
 * The Geometric keeps its o nearly a circle at every weight (see
 * `metrics.heavyCounter` and `metrics.heavyFloor`), so past the Black it has
 * no width left to give its counters: at an Ultra the o, the e, the a, the b
 * and the figures were slots between two stems a quarter of the em wide. A
 * heavy geometric face does not open them by widening the letter. It thins
 * its round strokes at their sides, where they face the counter, and keeps
 * their outside where it was -- the o stays as round as it was and as wide,
 * and only its counter grows.
 *
 * So past the Black (`pastBlack`), on a face that asks for it
 * (`metrics.heavyThin`), each round stroke is drawn with a pen narrower
 * across by a share of the stem gained there, and its two sides moved out by
 * half that each: the outer edge of every side stays exactly where it was,
 * the inner edge moves into the counter's room. Its horizontals keep their
 * own weight, and the stems keep theirs. Nothing is added or taken away, only
 * moved, so a letter has the same points at every weight.
 */

import { inherit, type Recipe } from "./letters/common";
import { pastBlack, type Style } from "./style";
import type { SpineSegment, Stroke } from "./types";

const TINY = 1e-6;

/** The recipe with its round strokes thinned at their sides, past the Black. */
export function thinnedRounds(recipe: Recipe, style: Style): Recipe {
  const share = style.metrics.heavyThin ?? 0;
  if (share <= 0) return recipe;
  const by = pastBlack(style) * share;
  if (by <= 0) return recipe;
  // How far the letter's runs reach up and down, which tells a stem from a
  // round's own back: see `isRound`.
  const ys = recipe.strokes.flatMap((stroke) =>
    stroke.spine.segments.flatMap((one) =>
      one.kind === "line"
        ? [one.from.y, one.to.y]
        : [one.centre.y - one.radius, one.centre.y + one.radius],
    ),
  );
  const span = { low: Math.min(...ys), high: Math.max(...ys) };
  let changed = false;
  const strokes = recipe.strokes.map((stroke) => {
    const thinned = thinnedSides(stroke, by, span);
    if (thinned !== stroke) changed = true;
    return thinned;
  });
  return changed ? { ...recipe, strokes } : recipe;
}

/**
 * Whether a run is a round one: it turns through arcs, and no upright in it
 * is a stem. A stem stops on a line -- the n's leg on the baseline, the g's
 * on the x-height -- and a stem thinned would be a lighter letter rather
 * than a more open one. The back of a 6 or a 9 is an upright too, but it
 * runs on from the bowl and stops inside the letter: it is the bowl's own
 * side, and left at the stem's weight it stood into the counter as a step.
 */
function isRound(stroke: Stroke, span: { low: number; high: number }): boolean {
  const { segments } = stroke.spine;
  const arcs = segments.filter((one) => one.kind === "arc" && turns(one));
  if (arcs.length === 0) return false;
  // A dot drawn as a ring has no counter to give room to.
  const across = stroke.pen.weight / 2;
  if (arcs.some((one) => one.kind === "arc" && one.radius <= across)) return false;
  /*
   * And only a run turned on circles: a bowl, a c, an e, a parenthesis, each
   * of one or two radii. A run eased through arcs of many sizes -- the spine
   * of an S or a section mark, the hook of a question mark -- has no two
   * sides to move apart, and moved it took a length on pieces that had none
   * at some weights and not at others, and changed its points.
   */
  const radii = new Set(
    segments.flatMap((one) => (one.kind === "arc" ? [Math.round(one.radius)] : [])),
  );
  if (radii.size > 2) return false;
  // And turning one way only: a run that bends back on itself -- the hook of
  // a question mark -- is a hook, not a bowl.
  const ways = new Set(
    arcs.flatMap((one) => (one.kind === "arc" ? [one.endAngle > one.startAngle] : [])),
  );
  if (ways.size > 1) return false;
  // Nor one eased through an arc far longer than the run is, which is a
  // nearly straight piece rather than a turn.
  const ends = segments.flatMap((one) =>
    one.kind === "line"
      ? [one.from, one.to]
      : [one.startAngle, one.endAngle].map((angle) => ({
          x: one.centre.x + one.radius * Math.cos(angle),
          y: one.centre.y + one.radius * Math.sin(angle),
        })),
  );
  const extent = Math.max(
    Math.max(...ends.map((point) => point.x)) - Math.min(...ends.map((point) => point.x)),
    Math.max(...ends.map((point) => point.y)) - Math.min(...ends.map((point) => point.y)),
  );
  if (segments.some((one) => one.kind === "arc" && one.radius > extent * 2)) return false;
  // Nor a run that is mostly straight: the diagonal of an ampersand.
  const straight = segments.reduce(
    (sum, one) =>
      one.kind === "line" ? sum + Math.hypot(one.to.x - one.from.x, one.to.y - one.from.y) : sum,
    0,
  );
  const turned = segments.reduce(
    (sum, one) =>
      one.kind === "arc" ? sum + one.radius * Math.abs(one.endAngle - one.startAngle) : sum,
    0,
  );
  if (straight > turned * 2) return false;
  const inside = (y: number) => y > span.low + across && y < span.high - across;
  const last = segments.length - 1;
  return !segments.some((one, index) => {
    if (one.kind !== "line") return false;
    const rise = Math.abs(one.to.y - one.from.y);
    if (rise <= Math.abs(one.to.x - one.from.x) || rise <= across) return false;
    if (stroke.spine.closed) return false;
    const free = [...(index === 0 ? [one.from.y] : []), ...(index === last ? [one.to.y] : [])];
    return free.some((y) => !inside(y));
  });
}

function turns(segment: SpineSegment): boolean {
  return segment.kind === "arc" && Math.abs(segment.endAngle - segment.startAngle) > TINY;
}

/**
 * Which side of the round an arc lies on: one for the right, minus one for
 * the left, nought for one that crosses from one side to the other, which
 * cannot be moved apart without breaking it.
 */
function sideOf(segment: SpineSegment & { kind: "arc" }): number {
  if (!turns(segment)) return 2;
  const from = Math.cos(segment.startAngle);
  const to = Math.cos(segment.endAngle);
  const middle = Math.cos((segment.startAngle + segment.endAngle) / 2);
  const sides = [from, to, middle].filter((one) => Math.abs(one) > 1e-3);
  if (sides.every((one) => one > 0)) return 1;
  if (sides.every((one) => one < 0)) return -1;
  return 0;
}

function thinnedSides(stroke: Stroke, by: number, span: { low: number; high: number }): Stroke {
  if (!isRound(stroke, span)) return stroke;
  const { pen } = stroke;
  // Never past the pen's own narrow way, or the sides would be lighter than
  // the horizontals and the round would turn on its side.
  const along = pen.weight * (1 - Math.min(Math.max(pen.contrast, 0), 0.95));
  const weight = Math.max(pen.weight - by, along, pen.weight * 0.6);
  const less = pen.weight - weight;
  if (less <= 0.5) return stroke;
  const segments = stroke.spine.segments;
  const sides = segments.map((one) => (one.kind === "arc" ? sideOf(one) : 3));
  if (sides.includes(0)) return stroke;
  // A turn that does not turn sits at the top or the foot, between the sides:
  // it goes with whichever side comes before it.
  const n = segments.length;
  const resolved = [...sides];
  for (let pass = 0; pass < 2; pass++) {
    for (let index = 0; index < n; index++) {
      if (resolved[index] !== 2) continue;
      const before = stroke.spine.closed || index > 0 ? resolved[(index - 1 + n) % n] : 3;
      if (before === 1 || before === -1) resolved[index] = before;
    }
  }
  const centres = segments.filter((one) => one.kind === "arc" && turns(one)) as Array<
    SpineSegment & { kind: "arc" }
  >;
  const middle =
    (Math.min(...centres.map((one) => one.centre.x)) +
      Math.max(...centres.map((one) => one.centre.x))) /
    2;
  const shift = (side: number, x: number): number =>
    (side === 1 || side === -1 ? side : x >= middle ? 1 : -1) * (less / 2);
  // The arcs move with their side; a straight run takes each end from the
  // piece it is joined to, so it stretches across the top and the foot.
  // A turn that does not turn goes with the side its point is on.
  const moved: SpineSegment[] = segments.map((one, index) =>
    one.kind === "arc"
      ? {
          ...one,
          centre: {
            x:
              one.centre.x +
              shift(resolved[index], one.centre.x + one.radius * Math.cos(one.startAngle)),
            y: one.centre.y,
          },
        }
      : one,
  );
  const endOf = (one: SpineSegment, which: "start" | "end") => {
    if (one.kind === "line") return which === "start" ? one.from : one.to;
    const angle = which === "start" ? one.startAngle : one.endAngle;
    return {
      x: one.centre.x + one.radius * Math.cos(angle),
      y: one.centre.y + one.radius * Math.sin(angle),
    };
  };
  const near = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y) < 1e-3;
  for (let index = 0; index < n; index++) {
    const one = segments[index];
    if (one.kind !== "line") continue;
    const beforeIndex = index > 0 ? index - 1 : stroke.spine.closed ? n - 1 : -1;
    const afterIndex = index < n - 1 ? index + 1 : stroke.spine.closed ? 0 : -1;
    const from =
      beforeIndex >= 0 &&
      segments[beforeIndex].kind === "arc" &&
      near(endOf(segments[beforeIndex], "end"), one.from)
        ? endOf(moved[beforeIndex], "end")
        : { x: one.from.x + shift(3, one.from.x), y: one.from.y };
    const to =
      afterIndex >= 0 &&
      segments[afterIndex].kind === "arc" &&
      near(endOf(segments[afterIndex], "start"), one.to)
        ? endOf(moved[afterIndex], "start")
        : { x: one.to.x + shift(3, one.to.x), y: one.to.y };
    moved[index] = { ...one, from, to };
  }
  // A run of straight pieces between two arcs takes its ends from its
  // neighbours as they now are, so nothing is left with a gap in it.
  for (let index = 0; index < n; index++) {
    const one = moved[index];
    if (one.kind !== "line") continue;
    const beforeIndex = index > 0 ? index - 1 : stroke.spine.closed ? n - 1 : -1;
    if (beforeIndex >= 0 && moved[beforeIndex].kind === "line") {
      moved[index] = { ...one, from: endOf(moved[beforeIndex], "end") };
    }
  }
  /*
   * And never a run that would fold. Its sides are told apart by where its
   * pieces lie, which is all a ring or a c needs; a bowl drawn as two open
   * halves meeting at its top and foot, or a hood running on into a tail, has
   * pieces at that top that read as both sides at once, and moved apart they
   * sent the spine back over itself: the Grotesque a, d, q, D and 9 drawn on
   * the Geometric folded from 194 up. And a slanting piece stretched across
   * the top turns as it stretches (see `foldsBack`). Such a run is left as it
   * was drawn.
   */
  if (foldsBack(stroke.spine, moved)) return stroke;
  const contrast = 1 - along / weight;
  return inherit(stroke, {
    ...stroke,
    spine: { ...stroke.spine, segments: moved },
    pen: { ...pen, weight, contrast },
  });
}

type Point = { x: number; y: number };

function pointAt(one: SpineSegment, which: "start" | "end"): Point {
  if (one.kind === "line") return which === "start" ? one.from : one.to;
  const angle = which === "start" ? one.startAngle : one.endAngle;
  return {
    x: one.centre.x + one.radius * Math.cos(angle),
    y: one.centre.y + one.radius * Math.sin(angle),
  };
}

/** Which way a piece travels at one of its ends, or null for a line with no length. */
function headingAt(one: SpineSegment, which: "start" | "end"): Point | null {
  if (one.kind === "line") {
    const dx = one.to.x - one.from.x;
    const dy = one.to.y - one.from.y;
    const length = Math.hypot(dx, dy);
    return length > TINY ? { x: dx / length, y: dy / length } : null;
  }
  const angle = which === "start" ? one.startAngle : one.endAngle;
  const way = one.sweepPositive ? 1 : -1;
  return { x: -Math.sin(angle) * way, y: Math.cos(angle) * way };
}

const apart = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Whether a run, moved apart at its sides, would sweep into a fold: it comes
 * apart where it was joined, a straight piece now runs against the way the
 * run went there as drawn, or a join turns by more or less than it did.
 */
function foldsBack(spine: Stroke["spine"], moved: SpineSegment[]): boolean {
  const { segments, closed } = spine;
  const n = segments.length;
  const at = (index: number): number =>
    index >= 0 && index < n ? index : closed ? (index + n) % n : -1;
  for (let index = 0; index < n; index++) {
    const after = at(index + 1);
    if (after < 0) continue;
    const joined = apart(pointAt(segments[index], "end"), pointAt(segments[after], "start")) < 1e-3;
    if (joined && apart(pointAt(moved[index], "end"), pointAt(moved[after], "start")) >= 1e-3) {
      return true;
    }
  }
  for (let index = 0; index < n; index++) {
    const going = moved[index].kind === "line" ? headingAt(moved[index], "start") : null;
    if (!going) continue;
    // The way the run went here: the piece's own way, or for one drawn with
    // no length, the way of the nearest piece before it, or after it, that
    // has one.
    let was = headingAt(segments[index], "start");
    for (let step = 1; !was && step < n; step++) {
      const before = at(index - step);
      const after = at(index + step);
      if (before < 0 && after < 0) break;
      was =
        (before >= 0 ? headingAt(segments[before], "end") : null) ??
        (after >= 0 ? headingAt(segments[after], "start") : null);
    }
    if (was && going.x * was.x + going.y * was.y < -TINY) return true;
  }
  /*
   * Nor a join bent where it was not. The arcs only move, so they keep their
   * way; a slanting straight piece whose two ends move apart turns as it
   * stretches, and where it ran into a turn it was tangent to it now met it
   * at a hair of a corner -- which, on the inside of the turn, the sweep
   * draws as a fold: the Grotesque a's top on the Geometric, from 230 up.
   */
  const bend = (pieces: SpineSegment[], index: number): number => {
    let out: Point | null = null;
    for (let step = 0; !out && step < n; step++) {
      const before = at(index - step);
      if (before < 0) break;
      out = headingAt(pieces[before], "end");
    }
    let into: Point | null = null;
    for (let step = 1; !into && step <= n; step++) {
      const after = at(index + step);
      if (after < 0) break;
      into = headingAt(pieces[after], "start");
    }
    return out && into ? out.x * into.y - out.y * into.x : 0;
  };
  for (let index = 0; index < n; index++) {
    if (at(index + 1) < 0) continue;
    const was = bend(segments, index);
    const now = bend(moved, index);
    if (Math.abs(now - was) > 1e-6) return true;
  }
  return false;
}
