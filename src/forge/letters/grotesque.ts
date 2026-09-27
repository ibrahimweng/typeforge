/**
 * The neo-grotesque's own letters.
 *
 * Most of the alphabet a neo-grotesque shares with every other sans here: the
 * n, the o and the H are the same skeletons at its own proportions. A handful
 * it draws differently, and they are most of what makes one look like one --
 * the two-storey a with a spur at its foot, the single-storey g whose tail
 * runs down the stem and hooks flat under the bowl, the y whose right arm runs
 * straight on into a short flat foot, the G with its bar and its upright, the
 * R whose leg comes down out of the bowl, the wide J with no descender, the t
 * whose foot turns out along the line, the one with a curved flag, the seven
 * whose stroke settles upright, and the ampersand and question mark as Geist
 * draws them.
 *
 * And, measured the same way, the rest of what a neo-grotesque draws its own
 * way: the figures, proportional and each on Geist's skeleton; every diagonal
 * cut level with flat vertices (v w A V W Y M N K k z Z); the flat-sided bowls
 * of the B, the P and the R; the ring cut level at Geist's heights (c e C G);
 * the s and the S on a straight spine; and the marks (! ' " ( ) - / # % @).
 * Where a heavy weight goes past Geist Black (a stem of 172), each is held
 * open by what the pen needs rather than by the measurement.
 *
 * Each is measured off Geist Regular and written in terms of the frame, so it
 * follows the pen, the width and the proportions like every other letter:
 * horizontal measures in units of the o's own half-width (the capital O's for
 * the capitals), heights against the lines they are drawn to, and every turn
 * held to what the pen can go round. And each is the same pieces at every
 * weight, so a weight axis can run through it.
 */

import type { Vec2 } from "@/font/types";
import type { Style } from "../style";
import { LETTERS } from "../letters";
import { bowlPoint, spineEnd, spineStart } from "../shapes";
import { penReach, reachAlong } from "../sweep";
import type { Spine, SpineArc, Stroke } from "../types";
import {
  arm,
  at,
  bend,
  BUTT,
  chain,
  dot,
  headingAt,
  finish,
  type Frame,
  frame,
  heaviness,
  inherit,
  ink,
  LEVEL,
  pointOn,
  type Recipe,
  ring,
  stopRadius,
  straight,
  thin,
  trough,
  turn,
  turnedStroke,
  uses,
} from "./common";

/*
 * A letter here is drawn in Geist's own units, so the width the face fits its
 * plain forms to (`metrics.proportions`, which arrives as `stretch`) is taken
 * back out: it is already in the drawing.
 */
const unstretched = (f: Frame): number => f.style.metrics.stretch ?? 1;
/** How wide a lowercase letter is against Geist's, per unit of its o. */
const small = (f: Frame): number => f.bowl / 199 / unstretched(f);
/** The same for a capital, per unit of its O. */
const large = (f: Frame): number => f.capBowl / 280 / unstretched(f);

/** Where the Sans sets its crossbar control: a bar drawn at Geist's height sits here. */
const SANS_CROSSBAR = 0.52;

/** A turn, never tighter than the pen will go round. */
const held = (f: Frame, radius: number): number => Math.max(radius, f.least);

/** A turn drawn in so many pieces at every weight: see `SpineArc.pieces`. */
function pinned(spine: Spine, pieces: number): Spine {
  return { ...spine, segments: spine.segments.map((one) => ({ ...one, pieces })) };
}

/**
 * The two-storey a: a flat-topped bowl hung off the stem, an arch over it from
 * a terminal cut level, and the stem turning out along the baseline into a
 * short spur.
 *
 * The bowl is a whole ring whose right side runs down the middle of the stem,
 * so where it meets the stem at its top and its foot the ink thins by itself
 * -- the notch every grotesque cuts there -- and nothing has to be drawn to
 * make it.
 */
export function grotesqueA(style: Style): Recipe {
  // A joined hand draws its own a, whose bowl is what the join runs into.
  if (style.parts.script.on) return LETTERS.a(style);
  const f = frame(lighterAcross(style));
  const u = small(f);
  const left = f.edge;
  const stem = left + 353 * u;
  const crest = f.crest(f.x);
  const foot = f.sits(0);
  const bottom = f.dip(0);
  /*
   * At a heavy weight the bowl is drawn with a lighter pen than the stem and
   * the arch, as a Black's is: two counters stacked in one x-height leave the
   * bowl's the smaller, and at the stem's weight it closed to a slit.
   */
  const heavy = Math.min(1, heaviness(f));
  const bowlPen = { ...f.style.pen, weight: f.style.pen.weight * (1 - 0.22 * heavy) };
  const bowlLeast = (bowlPen.weight / 2) * 1.06;
  /*
   * Past the Black its turns are held to what its own pen goes round, not
   * the stem's (see \`holds\` in \`shapes.ts\`), or an Ultra's bowl was drawn
   * taller than asked and hung below the line.
   */
  const past = Math.min(1, Math.max(0, (heaviness(f) - 0.67) / 0.3));
  const bf: Frame = { ...f, half: f.half - (f.half - bowlPen.weight / 2) * past };
  // The arch: from a terminal on its left, over a flat crest into the stem.
  const room = crest - bottom;
  const archHalf = held(f, Math.min((101 / 530) * f.x, room * 0.3));
  const archCentre = at((left + 9 * u + stem) / 2, crest - archHalf);
  const archWide = (stem - left - 9 * u) / 2;
  // The bowl: its top well under the arch's terminal, its foot on the line.
  const top = Math.min(
    bottom + (244 / 530) * f.x,
    Math.max(archCentre.y - f.half * 1.3 - f.upright, bottom + room * 0.44),
  );
  const bowlHalf = Math.max((top - bottom) / 2, bowlLeast);
  // Carried down by what its lighter pen leaves short of the line, so its foot overshoots as an o's does.
  const drop = (f.upright - (bowlPen.weight * (1 - bowlPen.contrast)) / 2) * past;
  const bowlCentre = at((left + stem) / 2, bottom + bowlHalf - drop);
  const spur = held(f, 50 * u);
  const reach = Math.max(stem + spur + f.half * 0.7, stem + 96 * u);
  /*
   * The bowl leaves the stem well up and runs down across the letter in a
   * straight line onto its round left side, as Geist's does -- a bowl whose
   * top rises to the stem rather than lying level -- then round the foot and
   * back into the stem.
   */
  const bowlWide = (stem - left) / 2;
  const joinY = Math.min(top + (60 / 530) * f.x, (top + archCentre.y) / 2);
  const quarter = bend(bf, bowlCentre, bowlHalf, 90, 180, bowlWide);
  // Where a heavy pen has brought the arch down onto the bowl, the bowl
  // leaves the stem a little higher, so the line still has a tangent to run on.
  let from = at(stem, joinY);
  let onto = tangentFrom(from, quarter, 1);
  for (let pass = 1; pass <= 12 && !onto; pass++) {
    from = at(stem, joinY + pass * f.half * 0.25);
    onto = tangentFrom(from, quarter, 1);
  }
  const bowlRun = chain(
    straight(from, onto ? spineStart(onto.run) : spineStart(quarter)),
    onto ? onto.run : quarter,
    bend(bf, bowlCentre, bowlHalf, 180, 270, bowlWide),
    bend(bf, bowlCentre, bowlHalf, 270, 340, bowlWide),
  );
  const bowl = ink(f, bowlRun);
  return finish(f, [
    inherit(bowl, { ...bowl, pen: bowlPen }),
    ink(
      f,
      chain(
        bend(f, archCentre, archHalf, 180, 90, archWide),
        bend(f, archCentre, archHalf, 90, 0, archWide),
        straight(at(stem, archCentre.y), at(stem, foot + spur)),
        pinned(turn(at(stem + spur, foot + spur), spur, 180, 270), 1),
        straight(at(stem + spur, foot), at(reach, foot)),
      ),
      f.end,
      f.end,
    ),
  ]);
}

/**
 * The single-storey g: a bowl whose right side is the stem, and the stem
 * carried on under the line and round in a flat hook to a terminal cut level
 * under the bowl's left side.
 */
export function grotesqueG(style: Style): Recipe {
  const f = frame(lighterAcross(style));
  const u = small(f);
  const left = f.edge;
  const stem = left + 385 * u;
  const top = f.crest(f.x);
  // The bowl stands a little off the baseline: its foot is at 28, not -12.
  const bottom = Math.min(f.dip(0) + (40 / 530) * f.x, top - f.least * 2);
  const bowlHalf = (top - bottom) / 2;
  const floor = f.dip(f.desc);
  /*
   * The hook: down the stem and round under the bowl in one superelliptic
   * turn, deeper on the stem's side than on the terminal's, to an end cut
   * level just under the baseline -- Geist's, which is round rather than a
   * flat foot, and stays round at a Black instead of closing to a slab.
   */
  const H = (y: number) => (y / 530) * f.x;
  const hookX = left + 204 * u;
  const hookW = held(f, 181 * u);
  const rightY = Math.max(H(40), floor + f.least);
  const leftY = Math.max(H(-25), floor + f.least);
  const rightC = at(hookX, rightY);
  const leftC = at(hookX, leftY);
  const end =
    angleAt(f, leftC, hookW, leftY - floor, Math.max(H(-20), leftY - (leftY - floor) * 0.2), true) -
    360;
  return {
    ...finish(f, [
      ink(f, ring(f, at((left + stem) / 2, bottom + bowlHalf), (stem - left) / 2, bowlHalf)),
      ink(
        f,
        chain(
          straight(at(stem, f.x), at(stem, rightY)),
          bend(f, rightC, rightY - floor, 0, -90, stem - hookX),
          bend(f, leftC, leftY - floor, -90, end, hookW),
        ),
        f.end,
        f.end,
      ),
    ]),
    air: 0.2,
  };
}

/**
 * The y: a vee whose right arm carries straight on under the line and turns
 * out into a short flat foot, cut upright.
 */
export function grotesqueY(style: Style): Recipe {
  const f = frame(style);
  const u = small(f);
  const left = f.edge;
  // Geist's arms meet at 229 across a letter 494 wide: the vee is even.
  const leftTop = at(left + 23 * u, f.x);
  const rightTop = at(left + 425 * u, f.x);
  const apex = at(left + 212 * u, f.half * 0.2);
  const heading = {
    x: apex.x - rightTop.x,
    y: apex.y - rightTop.y,
  };
  const length = Math.hypot(heading.x, heading.y);
  const dir = { x: heading.x / length, y: heading.y / length };
  const floor = f.sits(f.desc);
  const radius = held(f, 58 * u);
  // Where the arm turns: the knee, whose turn lands its foot on the floor.
  // Turning right, from the arm's heading round to due left.
  const centreY = floor + radius;
  const normal = { x: -dir.y, y: dir.x };
  // The centre lies to the right of the arm's direction of travel.
  const side = { x: dir.y, y: -dir.x };
  const kneeY = centreY - radius * side.y;
  const along = (kneeY - rightTop.y) / dir.y;
  const knee = at(rightTop.x + dir.x * along, kneeY);
  const centre = at(knee.x + radius * side.x, centreY);
  void normal;
  const from = (Math.atan2(knee.y - centre.y, knee.x - centre.x) * 180) / Math.PI;
  // Standing out past the arm by a share of the pen, or at an Ultra the foot
  // was a ledge a few units wide under the turn.
  const toe = Math.min(
    left + 70 * u,
    centre.x - 1 - f.half * 0.5 * Math.max(0, heaviness(f) - 0.67),
  );
  /*
   * Past the Black the left arm stops inside the right one, where the two
   * spines cross. A heavy pen's square end past the crossing
   * stood out beside the right arm as a step.
   */
  let end = at(apex.x + dir.x * -f.half * 0.4, apex.y + dir.y * -f.half * 0.4);
  const lx = apex.x - leftTop.x;
  const ly = apex.y - leftTop.y;
  const det = lx * dir.y - ly * dir.x;
  if (Math.abs(det) > 1e-9) {
    const s = ((rightTop.x - leftTop.x) * dir.y - (rightTop.y - leftTop.y) * dir.x) / det;
    const cross = at(leftTop.x + lx * s, leftTop.y + ly * s);
    const k = Math.min(1, Math.max(0, (heaviness(f) - 0.67) / 0.3));
    if (cross.y > end.y && s > 0 && s < 1)
      end = at(end.x + (cross.x - end.x) * k, end.y + (cross.y - end.y) * k);
  }
  return finish(f, [
    ink(f, straight(leftTop, end), f.end, BUTT),
    ink(
      f,
      chain(
        straight(rightTop, knee),
        pinned(turn(centre, radius, from, -90), 1),
        straight(at(centre.x, floor), at(toe, floor)),
      ),
      f.end,
      // The face's own cut and never a serif: a beak on a foot this short
      // stands out past the turn it hangs from.
      f.plain,
    ),
  ]);
}

