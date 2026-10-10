/**
 * Bottom-heavy bowls: a bowl's inner side moved off its centre-line, so the
 * stroke is thinner across its top and heavier across its foot.
 *
 * A pen of one shape draws a bowl as heavy at the crown as at the foot,
 * whatever its angle, because its width across a stroke depends only on which
 * way the stroke runs and a bowl runs both ways. Moving the whole inner side
 * by one vector keeps everything exact -- a line stays a line and an ellipse
 * keeps its radii about a moved centre -- and keeps every weld, since the side
 * moves together; and the width it changes goes with the direction of travel,
 * which is the cos-shaped swell a written bowl has.
 *
 * Switched on by `parts.bowl.heft`, which no base sets: a stroke without
 * `Stroke.heft` never reaches anything here.
 */

import type { Vec2 } from "@/font/types";
import type { Style } from "./style";
import {
  cutAlong,
  ellipseAt,
  type Headed,
  moving,
  type OffsetSegment,
  offsetEnd,
  offsetStart,
  type PenReach,
  piecesFor,
  reachAlong,
} from "./sweep";
import type { Stroke } from "./types";

/**
 * Which side of a stroke is the inside of its turning: one for the left of
 * its direction of travel, minus one for the right, nought where it does not
 * turn -- no arcs, or arcs that turn as far one way as the other.
 *
 * Read off the skeleton, by the sign of the arcs' signed sweeps added up, so it
 * is the same at every weight.
 */
export function innerSide(headed: Headed[]): -1 | 0 | 1 {
  let turned = 0;
  for (const { segment } of headed) {
    if (segment.kind !== "arc") continue;
    const sweep = Math.abs(segment.endAngle - segment.startAngle);
    turned += segment.sweepPositive ? sweep : -sweep;
  }
  return turned > 0 ? 1 : turned < 0 ? -1 : 0;
}

/**
 * How far the inner side moves: `heft.share` of the stroke's width in the
 * direction `heft.tilt` degrees off straight up (positive to the right), and
 * never more than 1.2 times the pen's narrow reach, so the inner side cannot
 * reach the outer one. Nothing for a stroke with no heft.
 */
export function heftShift(stroke: Stroke, reach: PenReach): Vec2 {
  const heft = stroke.heft;
  if (!heft) return { x: 0, y: 0 };
  const tilt = (heft.tilt * Math.PI) / 180;
  const way = { x: Math.sin(tilt), y: Math.cos(tilt) };
  const pen = reachAlong(way, reach);
  const width = 2 * Math.abs(pen.x * way.x + pen.y * way.y);
  const by = Math.min(heft.share * width, 1.2 * reach.along);
  return { x: way.x * by, y: way.y * by };
}

/**
 * The two side runs of a stroke with its inner side moved by `heftShift`, as
 * new runs: the runs given, and their pieces, are left as they were, since
 * the sweep compares the two (see `sidesAt` in sweep.ts).
 *
 * Every piece of the inner side is moved by the one vector -- a straight run's
 * two ends, an ellipse's centre, and the stalls and wedges filling its corners
 * with them -- so every weld along the side still holds, and a ring's counter
 * is the same counter set off its middle.
 *
 * An open stroke's ends would then be cut on a slant: the inner corner moved
 * and the outer one not. So at each end the inner side is carried on, or
 * brought back, along its own curve until its corner lies on the line the end
 * was cut along before the move -- the line through the outer corner and the
 * inner corner as the pen put it -- which is `cutAlong` asked about that
 * line. Never further than twice the move: a side that would have to go
 * further than that to meet the line, or does not meet it at all, keeps its
 * corner where the move left it. The pieces are the same either way. An end
 * whose own cut brings both corners to its line is left to that cut: see
 * `cutsItself`.
 */
export function hefted(
  stroke: Stroke,
  headed: Headed[],
  left: OffsetSegment[],
  right: OffsetSegment[],
  reach: PenReach,
): [OffsetSegment[], OffsetSegment[]] {
  const side = innerSide(headed);
  if (side === 0) return [left, right];
  const shift = heftShift(stroke, reach);
  const plain = side > 0 ? left : right;
  const outer = side > 0 ? right : left;
  const fade = stroke.heft?.fade;
  const inner = fade ? faded(plain, shift, fade) : plain.map((one) => movedBy(one, shift));
  if (!stroke.spine.closed) {
    const most = 2 * Math.hypot(shift.x, shift.y);
    for (const atEnd of [false, true]) {
      if (cutsItself(atEnd ? stroke.end : stroke.start)) continue;
      squared(inner, plain, outer, atEnd, most);
    }
  }
  return side > 0 ? [inner, right] : [left, inner];
}