/**
 * The G: the C's ring, carried round its foot into an upright that stands
 * on the baseline under a bar at the stem's weight, as Geist's is.
 */
export function grotesqueCapitalG(style: Style): Recipe {
  const f = frame(style);
  const [u, t] = spread(f);
  const lerp = (a: number, b: number) => a + (b - a) * Math.min(t, 1.5);
  const X = (x: number) => f.edge - f.half + x * u;
  const middle = (f.crest(f.cap) + f.dip(0)) / 2;
  const halfH = held(f, f.crest(f.cap) - middle);
  const halfW = held(f, lerp(273, 253) * u);
  const centre = at(f.edge + halfW, middle);
  const head = angleAt(f, centre, halfW, halfH, up(f, lerp(500, 470)), false);
  // The upright stands inside the ring's own right side, and the ring's
  // lower right is drawn in to run into it.
  const upright = Math.max(X(lerp(563, 578)), centre.x + f.least);
  const drawnIn = upright - centre.x;
  const bar = up(f, 318);
  const foot = angleAt(f, centre, drawnIn, halfH, Math.min(up(f, 200), bar - f.half), false);
  return finish(f, [
    ink(
      f,
      chain(
        bend(f, centre, halfH, head, 270, halfW),
        bend(f, centre, halfH, 270, 360 + foot, drawnIn),
      ),
      f.end,
      BUTT,
    ),
    ink(f, straight(at(X(lerp(322, 344)), bar), at(upright, bar)), BUTT, BUTT),
    ink(f, straight(at(upright, bar + f.upright), at(upright, 0)), BUTT, f.end),
  ]);
}

/**
 * The Q: the O, and a straight tail from inside the bowl out through its
 * foot, cut level at both ends, as Geist's is.
 */
export function grotesqueCapitalQ(style: Style): Recipe {
  const f = frame(style);
  const [u, t] = spread(f);
  const lerp = (a: number, b: number) => a + (b - a) * Math.min(t, 1.5);
  const X = (x: number) => f.edge - f.half + x * u;
  const ring = LETTERS.O(style).strokes;
  return finish(
    f,
    [
      ...ring,
      ink(
        f,
        straight(
          // Past the Black the tail starts lower, under a counter that has shut down onto it.
          at(X(lerp(339.5, 350)), up(f, lerp(200, 260) - 90 * Math.max(0, t - 1))),
          at(X(lerp(548, 598.7)), up(f, lerp(-69, -59))),
        ),
        LEVEL,
        LEVEL,
      ),
    ],
    true,
  );
}

/**
 * A bowl hung on a stem: flat along its top from the stem, round at the
 * right, and flat back to the stem along its foot -- the bowls of the B, the
 * P and the R, which Geist draws flat-sided and superelliptic.
 */
function lobeRun(
  f: Frame,
  stem: number,
  top: number,
  bottom: number,
  right: number,
  flat: number,
): Spine {
  const half = held(f, (top - bottom) / 2);
  const wide = held(f, Math.min(flat, right - stem - f.half));
  // Level with its top line always: where the pen leaves the bowl less room
  // than it will go round, the foot runs on down into the ink below it.
  const centre = at(right - wide, top - half);
  return chain(
    straight(at(stem, top), at(centre.x, top)),
    bend(f, centre, half, 90, -90, wide),
    straight(at(centre.x, centre.y - half), at(stem, centre.y - half)),
  );
}

/** The B: two such bowls, the lower the wider, meeting at a waist below the middle. */
export function grotesqueCapitalB(style: Style): Recipe {
  const f = frame(style);
  const [u, t] = spread(f);
  const lerp = (a: number, b: number) => a + (b - a) * Math.min(t, 1.5);
  const stem = f.edge;
  const X = (x: number) => stem + x * u;
  const waist = up(f, lerp(360, 380));
  return finish(f, [
    ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
    ink(f, lobeRun(f, stem, f.hangs(f.cap), waist, X(lerp(409, 392)), 150 * u)),
    /*
     * Its top half a unit under the upper's foot: drawn on exactly the same
     * line, the two bars' edges coincided and a union of the letter -- which
     * is how its counters are counted, and how it is exported -- lost the
     * lower counter at some weights.
     */
    ink(f, lobeRun(f, stem, waist - 0.5, f.sits(0), X(lerp(439, 423)), 160 * u)),
  ]);
}

/** The P: the R's bowl, a little deeper, on its stem. */
export function grotesqueCapitalP(style: Style): Recipe {
  const f = frame(style);
  const [u, t] = spread(f);
  const lerp = (a: number, b: number) => a + (b - a) * Math.min(t, 1.5);
  const stem = f.edge;
  return finish(f, [
    ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
    ink(
      f,
      lobeRun(f, stem, f.hangs(f.cap), up(f, lerp(330, 305)), stem + lerp(419, 401) * u, 160 * u),
    ),
  ]);
}

/**
 * The R: the P's bowl, flat along the top and the waist and round at the
 * right, and a leg that leaves the waist inside the bowl, turns down and runs
 * nearly upright to a foot cut level on the baseline, as Geist's does.
 */
export function grotesqueR(style: Style): Recipe {
  const f = frame(style);
  const [u, t] = spread(f);
  const lerp = (a: number, b: number) => a + (b - a) * Math.min(t, 1.5);
  const stem = f.edge;
  const X = (x: number) => stem + x * u;
  const top = f.hangs(f.cap);
  const waist = up(f, lerp(343, 330));
  const lobeHalf = held(f, (top - waist) / 2);
  const right = X(lerp(423, 411));
  const lobeWide = held(f, Math.min(160 * u, right - stem - f.half));
  const lobe = at(right - lobeWide, waist + lobeHalf);
  // The leg: out of the waist, round a turn, and down to its foot.
  const foot = at(X(lerp(430.5, 415)), 0);
  const radius = held(f, Math.min(150 * u, (waist - f.half) * 0.7));
  // Its turn set so the leg comes down leaning a little out, as Geist's does.
  const centre = at(foot.x - radius - 0.09 * (waist - radius), waist - radius);
  const from = centre.x;
  const base = Math.atan2(foot.y - centre.y, foot.x - centre.x);
  const apart = Math.acos(Math.min(1, radius / Math.hypot(foot.x - centre.x, foot.y - centre.y)));
  // Of the two tangents from the foot, the one on the outside of the turn.
  const turnTo =
    ((Math.cos(base + apart) > Math.cos(base - apart) ? base + apart : base - apart) * 180) /
    Math.PI;
  const off = pointOn(centre, radius, turnTo);
  return finish(f, [
    ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
    ink(
      f,
      chain(
        straight(at(stem, top), at(lobe.x, top)),
        bend(f, lobe, lobeHalf, 90, -90, lobeWide),
        straight(at(lobe.x, waist), at(stem, waist)),
      ),
    ),
    ink(
      f,
      chain(
        straight(at(Math.min(from, lobe.x) - radius * 0.2, waist), at(from, waist)),
        pinned(turn(centre, radius, 90, turnTo), 1),
        straight(off, foot),
      ),
      BUTT,
      f.end,
    ),
  ]);
}

/**
 * The J: an upright down the right, turning under in a wide flat hook that
 * comes back up to a terminal cut level. No descender.
 */
export function grotesqueJ(style: Style): Recipe {
  const f = frame(style);
  // From the left of the ink: the stem's middle 410 in on the Regular and 454
  // on the Black, the hook's 228 and 271, run on past the Black as the pen
  // grows so the hook keeps its counter.
  const [X, lerp] = squared(f);
  const stem = X(lerp(410, 454));
  const bottom = f.dip(0);
  const centreX = X(lerp(227.5, 270.5));
  const hookHalf = held(f, (221 / 710) * f.cap - f.gain * 0.3);
  const centre = at(centreX, bottom + hookHalf);
  return finish(f, [
    ink(
      f,
      chain(
        straight(at(stem, f.cap), at(stem, centre.y)),
        bend(f, centre, hookHalf, 0, -90, stem - centreX),
        bend(f, centre, hookHalf, -90, -180, stem - centreX),
      ),
      f.end,
      f.end,
    ),
  ]);
}

/**
 * The t: a stem cut level above the x-height, a bar across it, and the foot
 * turning out along the baseline to an upright cut.
 */
export function grotesqueT(style: Style): Recipe {
  const f = frame(style);
  const [X, lerp] = squared(f);
  const H = (y: number) => (y / 530) * f.x;
  // Measured from the left of the bar: Geist's stem stands 120 in on the
  // Regular and 175 on the Black, and the bar and the foot run to 305 and 303
  // there, 402 and 402 here.
  const stem = X(lerp(120, 175));
  const foot = f.sits(0);
  const radius = held(f, lerp(106, 150) * (X(1) - X(0)));
  const toe = Math.max(X(lerp(303, 402)), stem + radius + f.half * 0.2);
  // Its top edge a little over the x-height at a Black, as Geist's is.
  const bar = f.hangs(H(Math.min(lerp(530, 538), 538)), f.bar);
  const head = H(Math.min(lerp(650, 664), 664));
  return finish(f, [
    ink(
      f,
      chain(
        straight(at(stem, head), at(stem, foot + radius)),
        pinned(turn(at(stem + radius, foot + radius), radius, 180, 270), 1),
        straight(at(stem + radius, foot), at(toe, foot)),
      ),
      f.end,
      f.end,
    ),
    thin(f, straight(at(X(0), bar), at(X(lerp(305, 402)), bar)), f.end, f.end),
  ]);
}

/**
 * The l: a stem from the ascender turning out at its foot along the baseline
 * into a short tail cut upright, as Geist's l does.
 */
export function grotesqueL(style: Style): Recipe {
  const f = frame(style);
  const u = small(f);
  const stem = f.edge;
  const foot = f.sits(0);
  const radius = held(f, 50 * u);
  // Its tail reaches the same way past the stem at every weight: Geist's
  // stands 78 units out on the Regular and 88 on the Thin.
  const toe = Math.max(stem + f.half + 80 * u, stem + radius + f.half * 0.2);
  return finish(f, [
    ink(
      f,
      chain(
        straight(at(stem, f.asc), at(stem, foot + radius)),
        pinned(turn(at(stem + radius, foot + radius), radius, 180, 270), 1),
        straight(at(stem + radius, foot), at(toe, foot)),
      ),
      f.end,
      f.end,
    ),
  ]);
}

/** The one: an upright with a flag that curves off its head. */
export function grotesqueOne(style: Style): Recipe {
  const f = frame(style);
  const u = large(f);
  const stem = f.edge + 191 * u;
  const flag = f.hangs((600 / 710) * f.cap, f.bar);
  const radius = held(f, Math.min(110 * u, f.cap - flag));
  const bend = at(stem - radius, flag + radius);
  return finish(f, [
    ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
    ink(
      f,
      chain(
        straight(at(f.edge - f.half * 0.1, flag), at(bend.x, flag)),
        pinned(turn(bend, radius, 270, 360), 1),
        straight(at(stem, bend.y), at(stem, Math.max(bend.y, f.cap - f.half))),
      ),
      f.end,
      BUTT,
    ),
  ]);
}

/**
 * The seven: an arm along the cap line cut square at its end, and a stroke
 * falling from under that end in one long curve that stands upright on the
 * baseline, as Geist's does.
 *
 * The curve starts where its outer edge meets the foot of the arm's square
 * end, so the corner is the arm's own cut carried on down the curve with no
 * spur and no notch; and it is a single arc, upright where it lands, whose
 * radius and lean are whatever carry it from there to the foot.
 */
export function grotesqueSeven(style: Style): Recipe {
  const f = frame(style);
  const X = across(f, 40);
  const pen = penReach(style.pen);
  const line = f.hangs(f.cap);
  const end = X(545);
  const foot = X(257);
  const corner = at(end, f.cap - f.upright * 2);
  let lean = (40 * Math.PI) / 180;
  let from = corner;
  let radius = 0;
  for (let step = 0; step < 8; step++) {
    const side = reachAlong(at(Math.cos(lean), -Math.sin(lean)), pen);
    from = at(corner.x - side.x, corner.y - side.y);
    lean = 2 * Math.atan(Math.max(from.x - foot, 1) / Math.max(from.y, 1));
    radius = Math.max((from.x - foot) / (1 - Math.cos(lean)), f.least);
  }
  const centre = at(from.x + radius * Math.cos(lean), from.y - radius * Math.sin(lean));
  return finish(f, [
    ink(f, straight(at(f.edge - f.half, line), at(end, line)), f.end, BUTT),
    ink(f, turn(centre, radius, 180 - (lean * 180) / Math.PI, 180), BUTT, f.end),
  ]);
}

/**
 * The ampersand, as Geist draws it: one run from the foot of the leg up the
 * diagonal into the left of the loop, over its top and down its right, and
 * back across the diagonal into the lower bowl, which comes round the bottom
 * to meet the leg; and a short arm curving down into that meeting from a
 * terminal cut level on the right.
 *
 * The loop closes where the run crosses itself, so its counter is a
 * teardrop pointing down into the crossing and the lower counter a rounded
 * triangle, as Geist's are. Every joint is found on the curves as drawn --
 * the diagonal tangent to the loop, the crossing tangent to both the loop and
 * the bowl -- so the run is smooth at every weight and has the same pieces.
 */
export function grotesqueAmpersand(style: Style): Recipe {
  const f = frame(lighterAcross(style));
  const [u, t] = spread(f);
  const lerp = (a: number, b: number) => a + (b - a) * Math.min(t, 1.5);
  const X = (x: number) => f.edge - f.half + x * u;
  const H = (y: number) => up(f, y);
  // The loop.
  // Past Geist Black the loop widens with the pen, or its counter is a slit.
  const beyond = Math.max(0, heaviness(f) - 0.67) * f.x * 0.2 * 0.35;
  const loopW = held(f, lerp(119, 144) * u + beyond);
  /*
   * And never much less tall than it is wide: a heavy pen took the loop's
   * crown down onto a loop still sat where the Regular's is, and it came out
   * a flat-sided slot with nothing round on it for the crossing to leave.
   */
  const loopH = held(f, Math.max(f.crest(f.cap) - H(lerp(551, 540)), loopW * 0.85));
  const loopY = f.crest(f.cap) - loopH;
  const loop = at(X(lerp(236, 307)), loopY);
  // The lower bowl.
  const bowlY = H(180);
  const bowlH = held(f, bowlY - f.dip(0));
  const bowlW = held(f, lerp(193, 204) * u);
  const bowl = at(X(lerp(237, 290)), bowlY);
  // The leg, from its foot up to where it runs tangent into the loop's left.
  const foot = at(X(lerp(510, 590)), 0);
  const split = -40;
  const entered = tangentFrom(foot, bend(f, loop, loopH, 270, 180, loopW));
  /*
   * Across from the loop to the bowl on a line tangent to both; where a heavy
   * pen leaves the two too close for one, the bowl's upper quarter is made
   * shallower until there is. A fixed number of tries, for the reason `ess`
   * gives.
   */
  let crossing: Spine | null = null;
  let shallow = bowlH;
  for (let pass = 0; pass < 12; pass++) {
    const run = crossTangent(
      bend(f, loop, loopH, split, -180, loopW),
      bend(f, bowl, shallow, 90, 180, bowlW),
      -1,
    );
    if (crossing) continue;
    if (run) crossing = run;
    else shallow = Math.max(f.least, shallow * 0.85);
  }
  const into = entered ? spineStart(entered.run) : pointOn(loop, loopW, 180);
  const leg = at(into.x - foot.x, into.y - foot.y);
  const armFoot = at(foot.x + (leg.x * H(150)) / leg.y, H(150));
  // The bowl comes round until its spine meets the leg's.
  const across = (p: Vec2) => (p.x - foot.x) * leg.y - (p.y - foot.y) * leg.x;
  let meet = 400;
  for (let d = 290; d <= 420; d += 0.5) {
    const p = bowlPoint(bowl, bowlW, bowlH, 1 - f.square, f.half, d, f.superness);
    if (across(p) > 0) {
      meet = d;
      break;
    }
  }
  // Geist's arm stands lower on its lighter weights: 255 on the Thin.
  const light = Math.min(1, Math.max(0, (87 - f.style.pen.weight) / 57));
  const armTop = at(X(lerp(496, 586)), H(lerp(318, 335) - 63 * light));
  return finish(f, [
    /*
     * Two runs, split on the loop's right side, so that neither crosses
     * itself: a swept run that does is an outline that does, and the
     * crossing is two strokes over each other as it is when drawn.
     */
    ink(
      f,
      chain(
        straight(foot, into),
        entered ? entered.run : straight(into, into),
        bend(f, loop, loopH, 180, split, loopW),
      ),
      f.end,
      BUTT,
    ),
    ink(
      f,
      chain(
        crossing ??
          crossAt(
            bend(f, loop, loopH, split, -180, loopW),
            bend(f, bowl, bowlH, 90, 180, bowlW),
            -110,
            130,
          ),
        bend(f, bowl, bowlH, 180, 270, bowlW),
        bend(f, bowl, bowlH, 270, meet, bowlW),
      ),
      BUTT,
      BUTT,
    ),
    ink(f, bowedTo(f, armTop, armFoot), f.end, BUTT),
  ]);
}

/**
 * Where a straight run from a point meets a run of arcs on a tangent, the
 * arcs travelled clockwise from there: the part of the arcs after that point,
 * with the pieces before it stood on it, so the run keeps its pieces.
 */
function tangentFrom(from: Vec2, arcs: Spine, way = -1): { run: Spine } | null {
  for (let index = 0; index < arcs.segments.length; index++) {
    const one = arcs.segments[index];
    if (one.kind !== "arc" || Math.abs(one.endAngle - one.startAngle) < 1e-9) continue;
    const v = at(one.centre.x - from.x, one.centre.y - from.y);
    const length = Math.hypot(v.x, v.y);
    if (length <= one.radius) continue;
    // The centre on the right of the way the line runs when turning
    // clockwise, on its left when turning anticlockwise.
    const lean = Math.asin(one.radius / length);
    const base = Math.atan2(v.y, v.x) - way * lean;
    const reach = Math.sqrt(length * length - one.radius * one.radius);
    const touch = at(from.x + Math.cos(base) * reach, from.y + Math.sin(base) * reach);
    const angle = Math.atan2(touch.y - one.centre.y, touch.x - one.centre.x);
    const along = alongArc(one, angle);
    if (along === null) continue;
    const at0 = one.startAngle + along;
    return {
      run: {
        closed: false,
        segments: arcs.segments.map((other, where) =>
          where < index
            ? { ...one, startAngle: at0, endAngle: at0 }
            : where === index
              ? { ...one, startAngle: at0 }
              : other,
        ),
      },
    };
  }
  return null;
}

/** How far along an arc an angle lies, in its own direction, or nothing if it is off it. */
function alongArc(one: SpineArc, angle: number): number | null {
  const span = one.endAngle - one.startAngle;
  const whole = Math.PI * 2;
  let along = (angle - one.startAngle) % whole;
  if (span >= 0) {
    if (along < 0) along += whole;
    return along <= span + 1e-9 ? along : null;
  }
  if (along > 0) along -= whole;
  return along >= span - 1e-9 ? along : null;
}

/** A gentle curve from one point to another, turning right as it goes. */
function bowedTo(f: Frame, from: Vec2, to: Vec2): Spine {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const chord = Math.hypot(dx, dy);
  const radius = Math.max(chord * 0.9, f.least);
  const middle = at((from.x + to.x) / 2, (from.y + to.y) / 2);
  const back = Math.sqrt(Math.max(0, radius * radius - (chord * chord) / 4));
  // Centre to the right of travel, so the curve bows out to the right.
  const centre = at(middle.x + (dy / chord) * back, middle.y - (dx / chord) * back);
  const a0 = (Math.atan2(from.y - centre.y, from.x - centre.x) * 180) / Math.PI;
  let a1 = (Math.atan2(to.y - centre.y, to.x - centre.x) * 180) / Math.PI;
  while (a1 > a0) a1 -= 360;
  return turn(centre, radius, a0, a1);
}

/**
 * The j: the i's stem carried under the line and turned out into a short flat
 * foot reaching back under the letter before it, cut upright.
 */
export function grotesqueJay(style: Style): Recipe {
  const f = frame(style);
  const u = small(f);
  const stem = f.edge;
  const floor = f.sits(f.desc);
  const radius = held(f, 50 * u);
  // Past the Black the foot stands out past the turn by a share of the pen,
  // or it was a ledge a few units wide.
  const toe = Math.min(
    stem - 128 * u,
    stem - radius - 1 - f.half * 0.5 * Math.max(0, heaviness(f) - 0.67),
  );
  return finish(f, [
    ink(
      f,
      chain(
        straight(at(stem, f.x), at(stem, floor + radius)),
        pinned(turn(at(stem - radius, floor + radius), radius, 0, -90), 1),
        straight(at(stem - radius, floor), at(toe, floor)),
      ),
      f.end,
      f.end,
    ),
    grotesqueTittle(f, stem),
  ]);
}

/**
 * The r: the stem, and an arm that leaves it on the same superelliptic
 * shoulder the n has, runs flat along the x-height and is cut upright.
 */
export function grotesqueSmallR(style: Style): Recipe {
  const f = frame(style);
  const u = small(f);
  const [X, lerp] = squared(f);
  const stem = f.edge;
  const wide = held(f, 130 * u);
  // Where the arm leaves the stem follows the shoulder's springing, as the
  // n's arch does: Geist's r and n spring from the same height.
  uses("shoulder");
  const spring = Math.min(0.85, Math.max(0.3, f.style.parts.shoulder.spring));
  const fall = held(f, (162 / 530) * f.x * ((1 - spring) / 0.38) - f.gain * 0.4);
  /*
   * The arm is drawn with a pen a quarter narrower across the stem, its
   * inside flush with the stem's and its outside buried in it, so it leaves
   * the stem thinned: the notch Geist cuts where the arm meets the stem --
   * ninety-five units deep on the Regular, a hundred and ten on the Black.
   */
  const { pen } = f.style;
  const narrow = pen.weight * (0.85 - 0.1 * Math.min(heaviness(f) / 0.67, 1));
  const across = pen.weight * (1 - pen.contrast);
  const armPen = { ...pen, weight: narrow, contrast: Math.max(0, 1 - across / narrow) };
  // Hung from the x-height by its own thickness, which a lighter pen may make less.
  const top = f.x - (narrow * (1 - armPen.contrast)) / 2;
  const from = stem + f.half - narrow / 2;
  /*
   * The turn measured on its inside, as Geist's is: 118 across and 138 down
   * on the Regular, 124 and 104 on the Black -- a heavy r's arm still curves
   * out of the stem rather than sitting on it as a block.
   */
  const thick = narrow * (1 - armPen.contrast);
  // Held at the Black's past it, where the turn is all an Ultra's arm has left.
  const tb = Math.min(heaviness(f) / 0.67, 1);
  const across2 = Math.max((118 + 6 * tb) * (X(1) - X(0)) + narrow / 2, narrow * 0.54);
  const down = Math.max(
    ((138 - 34 * tb) / 530) * f.x * ((1 - spring) / 0.38) + thick / 2,
    narrow * 0.54,
  );
  void wide;
  void fall;
  const corner = at(from + across2, top - down);
  const end = Math.max(X(lerp(256, 344)), corner.x + f.half * 0.3);
  // Its turns held to what its own pen goes round: see `holds` in `shapes.ts`.
  const af: Frame = { ...f, half: narrow / 2, style: { ...f.style, pen: armPen } };
  const arm = ink(
    af,
    chain(
      bend(af, corner, down, 180, 90, corner.x - from),
      straight(at(corner.x, top), at(end, top)),
    ),
    BUTT,
    f.end,
  );
  return finish(f, [ink(f, straight(at(stem, 0), at(stem, f.x)), f.end, f.end), arm]);
}