/**
 * Whether an end's own cut puts both corners on its line, whatever the sides
 * do before it: a level cut, or a cut aligned to the line or the upright,
 * which slide each corner along its side to the line (`terminalNodes`), or
 * carry each side along its curve to it (`cutAlong`). Such an end is square
 * already, and squaring it first only sends the inner corner round its curve
 * before the cut slides it on again, along a side turned by the trip -- on a
 * Black e's bar, under the bowl's own foot.
 *
 * Decided by the terminal alone, so it is the same at every weight.
 */
function cutsItself(terminal: Stroke["start"]): boolean {
  return terminal.kind !== "round" && (terminal.level === true || terminal.aligned === true);
}

/**
 * The inner side of a bowl standing against a stem, its heft faded toward
 * that stem (`Stroke.heft.fade`): moved by the whole of `shift` at the side
 * of the counter away from the stem, by `1 - share` of it at the stem's own
 * side, and in between in proportion to how far across the counter it lies.
 *
 * One affine map of the whole side -- a shear along `shift` growing across
 * the counter -- rather than a move piece by piece, so it is as exact as the
 * plain heft: a line stays a line, an ellipse an ellipse turned and
 * stretched to its image, and every weld and every smooth join between
 * pieces holds, since all of them go through the same map. Each piece keeps
 * its pieces. How far across the counter reaches is measured on the side as
 * the pen drew it, at a fixed number of points a piece.
 */
function faded(
  plain: OffsetSegment[],
  shift: Vec2,
  fade: { side: 1 | -1; share: number },
): OffsetSegment[] {
  let low = Infinity;
  let high = -Infinity;
  for (const one of plain) {
    const points =
      one.kind === "line"
        ? [one.from, one.to]
        : Array.from({ length: FADE_SAMPLES + 1 }, (_, k) =>
            ellipseAt(one, one.from + ((one.to - one.from) * k) / FADE_SAMPLES),
          );
    for (const point of points) {
      low = Math.min(low, point.x);
      high = Math.max(high, point.x);
    }
  }
  const span = high - low;
  if (!(span > 1e-6)) return plain.map((one) => movedBy(one, shift));
  const stem = fade.side < 0 ? low : high;
  // How much of `shift` a point takes: `a + b x`, `1 - share` at the stem and one across from it.
  const b = (fade.share * -fade.side) / span;
  const a = 1 - fade.share - b * stem;
  const map = (point: Vec2): Vec2 => {
    const by = a + b * point.x;
    return { x: point.x + shift.x * by, y: point.y + shift.y * by };
  };
  // The map's linear part: the identity, and `shift` grown by `b` for every unit across.
  const l00 = 1 + shift.x * b;
  const l10 = shift.y * b;
  return plain.map((one): OffsetSegment => {
    if (one.kind === "line") return { kind: "line", from: map(one.from), to: map(one.to) };
    /*
     * The ellipse's own axes carried through the map, B = L R(rotation)
     * diag(rx, ry), and written again as R(rotation') diag(rx', ry') R(turn):
     * its new axes, and its parameter turned by `turn`, so each of its points
     * is the image of the point it was.
     */
    const cos = Math.cos(one.rotation);
    const sin = Math.sin(one.rotation);
    const b00 = l00 * cos * one.rx;
    const b01 = -l00 * sin * one.ry;
    const b10 = l10 * cos * one.rx + sin * one.rx;
    const b11 = -l10 * sin * one.ry + cos * one.ry;
    const e = (b00 + b11) / 2;
    const f = (b00 - b11) / 2;
    const g = (b10 + b01) / 2;
    const h = (b10 - b01) / 2;
    const q = Math.hypot(e, h);
    const r = Math.hypot(f, g);
    const first = Math.atan2(g, f);
    const second = Math.atan2(h, e);
    const turn = (second - first) / 2;
    return {
      ...one,
      centre: map(one.centre),
      rotation: (second + first) / 2,
      rx: q + r,
      ry: q - r,
      from: one.from + turn,
      to: one.to + turn,
      pieces: one.pieces ?? piecesFor(one.to - one.from),
    };
  });
}