/**
 * The f: a stem turning over at the ascender into a flat hook cut upright,
 * and a bar across at the x-height reaching further right than left.
 */
export function grotesqueF(style: Style): Recipe {
  const f = frame(lighterAcross(style));
  const u = small(f);
  const stem = f.edge + 114 * u;
  const top = f.hangs(f.asc);
  const wide = held(f, 101 * u);
  const fall = held(f, (109 / 530) * f.x - f.gain * 0.3);
  const corner = at(stem + wide, top - fall);
  const end = Math.max(stem + 183 * u, corner.x + f.half * 0.3);
  const bar = f.hangs(f.x, f.bar);
  return finish(f, [
    ink(
      f,
      chain(
        straight(at(stem, 0), at(stem, corner.y)),
        bend(f, corner, fall, 180, 90, wide),
        straight(at(corner.x, top), at(end, top)),
      ),
      f.end,
      f.end,
    ),
    thin(f, straight(at(stem - 114 * u, bar), at(stem + 176 * u, bar)), f.end, f.end),
  ]);
}

/**
 * The question mark: a superelliptic hook from a terminal on the left, over
 * and down the right, then a straight diagonal that turns into a short
 * upright neck, cut level over a square dot.
 */
export function grotesqueQuestion(style: Style): Recipe {
  const f = frame(style);
  const u = large(f);
  const side = stopRadius(f);
  const dotTop = side * 2;
  const neckFoot = dotTop + Math.max(f.half * 2.2, f.cap * 0.06);
  const crest = f.crest(f.cap);
  const halfW = held(f, 191 * u);
  const halfH = held(f, Math.min((156 / 710) * f.cap, (crest - neckFoot) / 2.6));
  const centre = at(f.edge + halfW, crest - halfH);
  const stem = f.edge + 189 * u;
  const hook = bend(f, centre, halfH, 190, -50, halfW);
  const last = hook.segments[hook.segments.length - 1];
  const from = spineEnd(hook);
  const h = headingAt(last, "end");
  const radius = held(f, 70 * u);
  // Along the diagonal until a left turn of this radius lands upright on the
  // neck's line.
  const along = Math.max((stem + radius + radius * h.y - from.x) / h.x, 1);
  const bendAt = at(from.x + h.x * along, from.y + h.y * along);
  const centre2 = at(bendAt.x - h.y * radius, bendAt.y + h.x * radius);
  const startAngle = (Math.atan2(bendAt.y - centre2.y, bendAt.x - centre2.x) * 180) / Math.PI;
  const upright = at(centre2.x - radius, centre2.y);
  return finish(f, [
    ink(
      f,
      chain(
        hook,
        straight(from, bendAt),
        pinned(turn(centre2, radius, startAngle, 180), 1),
        straight(upright, at(upright.x, Math.min(neckFoot, upright.y - 1))),
      ),
      f.end,
      f.end,
    ),
    dot(f, at(upright.x, side), side),
  ]);
}

/*
 * The figures.
 *
 * Proportional, as Geist's are, and each drawn off Geist Regular's own
 * skeleton: horizontal measures in units of the capital O (so a Black's
 * figures narrow their spines as its stems widen, the way Geist's do and the
 * ink still grows), measured from where the figure's ink starts; heights as
 * shares of the cap height, with the curves carried to the overshoot.
 */

/** Where Geist's `x` falls on this figure's spine, for a figure whose ink starts at `ink`. */
function across(f: Frame, ink: number): (x: number) => number {
  const u = large(f);
  return (x) => f.edge + (x - ink - 43) * u;
}

/** A height on Geist's figures, as a share of the cap height. */
const up = (f: Frame, y: number): number => (y / 710) * f.cap;

/**
 * The angle on a bowl at which its spine comes to a height, on the side of it
 * asked for: found on the bowl as drawn, superelliptic corners and all, so a
 * terminal cut level there is cut at that height.
 */
function angleAt(
  f: Frame,
  centre: Vec2,
  halfW: number,
  halfH: number,
  y: number,
  left: boolean,
): number {
  const height = (degrees: number): number =>
    bowlPoint(centre, halfW, halfH, 1 - f.square, f.half, degrees, f.superness).y;
  // Along the side from its lowest point to its highest, where it only climbs.
  let low = left ? 270 : -90;
  let high = 90;
  for (let step = 0; step < 40; step++) {
    const mid = (low + high) / 2;
    if (height(mid) < y) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/**
 * The two: a bowl from a terminal cut level on the left, over and down the
 * right, then a reverse curve that comes down into the left end of the foot
 * travelling upright, as Geist's does -- no straight diagonal, and no corner
 * where the bowl ends.
 */
export function grotesqueTwo(style: Style): Recipe {
  const f = frame(lighterAcross(style));
  const X = across(f, 60);
  const top = f.crest(f.cap);
  const cy = up(f, 510);
  const halfH = held(f, top - cy);
  const halfW = held(f, 195 * large(f));
  const centre = at(X(315), cy);
  const foot = f.sits(0, f.bar);
  const land = at(f.edge, foot);
  const from = angleAt(f, centre, halfW, halfH, up(f, 495), true);
  /*
   * Round the right, straight down across the letter, and a reverse turn
   * that lands upright on the foot: the straight tangent to both, found
   * exactly among the arcs the bowl's right side is drawn in, so the run has
   * no corner at any weight.
   */
  // As long a reverse turn as the bowl leaves room for.
  let falling: Spine | null = null;
  for (let reverse = 330 * large(f); !falling && reverse > f.least; reverse *= 0.9) {
    const landing = at(land.x + reverse, land.y);
    // The bowl's lower right a shallower quarter than its top, as Geist's
    // is: the stroke leaves it high and falls a long way across the letter.
    falling = crossTangent(
      bend(f, centre, held(f, halfH * 0.8), 0, -90, halfW),
      pinned(turn(landing, reverse, 90, 180), 1),
      -1,
    );
  }
  let over: Spine | null = falling ? chain(bend(f, centre, halfH, from, 0, halfW), falling) : null;
  if (!over)
    over = chain(
      bend(f, centre, halfH, from, -45, halfW),
      straight(pointOn(centre, halfW, -45), land),
    );
  return finish(f, [ink(f, over, f.end, BUTT), arm(f, f.edge - f.half, X(559), foot)]);
}

/**
 * The three: two bowls, the lower the larger, meeting at a short tongue cut
 * square on the left, and both ends cut level.
 */
export function grotesqueThree(style: Style): Recipe {
  const f = frame(lighterAcross(style));
  const X = across(f, 50);
  const u = large(f);
  const top = f.crest(f.cap);
  const bottom = f.dip(0);
  const waist = up(f, 378);
  const upperH = held(f, (top - waist) / 2);
  const lowerH = held(f, (waist - bottom) / 2);
  const upper = at(X(307), waist + upperH);
  const lower = at(X(308), waist - lowerH);
  const upperW = held(f, 188 * u);
  const lowerW = held(f, 213 * u);
  return finish(
    f,
    [
      ink(
        f,
        chain(
          bend(f, upper, upperH, angleAt(f, upper, upperW, upperH, up(f, 560), true), -90, upperW),
          straight(at(upper.x, waist), at(X(247), waist)),
        ),
        f.end,
        BUTT,
      ),
      ink(
        f,
        bend(
          f,
          lower,
          lowerH,
          90,
          angleAt(f, lower, lowerW, lowerH, up(f, 188), true) - 360,
          lowerW,
        ),
        BUTT,
        f.end,
      ),
    ],
    true,
  );
}

/**
 * The four: a diagonal whose outer edge runs from the head of the stem to the
 * left end of the bar, closed at the top, the bar low and carried a little
 * past the stem.
 */
export function grotesqueFour(style: Style): Recipe {
  const f = frame(lighterAcross(style));
  const X = across(f, 50);
  const stem = X(461);
  const bar = up(f, 188);
  const pen = penReach(style.pen);
  const flank = Math.abs(reachAlong(at(1, 0), pen).x);
  const barEdge = bar + f.upright;
  const inkLeft = f.edge - f.half;
  // The diagonal's outer edge, from the bar's left end to the stem's head.
  const low = at(inkLeft, barEdge);
  const high = at(stem - flank, f.cap);
  const length = Math.hypot(high.x - low.x, high.y - low.y);
  const d = at((high.x - low.x) / length, (high.y - low.y) / length);
  const shift = reachAlong(at(d.y, -d.x), pen);
  return finish(f, [
    ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
    ink(f, straight(at(low.x + shift.x, low.y + shift.y), at(high.x + shift.x, high.y + shift.y))),
    ink(f, straight(at(inkLeft, bar), at(X(586), bar)), BUTT, f.end),
  ]);
}

/**
 * The five: a flag along the cap line, a short stem leaning back a little and
 * cut level, and a round bowl swung out of it to a terminal cut level on the
 * left.
 */
export function grotesqueFive(style: Style): Recipe {
  const f = frame(lighterAcross(style));
  const X = across(f, 60);
  const u = large(f);
  const flag = f.hangs(f.cap);
  const stemTop = at(X(168), f.cap);
  const stemFoot = at(X(120), up(f, 310));
  const bottom = f.dip(0);
  const crown = up(f, 473) - f.upright;
  const halfH = held(f, (crown - bottom) / 2);
  const centre = at(X(311), bottom + halfH);
  const halfW = held(f, 211 * u);
  // Where the bowl leaves the stem: inside it, a stem's width under its head.
  // Held on the bowl's upper left, where the stem is, at every weight.
  const leaves = angleAt(
    f,
    centre,
    halfW,
    halfH,
    Math.min(stemFoot.y + f.half * 1.1, centre.y + halfH * 0.55),
    true,
  );
  return finish(
    f,
    [
      ink(f, straight(at(stemTop.x - f.half * 0.2, flag), at(X(518), flag)), BUTT, f.end),
      ink(f, straight(stemTop, stemFoot), BUTT, f.end),
      ink(
        f,
        bend(
          f,
          centre,
          halfH,
          Math.min(leaves, 175),
          angleAt(f, centre, halfW, halfH, up(f, 187), true) - 360,
          halfW,
        ),
        BUTT,
        f.end,
      ),
    ],
    true,
  );
}

/**
 * The six: a round bowl, and a tall hood rising out of its left side, over the
 * top and down to a terminal cut level on the right.
 */
export function grotesqueSix(style: Style): Recipe {
  const f = frame(lighterAcross(style));
  return finish(f, sixStrokes(f), true);
}

function sixStrokes(f: Frame): Stroke[] {
  const X = across(f, 60);
  const u = large(f);
  const bottom = f.dip(0);
  const top = f.crest(f.cap);
  const bowlTop = up(f, 484) - f.upright;
  const radius = held(f, (bowlTop - bottom) / 2);
  const centre = at(X(313), bottom + radius);
  const wide = held(f, 207 * u);
  const hoodY = Math.max(up(f, 300), centre.y);
  const hoodH = held(f, top - hoodY);
  const hood = at(centre.x, hoodY);
  const end = angleAt(f, hood, wide, hoodH, Math.max(up(f, 552), hoodY + f.half), false);
  return [
    ink(f, ring(f, centre, wide, radius)),
    ink(
      f,
      chain(
        bend(f, hood, hoodH, end, 180, wide),
        straight(at(hood.x - wide, hoodY), at(hood.x - wide, centre.y)),
      ),
      f.end,
      BUTT,
    ),
  ];
}

/** The nine: the six turned over, as Geist's is. */
export function grotesqueNine(style: Style): Recipe {
  const f = frame(lighterAcross(style));
  const X = across(f, 60);
  const about = at(X(313), (f.crest(f.cap) + f.dip(0)) / 2);
  return finish(
    f,
    sixStrokes(f).map((stroke) => turnedStroke(stroke, about)),
    true,
  );
}

/** The zero: a tall superelliptic ring, its sides a little heavier than its crown. */
export function grotesqueZero(style: Style): Recipe {
  const f = frame(lighterAcross(style));
  const X = across(f, 54);
  const middle = (f.crest(f.cap) + f.dip(0)) / 2;
  return finish(
    f,
    [
      ink(
        f,
        ring(f, at(X(336), middle), held(f, 236 * large(f)), held(f, f.crest(f.cap) - middle)),
      ),
    ],
    true,
  );
}

/**
 * The eight: two rings touching at the waist, the upper the smaller and
 * narrower, as Geist's are -- the same waist as the three's.
 */
export function grotesqueEight(style: Style): Recipe {
  const f = frame(lighterAcross(style));
  const X = across(f, 40);
  const u = large(f);
  const waist = up(f, 378);
  const upperH = held(f, (f.crest(f.cap) - waist) / 2);
  const lowerH = held(f, (waist - f.dip(0)) / 2);
  return finish(
    f,
    [
      ink(f, ring(f, at(X(302), waist + upperH), held(f, 184 * u), upperH)),
      ink(f, ring(f, at(X(302), waist - lowerH), held(f, 218 * u), lowerH)),
    ],
    true,
  );
}

/** A point part of the way along a straight run, found by its height. */
function alongTo(from: Vec2, to: Vec2, y: number): Vec2 {
  const t = (y - from.y) / (to.y - from.y);
  return at(from.x + (to.x - from.x) * t, y);
}

/**
 * The K and the k: an arm from inside the stem out to a cut level on the
 * upper line, and the leg leaving the arm -- not the stem -- a third of the
 * way along it and running down to a cut level on the baseline, as Geist's
 * do. Both ends of each diagonal are cut level, the arm's foot and the leg's
 * head buried in the ink they leave.
 */
function kay(
  f: Frame,
  u: number,
  top: number,
  spine: number,
  arm: [number, number, number],
  leg: [number, number, number],
): Stroke[] {
  const X = (x: number) => f.edge + (x - spine) * u;
  const H = (y: number) => (y / arm[2]) * top;
  const from = at(f.edge, H(arm[0]));
  const to = at(X(arm[1]), top);
  const junction = alongTo(from, to, H(leg[0]));
  return [
    ink(f, straight(from, to), BUTT, f.end),
    ink(f, straight(junction, at(X(leg[1]), 0)), BUTT, f.end),
  ];
}

export function grotesqueCapitalK(style: Style): Recipe {
  const f = frame(style);
  return finish(f, [
    ink(f, straight(at(f.edge, 0), at(f.edge, f.cap)), f.end, f.end),
    ...kay(f, large(f), f.cap, 136, [234, 550, 710], [397, 572, 710]),
  ]);
}

export function grotesqueK(style: Style): Recipe {
  const f = frame(style);
  return finish(f, [
    ink(f, straight(at(f.edge, 0), at(f.edge, f.asc)), f.end, f.end),
    ...kay(f, small(f), f.x, 123, [133, 476, 530], [305, 491, 530]),
  ]);
}

/**
 * The M: upright stems, and two diagonals from the heads of the stems down
 * to the baseline, each cut level at both ends, meeting in a flat-bottomed
 * vertex on the line -- Geist's M, whose vertex goes all the way down.
 */
export function grotesqueM(style: Style): Recipe {
  const f = frame(style);
  const [u, t] = spread(f);
  const X = (x: number) => f.edge + x * u;
  const right = X(606 + 11 * t);
  const middle = (f.edge + right) / 2;
  /*
   * Geist Black starts its diagonals further in and crosses them a little
   * above the line, so a stem's width of white stays under each side. In
   * pens rather than units, so a hairline's diagonals still meet its stems
   * and each other.
   */
  const lerp = (a: number, b: number) => a + (b - a) * Math.min(t, 1.5);
  const top = f.half * lerp(0.63, 0.74);
  const foot = f.half * lerp(-0.28, 0.064);
  return finish(f, [
    ink(f, straight(at(f.edge, 0), at(f.edge, f.cap)), f.end, f.end),
    ink(f, straight(at(right, 0), at(right, f.cap)), f.end, f.end),
    ink(f, straight(at(f.edge + top, f.cap), at(middle + foot, 0)), LEVEL, LEVEL),
    ink(f, straight(at(right - top, f.cap), at(middle - foot, 0)), LEVEL, LEVEL),
  ]);
}

/**
 * The unit of a capital that keeps its width at a Black, as Geist's M and W
 * do, and how far along the way from Geist Regular to Geist Black this weight
 * is (one at Black, past it beyond).
 */
function spread(f: Frame): [number, number] {
  const h = heaviness(f);
  return [large(f) * (1 + 0.1 * h), h / 0.67];
}

/**
 * The exclamation mark: a stem cut level at the cap line that runs straight
 * for its upper half and then narrows to two thirds of itself at its foot, as
 * Geist's does, over a square dot.
 *
 * The narrowing is two lighter strokes side by side: together as wide as the
 * stem while they run parallel, then leaning in to meet over the dot, so the
 * stem is one outline at every weight with the same points.
 */
export function grotesqueExclam(style: Style): Recipe {
  const f = frame(style);
  const side = stopRadius(f);
  const foot = Math.max(up(f, 225), side * 2 + f.half * 0.8);
  const knee = Math.max(up(f, 470), foot + f.half);
  return finish(f, [
    ...tapered(f, f.edge, f.cap, knee, foot, 0.69),
    dot(f, at(f.edge, side), side),
  ]);
}

/**
 * A stroke cut level at its head that runs straight and then narrows to its
 * foot -- the stem of the exclamation mark, a quote -- drawn as two lighter
 * strokes side by side: together as wide as the stem while they run
 * parallel, then leaning in to meet, so it is one outline at every weight
 * with the same points.
 */
function tapered(
  f: Frame,
  x: number,
  top: number,
  knee: number,
  foot: number,
  narrow: number,
  heavy = 1,
): Stroke[] {
  const pen = { ...f.style.pen, weight: f.style.pen.weight * narrow * heavy };
  const shift = f.half * heavy * (1 - narrow);
  const half = (dir: number): Stroke => {
    const drawn = ink(
      f,
      chain(
        straight(at(x + dir * shift, top), at(x + dir * shift, knee)),
        straight(at(x + dir * shift, knee), at(x, foot)),
      ),
      f.end,
      f.end,
    );
    return inherit(drawn, { ...drawn, pen });
  };
  return [half(-1), half(1)];
}

/** The quotes: short tapered strokes, as Geist's are, a stem's width at the head. */
function quoteMarks(f: Frame, count: number): Stroke[] {
  const [u, t] = spread(f);
  const lerp = (a: number, b: number) => a + (b - a) * Math.min(t, 1.5);
  // Lighter than the stem at a Black -- Geist Black's are 126 across on a
  // stem of 172 -- and apart by their own width and a gap that closes a
  // little as they grow.
  const heavy = lerp(1.03, 0.73);
  const apart = lerp(82.5, 68) * u + f.style.pen.weight * heavy;
  const strokes: Stroke[] = [];
  for (let one = 0; one < count; one++) {
    strokes.push(
      ...tapered(
        f,
        f.edge + one * apart,
        f.cap,
        up(f, 640),
        up(f, lerp(447, 430)),
        lerp(0.73, 0.83),
        heavy,
      ),
    );
  }
  return strokes;
}

export function grotesqueQuoteSingle(style: Style): Recipe {
  const f = frame(style);
  return finish(f, quoteMarks(f, 1));
}

export function grotesqueQuoteDouble(style: Style): Recipe {
  const f = frame(style);
  return finish(f, quoteMarks(f, 2));
}

/**
 * The W: four straight strokes, each cut level at both ends -- the outer two
 * from the cap line down to the vertices, the inner two from a middle apex
 * that reaches the cap line, as Geist's does, and each pair meeting on the
 * baseline in a flat-bottomed vertex.
 */
export function grotesqueW(style: Style): Recipe {
  const f = frame(style);
  const [u, t] = spread(f);
  const X = (x: number) => f.edge + x * u;
  const apex = 386.5 + 6.5 * t;
  const outer = 179 + 4.4 * t;
  // The two feet of each vertex apart by a share of the pen, so they meet at
  // every weight: Geist's are 26 apart on a stem of 86, 33 on one of 172.
  const inner = outer + (f.half * (0.6 - 0.22 * Math.min(t, 1.5))) / u;
  const stroke = (top: number, foot: number) =>
    ink(f, straight(at(X(top), f.cap), at(X(foot), 0)), LEVEL, LEVEL);
  return finish(f, [
    stroke(0, outer),
    stroke(apex, inner),
    stroke(apex, apex * 2 - inner),
    stroke(apex * 2, apex * 2 - outer),
  ]);
}

/** Geist's s or S, as the numbers it is laid out from. */
interface Ess {
  /** The height it is drawn to: the x-height or the cap height. */
  height: number;
  /** The same height in Geist's own units. */
  geist: number;
  unit: number;
  /** The left of the upper bowl's spine, in Geist's units. */
  left: number;
  upper: { x: number; y: [number, number]; w: number };
  lower: { x: number; y: [number, number]; w: number };
  /** The heights the head and the foot are cut level at, Regular and Black. */
  head: [number, number];
  foot: [number, number];
  /** How tall the quarters the spine leaves are, against the drop between the bowls. */
  inner: number;
}

/**
 * An s as Geist draws one: two superelliptic bowls, the lower the wider, and
 * a straight spine falling between them tangent to both, the head and the
 * foot cut level on the right and the left.
 *
 * Where each bowl meets the spine is found on the bowls as drawn, so the run
 * is smooth at every weight; and each is the same seven pieces at every
 * weight. Past Geist Black the bowls widen with the pen, or two stacked
 * counters close from the sides.
 */
function ess(f: Frame, e: Ess): Stroke {
  const t = heaviness(f) / 0.67;
  const lerp = (pair: [number, number]) => pair[0] + (pair[1] - pair[0]) * Math.min(t, 1.5);
  const H = (y: number) => (y / e.geist) * e.height;
  const beyond = Math.max(0, heaviness(f) - 0.67) * f.x * 0.2 * 0.3;
  const X = (x: number) => f.edge + (x - e.left) * e.unit;
  /*
   * How shallow a turn the pen will go round across the letter. A round pen
   * needs its own half-width, which is `held`; past Geist Black the s is
   * drawn with a pen much lighter across than along (`lighterAcross`), and
   * what a turn lying on its side needs is that lighter measure. Held at the
   * round pen's, an Ultra's s had no room between its lines for two bowls
   * and a spine, and grew past both.
   */
  const past = Math.min(1, Math.max(0, t - 1) / 0.6);
  const lighter = (share: number) =>
    f.least + (Math.min(f.least, f.upright * share) - f.least) * past;
  /*
   * Two measures: the quarters the spine leaves are held rounder, since the
   * counter lies inside their turn and a turn much tighter than the pen
   * leaves the pen's own round standing into it; the crowns, whose inside
   * is the flat of the pen, can turn tighter.
   */
  const least = lighter(2.0);
  const crownLeast = lighter(1.7);
  const heldAcross = (radius: number): number => Math.max(radius, crownLeast);
  // The bowls are drawn to those measures too: see `holds` in `shapes.ts`.
  const g: Frame = { ...f, half: least / 1.06 };
  const gc: Frame = { ...f, half: crownLeast / 1.06 };
  /*
   * Under the upper bowl's widest point and over the lower's, each bowl turns
   * on a shallower quarter than it does at its end: that is where the spine
   * leaves it, and Geist's spine leaves each bowl on a long gentle turn and
   * falls straight across the letter between them, tangent to both --
   * shallower at a heavy weight, so the spine falls steeper and keeps its
   * weight.
   *
   * Where the quarters stand so far into each other's height that no line
   * is tangent to both, they are made shallower until one is; and past what
   * the pen will go round -- a pen near half the x-height -- the letter
   * widens a little and then grows past its lines, evenly above and below,
   * as a Black s of the plain sans does, rather than closing up or folding.
   */
  let grow = 0;
  let widen = 0;
  const spread = [0, 0];
  let inner = 0;
  let found: {
    top: number;
    bottom: number;
    upper: Vec2;
    lower: Vec2;
    upperH: number;
    lowerH: number;
    upperW: number;
    lowerW: number;
    run: Spine;
  } | null = null;
  /*
   * Always the same number of tries, each drawing its two quarters, whether
   * or not an earlier one found the spine: a bowl drawn here is asked where
   * its pieces begin (`begun` in `shapes.ts`), and a weight that tried fewer
   * times would read the next bowl's answer.
   */
  for (let pass = 0; pass < 48; pass++) {
    const top = f.crest(e.height) + grow;
    const bottom = f.dip(0) - grow;
    const upperY = H(lerp(e.upper.y)) + grow + spread[0];
    const lowerY = H(lerp(e.lower.y)) - grow - spread[1];
    if (pass === 0) inner = (upperY - lowerY) * e.inner * (1 - 0.25 * Math.min(1.5, heaviness(f)));
    const upperW = held(f, e.upper.w * e.unit + beyond + widen);
    const lowerW = held(f, e.lower.w * e.unit + beyond + widen);
    const upper = at(X(e.upper.x) + beyond, upperY);
    const lower = at(X(e.lower.x) + beyond, lowerY);
    const run = crossTangent(
      bend(g, upper, inner, 180, 270, upperW),
      bend(g, lower, inner, 90, 0, lowerW),
    );
    if (found) continue;
    if (run) {
      const upperH = heldAcross(top - upperY);
      const lowerH = heldAcross(lowerY - bottom);
      found = { top, bottom, upper, lower, upperH, lowerH, upperW, lowerW, run };
      continue;
    }
    if (inner > least * 1.01) inner = Math.max(least, inner * 0.85);
    else if (
      top - upperY > crownLeast + f.half * 0.05 ||
      lowerY - bottom > crownLeast + f.half * 0.05
    ) {
      /*
       * Then the bowls stand further apart, their crowns turning tighter,
       * before the letter grows: an Ultra's s keeps to its lines.
       */
      if (top - upperY > crownLeast + f.half * 0.05) spread[0] += f.half * 0.05;
      if (lowerY - bottom > crownLeast + f.half * 0.05) spread[1] += f.half * 0.05;
    } else {
      widen += f.half * 0.05;
      grow += f.half * 0.05;
    }
  }
  const { upper, lower, upperH, lowerH, upperW, lowerW } = found!;
  const spineRun = found!.run;
  /*
   * The ends are cut level, and a level cut has to reach across the stroke:
   * carried too far round, the inside of the turn never comes back up to the
   * line and the end is cut square instead. So neither end is carried past a
   * third of the way from its bowl's widest point to its crown.
   */
  const head = angleAt(
    gc,
    upper,
    upperW,
    upperH,
    Math.max(H(lerp(e.head)) + grow, upper.y - upperH * 0.35),
    false,
  );
  const foot =
    angleAt(
      gc,
      lower,
      lowerW,
      lowerH,
      Math.min(H(lerp(e.foot)) - grow, lower.y + lowerH * 0.35),
      true,
    ) - 360;
  /*
   * And at a heavy weight the pen held a little off upright, as `blackPen`
   * does for the plain s: the broad of it across the spine, so the spine is
   * the heaviest thing in the letter as it is in every Black.
   */
  const drawn = ink(
    f,
    chain(
      bend(gc, upper, upperH, head, 180, upperW),
      /*
       * Past even that -- a pen near half the x-height -- the spine leaves
       * each quarter at a fixed point, in the same pieces.
       */
      spineRun,
      bend(gc, lower, lowerH, 0, foot, lowerW),
    ),
    f.end,
    f.end,
  );
  // Let go again past the Black, where the pen is already light across and a
  // tilted one leaves its heel standing into the counters, one side only.
  const tilt = Math.abs(drawn.pen.angle) < 15 ? 12 * Math.min(1, heaviness(f)) * (1 - past) : 0;
  return tilt > 0
    ? inherit(drawn, { ...drawn, pen: { ...drawn.pen, angle: drawn.pen.angle + tilt } })
    : drawn;
}

/**
 * The line tangent to two runs of arcs, leaving the first -- travelled
 * anticlockwise -- and arriving on the second, travelled clockwise, so the
 * whole is one smooth reverse curve: the first run up to where the line
 * leaves it, the line, and the second run on from where the line meets it.
 *
 * Found exactly, circle to circle, among the arcs the two runs are made of.
 * The pieces the line cuts off are kept, stood on the point where it
 * leaves or arrives, so the run is drawn in the same pieces at every weight.
 */
function crossTangent(first: Spine, second: Spine, way = 1): Spine | null {
  const arcs = (spine: Spine) =>
    spine.segments.flatMap((one, index) =>
      one.kind === "arc" && one.radius > 1e-6 && Math.abs(one.endAngle - one.startAngle) > 1e-9
        ? [{ one, index }]
        : [],
    );
  const within = alongArc;
  for (const a of arcs(first)) {
    for (const b of arcs(second)) {
      const dx = a.one.centre.x - b.one.centre.x;
      const dy = a.one.centre.y - b.one.centre.y;
      const length = Math.hypot(dx, dy);
      const sum = a.one.radius + b.one.radius;
      if (length <= sum) continue;
      const base = Math.atan2(dy, dx);
      const spread = Math.acos(sum / length);
      for (const turnBy of [spread, -spread]) {
        // The left of the line: towards the first circle, away from the second.
        const n = at(Math.cos(base + turnBy) * way, Math.sin(base + turnBy) * way);
        const d = at(n.y, -n.x);
        // Falling across the letter: to the right when the first run turns
        // anticlockwise, as an s's does, and to the left when it turns the
        // other way, as the ampersand's loop does.
        if (!(d.x * way > 0 && d.y < 0)) continue;
        const leave = Math.atan2(-n.y * way, -n.x * way);
        const arrive = Math.atan2(n.y * way, n.x * way);
        const alongA = within(a.one, leave);
        const alongB = within(b.one, arrive);
        if (alongA === null || alongB === null) continue;
        const endA = a.one.startAngle + alongA;
        const startB = b.one.startAngle + alongB;
        const from = pointOn(a.one.centre, a.one.radius, (endA * 180) / Math.PI);
        const to = pointOn(b.one.centre, b.one.radius, (startB * 180) / Math.PI);
        const stood = (one: SpineArc, angle: number): SpineArc => ({
          ...one,
          startAngle: angle,
          endAngle: angle,
        });
        const head = first.segments.map((one, index) =>
          index < a.index
            ? one
            : index === a.index
              ? { ...a.one, endAngle: endA }
              : stood(a.one, endA),
        );
        const tail = second.segments.map((one, index) =>
          index > b.index
            ? one
            : index === b.index
              ? { ...b.one, startAngle: startB }
              : stood(b.one, startB),
        );
        return { segments: [...head, ...straight(from, to).segments, ...tail], closed: false };
      }
    }
  }
  return null;
}

/**
 * Two runs of arcs joined by a straight from a point on the first to a point
 * on the second, at the angles given, in the same pieces `crossTangent` uses:
 * for where the two stand too close for a tangent, so the letter keeps its
 * points at every weight and only its smoothness gives way.
 */
function crossAt(first: Spine, second: Spine, leave: number, arrive: number): Spine {
  const cut = (spine: Spine, degrees: number, keepBefore: boolean): [Spine, Vec2] => {
    const angle = (degrees * Math.PI) / 180;
    let index = spine.segments.findIndex(
      (one) =>
        one.kind === "arc" &&
        Math.abs(one.endAngle - one.startAngle) > 1e-9 &&
        alongArc(one, angle) !== null,
    );
    if (index < 0) index = spine.segments.findIndex((one) => one.kind === "arc");
    const one = spine.segments[index] as SpineArc;
    const along = alongArc(one, angle) ?? 0;
    const at0 = one.startAngle + along;
    const point = pointOn(one.centre, one.radius, (at0 * 180) / Math.PI);
    const segments = spine.segments.map((other, where) =>
      keepBefore
        ? where < index
          ? other
          : where === index
            ? { ...one, endAngle: at0 }
            : { ...one, startAngle: at0, endAngle: at0 }
        : where > index
          ? other
          : where === index
            ? { ...one, startAngle: at0 }
            : { ...one, startAngle: at0, endAngle: at0 },
    );
    return [{ closed: false, segments }, point];
  };
  const [head, from] = cut(first, leave, true);
  const [tail, to] = cut(second, arrive, false);
  return {
    closed: false,
    segments: [...head.segments, ...straight(from, to).segments, ...tail.segments],
  };
}

/**
 * The style an s is drawn with past Geist Black: its horizontals held near
 * the Black's own while its stems go on growing.
 *
 * An s stacks three horizontals and two counters in the x-height, where an o
 * has two and one. At an Ultra's pen, half the x-height, three of the o's
 * crowns left two slits between them, the spine could no longer fall
 * between its bowls, and the letter grew past both its lines. An Ultra's s
 * is drawn lighter across: its terminals and its spine stay about as heavy
 * as the Black's, and the weight goes into its sides. So do the other
 * letters that stack their horizontals: the a (arch over bowl), the g (bowl
 * over hook) and the f (hook over bar), whose counters were slits.
 */
function lighterAcross(style: Style): Style {
  const f = frame(style);
  const t = heaviness(f) / 0.67 - 1;
  if (t <= 0) return style;
  const k = Math.min(1, t / 1.2);
  const { pen } = f.style;
  const contrast = pen.contrast + (0.56 - pen.contrast) * k * k * (3 - 2 * k);
  return {
    ...f.style,
    pen: { ...pen, contrast, own: pen.own ?? pen.contrast },
    metrics: { ...f.style.metrics, lighterAcross: true },
  };
}

/** The s: see `ess`. Measured off Geist Regular and Black. */
export function grotesqueS(style: Style): Recipe {
  const f = frame(lighterAcross(style));
  return {
    ...finish(
      f,
      [
        ess(f, {
          height: f.x,
          geist: 530,
          unit: small(f),
          left: 104,
          upper: { x: 263, y: [385, 370], w: 159 },
          lower: { x: 266, y: [125, 140], w: 174 },
          head: [385, 345],
          foot: [175, 190],
          inner: 0.42,
        }),
      ],
      true,
    ),
  };
}

/** The S: see `ess`. */
export function grotesqueCapitalS(style: Style): Recipe {
  const f = frame(style);
  return finish(
    f,
    [
      ess(f, {
        height: f.cap,
        geist: 710,
        unit: large(f),
        left: 118,
        upper: { x: 322, y: [540, 510], w: 204 },
        lower: { x: 326, y: [180, 200], w: 220 },
        head: [505, 465],
        foot: [225, 250],
        inner: 0.42,
      }),
    ],
    true,
  );
}

/**
 * The z and the Z: two bars at the stem's weight, and a diagonal whose edges
 * run exactly from the foot of the upper bar's right end to the head of the
 * lower bar's left end, as Geist's do -- so each corner is the bar's own
 * square end carried on down the diagonal, with no point standing out past
 * the bar and no notch cut into it.
 */
function zed(f: Frame, u: number, t: number, top: number, bars: number[][]): Stroke[] {
  const lerp = (a: number, b: number) => a + (b - a) * Math.min(t, 1.5);
  const X = (x: number) => f.edge - f.half + x * u;
  const [upperFrom, upperTo, lowerTo] = bars.map(([a, b]) => X(lerp(a, b)));
  const pen = penReach(f.style.pen);
  const upperLine = f.hangs(top);
  const lowerLine = f.sits(0);
  const high = at(upperTo, top - f.upright * 2);
  const low = at(X(0), f.upright * 2);
  let from = high;
  let to = low;
  for (let pass = 0; pass < 8; pass++) {
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    const d = at((to.x - from.x) / length, (to.y - from.y) / length);
    // The side of the run the upper corner is on: left of its way down.
    const side = reachAlong(at(-d.y, d.x), pen);
    from = at(high.x - side.x, high.y - side.y);
    to = at(low.x + side.x, low.y + side.y);
  }
  return [
    ink(f, straight(at(upperFrom, upperLine), at(upperTo, upperLine))),
    ink(f, straight(from, to)),
    ink(f, straight(at(X(0), lowerLine), at(lowerTo, lowerLine))),
  ];
}

/**
 * A unit for a letter laid out by its ink rather than its spine, as the zed
 * is: Geist's own units at every weight, so a Thin is as wide as Geist
 * Thin's, and a little narrower still on the lightest weights, as Geist's is.
 */
function inked(f: Frame, line: number, geist: number): number {
  const light = Math.min(1, Math.max(0, (87 - f.style.pen.weight) / 57));
  return ((line / geist) * f.style.metrics.width * (1 - 0.04 * light)) / unstretched(f);
}

export function grotesqueZ(style: Style): Recipe {
  const f = frame(style);
  const [, t] = spread(f);
  return finish(
    f,
    zed(f, inked(f, f.x, 530), t, f.x, [
      [10, 13],
      [428, 492],
      [436, 499],
    ]),
  );
}

export function grotesqueCapitalZ(style: Style): Recipe {
  const f = frame(style);
  const [, t] = spread(f);
  return finish(
    f,
    zed(f, inked(f, f.cap, 710), t, f.cap, [
      [17, 17],
      [481, 543],
      [489, 557],
    ]),
  );
}

/**
 * Two straight strokes, each cut level at both ends, meeting at a vertex that
 * is flat where the two feet (or heads) stand a little apart, as all of
 * Geist's diagonals do: the v, the V, the A and the w.
 *
 * Measured on Geist Regular and Black, relative to where the ink starts:
 * where the two free ends are, where the vertex is, and how far apart the two
 * ends at the vertex stand, in pens, so a hairline's still meet.
 */
interface Vee {
  /** The two free ends, Regular then Black. */
  ends: [[number, number], [number, number]];
  /** The middle of the vertex, Regular then Black. */
  vertex: [number, number];
  /** The two ends at the vertex apart, in half-pens, Regular then Black. */
  gap: [number, number];
}

function vee(f: Frame, u: number, t: number, v: Vee, free: number, meet: number): Stroke[] {
  const lerp = (pair: [number, number]) => pair[0] + (pair[1] - pair[0]) * Math.min(t, 1.5);
  // From the ink to the spine by Geist's own half-pen, so a lighter weight
  // keeps Geist's skeleton rather than its ink.
  const X = (x: number) => f.edge + (x - lerp([43, 86])) * u;
  const middle = X(lerp(v.vertex));
  const apart = (f.half * lerp(v.gap)) / 2;
  return [
    ink(f, straight(at(X(lerp(v.ends[0])), free), at(middle - apart, meet)), LEVEL, LEVEL),
    ink(f, straight(at(X(lerp(v.ends[1])), free), at(middle + apart, meet)), LEVEL, LEVEL),
  ];
}

/** The unit a lowercase letter keeps at a Black, as Geist's v and w do. */
function smallSpread(f: Frame): [number, number] {
  const h = heaviness(f);
  return [small(f) * (1 + 0.1 * h), h / 0.67];
}

export function grotesqueV(style: Style): Recipe {
  const f = frame(style);
  const [u, t] = smallSpread(f);
  return finish(
    f,
    vee(
      f,
      u,
      t,
      {
        ends: [
          [45.6, 92.4],
          [448.4, 500.6],
        ],
        vertex: [247, 296.7],
        gap: [0.54, 0.51],
      },
      f.x,
      0,
    ),
  );
}

export function grotesqueCapitalV(style: Style): Recipe {
  const f = frame(style);
  const [u, t] = spread(f);
  return finish(
    f,
    vee(
      f,
      u,
      t,
      {
        ends: [
          [48, 89.3],
          [579.4, 624.7],
        ],
        vertex: [314, 356.9],
        gap: [0.53, 0.37],
      },
      f.cap,
      0,
    ),
  );
}

/** The A: a vee turned over, flat at its head, and a bar low across it. */
export function grotesqueCapitalA(style: Style): Recipe {
  const f = frame(style);
  const [u, t] = spread(f);
  const legs = vee(
    f,
    u,
    t,
    {
      ends: [
        [48, 89.5],
        [581.7, 623.5],
      ],
      vertex: [315, 350],
      gap: [0.73, 0.58],
    },
    0,
    f.cap,
  );
  // Geist's height, moved with the crossbar control from where the face has it.
  uses("crossbar");
  const bar =
    up(f, 245 + (215 - 245) * Math.min(t, 1.5)) +
    (f.style.parts.crossbar.height - SANS_CROSSBAR) * f.cap;
  // Across the legs at that height, and buried in each.
  const across = (stroke: Stroke) => {
    const one = stroke.spine.segments[0];
    if (one.kind !== "line") return 0;
    return one.from.x + ((one.to.x - one.from.x) * (bar - one.from.y)) / (one.to.y - one.from.y);
  };
  return finish(f, [
    ...legs,
    thin(f, straight(at(across(legs[0]), bar), at(across(legs[1]), bar))),
  ]);
}

/** The w: two vees side by side, the middle apex reaching the x-height. */
export function grotesqueSmallW(style: Style): Recipe {
  const f = frame(style);
  const [u, t] = smallSpread(f);
  const lerp = (a: number, b: number) => a + (b - a) * Math.min(t, 1.5);
  const X = (x: number) => f.edge + (x - lerp(43, 86)) * u;
  const outer = lerp(45.7, 87.5);
  const apex = lerp(388, 409);
  const vertex = lerp(217.25, 243.5);
  const apart = (f.half * lerp(0.66, 0.31)) / 2 / u;
  const stroke = (top: number, foot: number) =>
    ink(f, straight(at(X(top), f.x), at(X(foot), 0)), LEVEL, LEVEL);
  return finish(f, [
    stroke(outer, vertex - apart),
    stroke(apex, vertex + apart),
    stroke(apex, apex * 2 - vertex - apart),
    stroke(apex * 2 - outer, apex * 2 - vertex + apart),
  ]);
}

/**
 * The Y: two straight arms from heads cut level on the cap line down into the
 * head of the stem, which they meet low -- under the middle of the letter, as
 * Geist's do -- and a stem from there to the baseline.
 */
export function grotesqueCapitalY(style: Style): Recipe {
  const f = frame(style);
  const [u, t] = spread(f);
  const lerp = (a: number, b: number) => a + (b - a) * Math.min(t, 1.5);
  const X = (x: number) => f.edge + (x - lerp(43, 86)) * u;
  const stem = X(lerp(295, 332.5));
  const junction = at(stem, up(f, lerp(297, 271)));
  return finish(f, [
    ink(f, straight(at(X(lerp(52.1, 94.9)), f.cap), junction), LEVEL, BUTT),
    ink(f, straight(at(X(lerp(537.4, 570.1)), f.cap), junction), LEVEL, BUTT),
    ink(f, straight(junction, at(stem, 0)), BUTT, f.end),
  ]);
}

/**
 * The N: upright stems and a diagonal from the head of the left to the foot
 * of the right, cut level on the cap line and on the baseline, as Geist's is
 * -- the diagonal's ends flush with the lines rather than hung inside the
 * stems.
 */
export function grotesqueN(style: Style): Recipe {
  const f = frame(style);
  const [u, t] = spread(f);
  const lerp = (a: number, b: number) => a + (b - a) * Math.min(t, 1.5);
  const right = f.edge + lerp(467, 443) * u;
  return finish(f, [
    ink(f, straight(at(f.edge, 0), at(f.edge, f.cap)), f.end, f.end),
    ink(f, straight(at(right, 0), at(right, f.cap)), f.end, f.end),
    ink(
      f,
      straight(
        // Held at the Black's past it: carried on, the diagonal stood out past both stems.
        at(f.edge + f.half * (0.65 - 0.57 * Math.min(t, 1)), f.cap),
        at(right - f.half * (0.8 - 0.6 * Math.min(t, 1)), 0),
      ),
      LEVEL,
      LEVEL,
    ),
  ]);
}

/**
 * The C: the O's own ring, cut level on the right at Geist's two heights --
 * the upper a little higher than the middle of the letter is from its lower.
 */
export function grotesqueCapitalC(style: Style): Recipe {
  const f = frame(style);
  const [u, t] = spread(f);
  const lerp = (a: number, b: number) => a + (b - a) * Math.min(t, 1.5);
  const middle = (f.crest(f.cap) + f.dip(0)) / 2;
  const halfH = held(f, f.crest(f.cap) - middle);
  const halfW = held(f, lerp(273, 253) * u);
  const centre = at(f.edge + halfW, middle);
  const head = angleAt(f, centre, halfW, halfH, up(f, lerp(500, 455)), false);
  const foot = angleAt(f, centre, halfW, halfH, up(f, lerp(225, 265)), false);
  return finish(f, [ink(f, bend(f, centre, halfH, head, 360 + foot, halfW), f.end, f.end)], true);
}

/*
 * The marks Geist draws its own way: a long hyphen, tall parentheses cut
 * level, a long slash, a slanted number sign, a percent with narrow ovals and
 * an at sign built round a single-storey a.
 */

/** The hyphen: a third of an em long, at the stem's weight, level with the x-height's middle. */
export function grotesqueHyphen(style: Style): Recipe {
  const f = frame(style);
  const u = small(f);
  const y = (292 / 530) * f.x;
  return finish(f, [ink(f, straight(at(f.edge - f.half, y), at(f.edge - f.half + 332 * u, y)))]);
}

/** A parenthesis: one long arc from above the ascender to below the baseline, cut level. */
function paren(f: Frame, facing: 1 | -1): Stroke {
  const u = large(f);
  const top = up(f, 750);
  const bottom = up(f, -110);
  const half = (top - bottom) / 2;
  const reach = Math.max(116.5 * u, f.half);
  const radius = (half * half + reach * reach) / (2 * reach);
  const sweep = (Math.asin(Math.min(1, half / radius)) * 180) / Math.PI;
  const middle = (top + bottom) / 2;
  if (facing === 1) {
    const centre = at(f.edge + radius, middle);
    return ink(f, turn(centre, radius, 180 - sweep, 180 + sweep), f.end, f.end);
  }
  const centre = at(f.edge + reach - radius, middle);
  return ink(f, turn(centre, radius, sweep, -sweep), f.end, f.end);
}

export function grotesqueParenLeft(style: Style): Recipe {
  const f = frame(style);
  return finish(f, [paren(f, 1)]);
}

export function grotesqueParenRight(style: Style): Recipe {
  const f = frame(style);
  return finish(f, [paren(f, -1)]);
}

/** The slash: from below the baseline to above the ascender, cut level at both. */
export function grotesqueSlash(style: Style): Recipe {
  const f = frame(style);
  const u = large(f);
  return finish(f, [
    ink(f, straight(at(f.edge, up(f, -110)), at(f.edge + 295.8 * u, up(f, 750))), LEVEL, LEVEL),
  ]);
}

/** The number sign: two slanted uprights and two bars, a little lighter than the stem. */
export function grotesqueNumberSign(style: Style): Recipe {
  const f = frame(style);
  const u = large(f);
  const X = (x: number) => f.edge - f.half + x * u;
  const lighter = (stroke: Stroke, by: number): Stroke =>
    inherit(stroke, { ...stroke, pen: { ...stroke.pen, weight: stroke.pen.weight * by } });
  const slope = 0.184;
  const upright = (x: number) =>
    lighter(ink(f, straight(at(X(x), 0), at(X(x) + slope * f.cap, f.cap)), LEVEL, LEVEL), 0.85);
  const bar = (y: number, from: number, to: number) =>
    lighter(ink(f, straight(at(X(from), up(f, y)), at(X(to), up(f, y)))), 0.75);
  // Further apart at a heavy weight, and the bars longer with them, or the
  // counter between the four strokes shuts.
  const grow = (f.gain * 0.9) / u;
  return finish(f, [
    upright(72.5),
    upright(278.5 + grow),
    bar(226, -5, 437 + grow),
    bar(488, 38, 480 + grow),
  ]);
}

/** The percent: two narrow ovals and a long diagonal cut level at both ends. */
export function grotesquePercent(style: Style): Recipe {
  const f = frame(style);
  const u = large(f);
  const X = (x: number) => f.edge - f.half + x * u;
  const light = (stroke: Stroke): Stroke =>
    inherit(stroke, { ...stroke, pen: { ...stroke.pen, weight: stroke.pen.weight * 0.9 } });
  // Wider at a heavy weight, and further apart, or their counters are slits.
  const grow = f.gain * 0.6;
  const oval = (x: number, y: number) =>
    light(
      ink(f, ring(f, at(x, up(f, y)), held(f, 105 * u + grow), held(f, up(f, 126) + grow * 0.25))),
    );
  return finish(
    f,
    [
      oval(X(192) - grow * 0.2, 550),
      oval(X(578) + grow, 154),
      ink(
        f,
        straight(
          at(X(137.5) + grow * 0.4, 0),
          at(X(137.5) + grow * 0.4 + 0.7 * up(f, 726), up(f, 726)),
        ),
        LEVEL,
        LEVEL,
      ),
    ],
    true,
  );
}

/**
 * The at sign: a single-storey a -- a bowl and a stem -- whose stem turns
 * out at its foot and runs up into a wide ring round the whole, which comes
 * over the top and round to an end under the a, as Geist's does.
 */
export function grotesqueAt(style: Style): Recipe {
  const f = frame(style);
  const u = large(f);
  const X = (x: number) => f.edge + (x - 86.5) * u;
  const light = (stroke: Stroke): Stroke =>
    inherit(stroke, { ...stroke, pen: { ...stroke.pen, weight: stroke.pen.weight * 0.87 } });
  const outer = at(X(457), up(f, 304));
  const outerW = held(f, 370 * u);
  const outerH = held(f, up(f, 366));
  /*
   * The stem's turn lands exactly on the ring, at its widest where it runs
   * upright as the turn arrives, so the two are one smooth run; and the turn
   * is never tighter than the pen will go round -- past that the stem stands
   * further in.
   */
  const joins = 0;
  const landing = bowlPoint(outer, outerW, outerH, 1 - f.square, f.half, joins, f.superness);
  const turnY = landing.y;
  const hook = Math.max((landing.x - X(608)) / 2, f.least * 1.1);
  const stem = landing.x - hook * 2;
  const ends = angleAt(f, outer, outerW, outerH, up(f, -40), false);
  return finish(
    f,
    [
      light(ink(f, ring(f, at(X(442), up(f, 291)), held(f, 165 * u), held(f, up(f, 178))))),
      /*
       * Two runs meeting where the turn lands on the ring, so that a heavy
       * pen, which brings the ring down over the head of the stem, laps two
       * strokes rather than folding one.
       */
      light(
        ink(
          f,
          chain(
            straight(at(stem, up(f, 500)), at(stem, turnY)),
            pinned(turn(at(stem + hook, turnY), hook, 180, 360), 2),
          ),
          f.end,
          BUTT,
        ),
      ),
      light(
        ink(
          f,
          bend(
            f,
            outer,
            outerH,
            joins,
            360 + Math.min(ends, joins - 20) - 360 * (ends > joins ? 1 : 0),
            outerW,
          ),
          BUTT,
          f.end,
        ),
      ),
    ],
    true,
  );
}

/** The c: the o's own ring, cut level on the right at Geist's two heights. */
export function grotesqueC(style: Style): Recipe {
  const f = frame(style);
  const [, t] = smallSpread(f);
  const lerp = (a: number, b: number) => a + (b - a) * Math.min(t, 1.5);
  const H = (y: number) => (y / 530) * f.x;
  const halfW = held(f, (f.bowl / unstretched(f)) * 0.985);
  const centre = at(f.edge + halfW, f.x / 2);
  const head = angleAt(f, centre, halfW, f.bowlH, H(lerp(352, 325)), false);
  const foot = angleAt(f, centre, halfW, f.bowlH, H(lerp(188, 215)), false);
  return finish(f, [ink(f, bend(f, centre, f.bowlH, head, 360 + foot, halfW), f.end, f.end)], true);
}

/**
 * The e: the o's ring from its bar round over the top and the foot to a
 * terminal cut level well up the right side, and the bar straight across, as
 * Geist's is.
 */
export function grotesqueE(style: Style): Recipe {
  const f = frame(style);
  const [, t] = smallSpread(f);
  const lerp = (a: number, b: number) => a + (b - a) * Math.min(t, 1.5);
  const H = (y: number) => (y / 530) * f.x;
  const halfW = held(f, (f.bowl / unstretched(f)) * 0.99);
  const centre = at(f.edge + halfW, f.x / 2);
  // Geist's height, moved with the crossbar control from where the face has it.
  // Past the Black the bar comes down a little, so the eye over it stays open.
  const past = Math.min(1, Math.max(0, t - 1) / 1.24);
  const bar = H(272 - 30 * past) + (f.style.parts.crossbar.height - SANS_CROSSBAR) * f.x;
  const start = angleAt(f, centre, halfW, f.bowlH, bar, false);
  const foot = angleAt(f, centre, halfW, f.bowlH, H(lerp(158, 168)), false);
  uses("crossbar");
  // Out to the ring's own outside edge where the bar meets it, so its right end is flush.
  const side = bowlPoint(centre, halfW, f.bowlH, 1 - f.square, f.half, start, f.superness).x;
  const across = thin(f, straight(at(f.edge, bar), at(side + f.half, bar)));
  /*
   * And lighter than the bowl's crown, as Geist's is: 76 on the Regular's 82,
   * 98 on the Black's 127. An e stacks its crown, its bar and its foot in the
   * x-height, and at the bowl's own weight the eye of a Black was a slit.
   */
  const light = 1 - 0.24 * Math.min(t, 1) - 0.05 * Math.min(Math.max(t - 1, 0), 1.5);
  const pen = across.pen;
  const thick = pen.weight * (1 - pen.contrast) * light;
  return finish(
    f,
    [
      ink(f, bend(f, centre, f.bowlH, start, 360 + foot, halfW), BUTT, f.end),
      inherit(across, { ...across, pen: { ...pen, contrast: 1 - thick / pen.weight } }),
    ],
    true,
  );
}

/*
 * The square capitals -- E F H L T U -- as Geist draws them, Regular to Black
 * and on past it: measured from the left of the ink in Geist's units, each
 * measure run on along the line from the Regular through the Black as the
 * pen grows (so an Ultra's E reaches as much further again as its stem has
 * grown, and its H's counter closes by as much again). The plain forms were
 * fitted at the Regular alone, and at the Black their arms stopped fifty
 * units short and their bars sat a dozen high.
 */

/** Where Geist's ink at `x` (from the left of the ink) falls, and how far along the Regular-to-Black line this weight is. */
function squared(f: Frame): [(x: number) => number, (a: number, b: number) => number] {
  const k = f.style.metrics.width / unstretched(f);
  const t = Math.min(heaviness(f) / 0.67, 2.24);
  return [(x) => f.edge - f.half + x * k, (a, b) => a + (b - a) * t];
}

/** The height of a bar centred on Geist's `y`, moved with the crossbar control. */
function barAt(f: Frame, y: number): number {
  return f.cap * (y / 710 + f.style.parts.crossbar.height - SANS_CROSSBAR);
}

function eff(f: Frame, arms: number[][], middle: number): Stroke[] {
  const [X, lerp] = squared(f);
  const stem = f.edge;
  const heights = [f.hangs(f.cap, f.bar), barAt(f, middle), f.sits(0, f.bar)];
  return [
    ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
    ...arms.map(([a, b], index) => arm(f, stem, X(lerp(a, b)), heights[index])),
  ];
}

/** The E: three arms off the stem, the lowest the longest, the middle a little short. */
export function grotesqueCapitalE(style: Style): Recipe {
  const f = frame(style);
  uses("crossbar");
  return finish(
    f,
    eff(
      f,
      [
        [447, 510],
        [435, 498],
        [455, 518],
      ],
      356,
    ),
  );
}

/** The F: the E's upper arms, the middle one a little lower. */
export function grotesqueCapitalF(style: Style): Recipe {
  const f = frame(style);
  uses("crossbar");
  return finish(
    f,
    eff(
      f,
      [
        [447, 504],
        [429, 486],
      ],
      347,
    ),
  );
}

/** The L: the E's foot alone. */
export function grotesqueCapitalL(style: Style): Recipe {
  const f = frame(style);
  const [X, lerp] = squared(f);
  return finish(f, [
    ink(f, straight(at(f.edge, 0), at(f.edge, f.cap)), f.end, f.end),
    arm(f, f.edge, X(lerp(442, 492)), f.sits(0, f.bar)),
  ]);
}

/** The H: two stems and a bar a little above the middle. */
export function grotesqueCapitalH(style: Style): Recipe {
  const f = frame(style);
  const [X, lerp] = squared(f);
  const left = f.edge;
  const right = Math.max(X(lerp(520, 588)) - f.half, left + f.half * 2 + f.least);
  const bar = barAt(f, 357);
  return finish(f, [
    ink(f, straight(at(left, 0), at(left, f.cap)), f.end, f.end),
    ink(f, straight(at(right, 0), at(right, f.cap)), f.end, f.end),
    thin(f, straight(at(left, bar), at(right, bar))),
  ]);
}

/** The T: a bar hung from the cap line, the stem under its middle. */
export function grotesqueCapitalT(style: Style): Recipe {
  const f = frame(style);
  const [X, lerp] = squared(f);
  const half = (X(lerp(528, 595)) - X(0)) / 2;
  const middle = X(0) + half;
  const top = f.hangs(f.cap, f.bar);
  return finish(f, [
    ink(f, straight(at(middle, 0), at(middle, f.cap)), f.end, BUTT),
    thin(f, straight(at(middle - half, top), at(middle + half, top)), f.end, f.end),
  ]);
}

/** The U: two stems and the trough between them, on Geist's widths. */
export function grotesqueCapitalU(style: Style): Recipe {
  const f = frame(style);
  const [X, lerp] = squared(f);
  const half = Math.max((X(lerp(536, 602)) - X(0)) / 2 - f.half, f.least);
  return finish(f, [trough(f, f.edge, f.cap, half)]);
}

/**
 * The dot of an i or a j: a little wider than the stem and, past the Regular,
 * less tall than wide -- Geist Black's is 177 by 128 on a stem of 172, its top
 * 16 over the ascender. Past the Black it keeps that top and flattens a little
 * further, so an Ultra's dot stays clear of its stem and under its line.
 */
function grotesqueTittle(f: Frame, x: number): Stroke {
  const t = heaviness(f) / 0.67;
  const side = f.half * 1.03;
  const tall =
    side * 2 * (1 - 0.28 * Math.min(t, 1) - 0.14 * Math.min(Math.max(t - 1, 0) / 1.24, 1));
  const top = f.asc + (16 / 530) * f.x * Math.min(t, 1);
  const y = Math.max(top - tall / 2, f.x + f.half * 0.3 + tall / 2);
  const pen = { ...f.style.pen, weight: tall, contrast: 0, angle: 0 };
  return ink({ ...f, style: { ...f.style, pen } }, straight(at(x - side, y), at(x + side, y)));
}

/** The i: the stem and its dot. */
export function grotesqueI(style: Style): Recipe {
  const f = frame(style);
  const stem = f.edge;
  return finish(f, [
    ink(f, straight(at(stem, 0), at(stem, f.x)), f.end, f.end),
    grotesqueTittle(f, stem),
  ]);
}