/** How many points along each ellipse piece a faded side's reach across is measured at. */
const FADE_SAMPLES = 32;

/** One side piece moved whole: a run's ends, or an ellipse's centre. */
function movedBy(one: OffsetSegment, by: Vec2): OffsetSegment {
  const moved = (point: Vec2): Vec2 => ({ x: point.x + by.x, y: point.y + by.y });
  return one.kind === "line"
    ? { kind: "line", from: moved(one.from), to: moved(one.to) }
    : { ...one, centre: moved(one.centre) };
}

/**
 * The moved inner side at one end brought back onto the line that end was cut
 * along, in place: see `hefted`. `most` is how far the corner may travel to
 * get there, in units.
 */
function squared(
  inner: OffsetSegment[],
  plain: OffsetSegment[],
  outer: OffsetSegment[],
  atEnd: boolean,
  most: number,
): void {
  const endOf = (run: OffsetSegment[]): Vec2 =>
    atEnd ? offsetEnd(run[run.length - 1]) : offsetStart(run[0]);
  const corner = endOf(outer);
  const was = endOf(plain);
  const along = { x: corner.x - was.x, y: corner.y - was.y };
  const across = Math.hypot(along.x, along.y);
  if (across < 1e-9) return;
  const normal = { x: -along.y / across, y: along.x / across };
  const value = normal.x * corner.x + normal.y * corner.y;
  // The last piece of the side that goes anywhere, from this end.
  const order = atEnd ? [...inner.keys()].reverse() : [...inner.keys()];
  const found = order.findIndex((index) => moving(inner[index]));
  if (found < 0) return;
  const index = order[found];
  const piece = inner[index];
  if (piece.kind === "ellipse") {
    /*
     * Carried on along its own curve, or brought back along it and, where the
     * line lies further back than the last piece reaches, along the pieces
     * before it no further than the corner may travel: those it passes are
     * left standing on the new end at no length, as an aligned cut leaves
     * them, so the side keeps its points. Tried on a copy, and kept only where
     * the corner has travelled no further than it may.
     */
    const trial = [...inner];
    const cut = cutAlong(trial, atEnd, { normal, value }, most);
    if (!cut) return;
    cut();
    const from = endOf(inner);
    const to = endOf(trial);
    if (Math.hypot(to.x - from.x, to.y - from.y) > most) return;
    inner.splice(0, inner.length, ...trial);
    return;
  }
  // A straight piece: its end moved along it to the line, past it or short of it.
  const run = { x: piece.to.x - piece.from.x, y: piece.to.y - piece.from.y };
  const rate = normal.x * run.x + normal.y * run.y;
  if (Math.abs(rate) < 1e-12) return;
  const share = (value - normal.x * piece.from.x - normal.y * piece.from.y) / rate;
  const length = Math.hypot(run.x, run.y);
  const travel = (atEnd ? share - 1 : share) * length;
  if (Math.abs(travel) > most || (atEnd ? share <= 1e-6 : share >= 1 - 1e-6)) return;
  const tip = { x: piece.from.x + run.x * share, y: piece.from.y + run.y * share };
  inner[index] = atEnd
    ? { kind: "line", from: piece.from, to: tip }
    : { kind: "line", from: tip, to: piece.to };
  // Whatever lay past it, of no length, is left standing on the new end.
  for (const other of order.slice(0, found)) {
    const one = inner[other];
    inner[other] =
      one.kind === "line"
        ? { kind: "line", from: tip, to: tip }
        : { ...one, centre: tip, rx: 0, ry: 0 };
  }
}

/**
 * A stroke given the style's heft, where it takes one: every closed spine,
 * and every stroke its recipe marked `heftable`, while `parts.bowl.heft` is
 * above nought. The same stroke, untouched, everywhere else.
 */
export function withHeft(stroke: Stroke, style: Style): Stroke {
  const share = style.parts.bowl.heft ?? 0;
  if (!(share > 0) || !(stroke.spine.closed || stroke.heftable)) return stroke;
  const tilt = style.parts.bowl.heftTilt ?? 0;
  // Faded toward a stem the recipe says the bowl stands against: see `faded`.
  const fade = style.parts.bowl.heftFade ?? 0;
  if (fade > 0 && stroke.stemSide !== undefined) {
    return {
      ...stroke,
      heft: { share, tilt, fade: { side: stroke.stemSide, share: Math.min(1, fade) } },
    };
  }
  return { ...stroke, heft: { share, tilt } };
}
