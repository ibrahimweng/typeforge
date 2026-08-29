/**
 * The connecting script: what a letter does before it starts and after it ends.
 *
 * Every other face here draws a letter and leaves a gap either side of it. A
 * script does not: the stroke that finishes one letter and the stroke that
 * begins the next are the same stroke, and the boundary between two glyphs
 * falls in the middle of it. That is the whole difference, and nothing about a
 * pen, a weight or a slant can produce it -- which is why a `Handwriting` built
 * out of the controls this engine already had came out as a slanted sans, and
 * why the four faces at the end of `style.ts` needed this file before they
 * could exist.
 *
 * The join is drawn in two halves and the halves have to meet exactly.
 *
 *   The exit leaves the letter's own ink, climbs to the right, and its spine
 *   stops precisely on the advance width at the seam height.
 *
 *   The entry starts precisely on the origin at the same seam height, climbing
 *   in the same direction, and runs until it is inside the letter's ink.
 *
 * Set next to each other, the exit's end and the entry's start are the same
 * point and the same heading, so the two square cuts lie along one line and the
 * pair reads as a single unbroken stroke. There is no overlap to fuse and no
 * gap to kern away: the arithmetic is exact, and it is exact because the
 * advance is *defined* as where the exit ends rather than measured off the ink
 * afterwards the way every other letter's is.
 *
 * Where the join attaches to the letter is found by walking rather than
 * declared. A table of twenty-six entry points and twenty-six exit points is
 * how a script is drawn by hand and is also how it goes wrong the first time a
 * bowl changes width -- so instead the join marches out from the seam until it
 * is within a pen of the letter's own skeleton, and stops there. That answers
 * the `i` without knowing about dots and the `o` without knowing it is a ring,
 * and it keeps working when the shoulder springs higher or the bowl narrows.
 *
 * What it does not do yet is choose a *different* join depending on the letter
 * that follows -- the high exit an `o`, `v`, `w` and `b` want, against the low
 * one everything else takes. That is a contextual substitution, it needs a GSUB
 * table this exporter cannot yet write, and it is the next piece of work rather
 * than a shortcoming of this one. The exit here leaves from wherever the ink
 * actually ends, which on an `o` is already high and on an `n` is already low;
 * what is missing is the *pair*, not the single letter.
 */

import type { Vec2 } from "@/font/types";

import { alongSpine, reversed, spineEnd, spineLength, spineStart } from "./shapes";
import type { Spine, SpineArc } from "./types";

const at = (x: number, y: number): Vec2 => ({ x, y });

/** Two runs end to end, with any piece of no length left out. */
function chained(...spines: Spine[]): Spine {
  return {
    segments: spines.flatMap((spine) =>
      spine.segments.filter(
        (segment) =>
          segment.kind !== "line" ||
          Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y) > 1e-9,
      ),
    ),
    closed: false,
  };
}

/**
 * How the letters of a joined face reach each other, and how steadily.
 *
 * Three of the four settings are about the join and the fourth is about the
 * hand holding the pen. They are kept together because they are the same
 * decision -- how much of this face is handwriting rather than lettering.
 */
export interface Script {
  /** Off for a face whose letters stand apart, which is every face but four. */
  on: boolean;
  /**
   * Where one letter hands over to the next, as a fraction of the x-height.
   *
   * The seam. Low is a script that runs along its baseline; high is one that
   * hands over near the waist, which reads faster and more slanted. It is not
   * a free choice for a face that has to join every pair: whatever it is set
   * to, every letter's exit stops there and every letter's entry starts there,
   * because two letters can only meet at one height.
   */
  height: number;
  /**
   * How far the join runs sideways, in stem widths.
   *
   * This is the face's letter-spacing as well as the shape of its joins, and
   * the two cannot be separated -- the gap between two letters of a joined
   * script *is* the join. Widen it and the writing opens up; close it and the
   * letters crowd, exactly as they would under a hand moving faster.
   */
  reach: number;
  /**
   * The heading the hand hands over on, in degrees above the horizontal.
   *
   * Every exit arrives on it and every entry leaves on it, which is the whole
   * of what makes twenty-six letters meet twenty-six others; see `levelArc`.
   * Nought is level, and level is the one heading that shows, because an arc
   * tangent to the horizontal lies flat for a long stretch either side of the
   * seam and every letter laying one at the same height rules a line through
   * the word.
   */
  tilt: number;
  /**
   * How much of the join runs level at the seam before it turns into the
   * letter, as a fraction of the reach.
   *
   * Nought is a pure curve from one letter into the next, which is a fast hand.
   * Opened up, the join flattens out between the letters and the writing slows
   * down and opens out with it. It cannot go past the reach, because past that
   * there would be no turn left to make.
   */
  flat: number;
  /**
   * How far the ascenders and descenders open into loops.
   *
   * The other thing that separates a script from a slanted sans, and the thing
   * that separates a formal one from a casual one. Nought leaves a straight
   * stroke, which is what a monoline script does; opened up, the ascender
   * becomes a closed eye and the face reads as written rather than drawn.
   *
   * Measured as the width of the eye in stem widths, so it holds at every
   * weight: an eye has to be wide against the pen drawing it, and one measured
   * against the ascender instead comes out as a blob on a heavy face and a
   * balloon on a light one.
   */
  loop: number;
  /**
   * How far the eye bows off the stem it stands on, as a share of its own
   * length -- which is to say how narrow it is for its height.
   *
   * A half is a semicircle: the arc bows out by half the chord, so the eye is
   * exactly half as wide as it is tall. That was not a decision, it was what
   * one arc does when nothing tells it otherwise, and the loops were drawn that
   * way on all four faces. The reference's is a long narrow oval: its `l` turns
   * an eye about one and a half x-heights tall and bows it 0.19 of that, which
   * puts the eye's ink 0.29 of an x-height clear of the stem where ours put it
   * 0.63.
   *
   * Measured at the height the eye is widest -- 1.4 x-heights up on the
   * reference -- ours spanned 0.62 to 0.90 of an x-height against its 0.48, on
   * every one of the four.
   *
   * It is a share of the eye's own length rather than a count of stems because
   * it is a shape and not a size: how deep the eye reaches is `loop`, and this
   * says what shape that depth is drawn as.
   */
  eye: number;
  /**
   * How much each letter departs from the one beside it.
   *
   * A hand does not put two letters on exactly the same baseline at exactly
   * the same angle, and a face where it does reads as a font imitating
   * handwriting rather than as handwriting. Small: a fortieth of the x-height
   * of bounce and a degree or so of lean is already visible in a word and
   * anything more looks like a fault.
   *
   * Deterministic, from the letter's own name, for the same reason the
   * roughening is seeded: a letter that came out somewhere different each time
   * it was drawn could not be cached, compared with itself, or exported.
   */
  irregularity: number;
  /**
   * How far a straight run bows on its way, in stem widths.
   *
   * A hand does not draw a straight line, and this is the difference between a
   * written stem and a plotted one. Nought is the ruled line every other face
   * here is built from.
   *
   * In stem widths like the reach and the loop, and for the same reason -- but
   * it was written as a fraction of the run's own length first, on the
   * reasoning that a long ascender and a short arm should bow by the same
   * *shape*. What that does is bow the long runs furthest in units, and a hand
   * does the opposite: the wrist travels about as far off the line whatever it
   * is drawing.
   *
   * It also broke the loops, which is the part that showed. An eye is struck
   * straight down from the end of the ascender it turns round and has to land
   * back on that ascender; a Monoline stem bowed by three per cent of a
   * nine-hundred-unit run has moved twenty-seven units at the middle against a
   * pen of twenty-eight, so the eye came down beside its own stem. `minimum`
   * came off that face unreadable.
   */
  bow: number;
  /**
   * How far each half of a join carries past the seam into the other, in stem
   * widths.
   *
   * Two letters of a joined face meet where one's advance is the next one's
   * origin: the lead-out's spine stops there and the lead-in's spine starts
   * there, both running level, so the two touch at a point. Both are cut
   * square, so the ink meets along a single vertical line and over no area at
   * all -- and a pair of `n`s on the Formal Script overlapped by sixteen units
   * of a four-hundred-and-thirty-unit x-height, which is nothing. The letters
   * are joined, and they read as two letters that have been pushed together.
   *
   * Dancing Script overlaps its pairs by about sixteen hundredths of its
   * x-height, which is most of a stem width, and that is the difference
   * between a line of writing and a row of letters: the join is welded over a
   * length of stroke rather than tacked at a point.
   *
   * So each half carries on past the seam by this much and the two cross. The
   * advance does not move, so the fit is untouched -- this is not tracking,
   * and a face can be crowded or opened with `reach` exactly as before.
   *
   * In stem widths like the reach, the loop and the bow: how far one stroke
   * runs into another to weld it is a fact about the pen, and the reference's
   * sixteen hundredths of an x-height is most of a stem on a face whose stem
   * is nineteen hundredths of its x-height.
   */
  knit: number;
}

export const NO_SCRIPT: Script = {
  on: false,
  height: 0.4,
  reach: 1.5,
  tilt: 0,
  flat: 0.2,
  loop: 0,
  eye: 0.5,
  irregularity: 0,
  bow: 0,
  knit: 0,
};

/**
 * The letters a written hand leaves from high.
 *
 * An `o`, a `v`, a `w` and a `b` all finish at the top of themselves -- the pen
 * comes round the bowl or up the last arm and is already at the waist when the
 * letter is done. Every other lowercase letter finishes at the baseline. That
 * is the one thing about a joined script that is a fact about a *pair* rather
 * than about a letter: either of the two drawn alone is unremarkable, and only
 * the two set together is wrong.
 *
 * These four are the set every writing manual names, and they are the reason a
 * script font needs a GSUB table at all.
 */
export const HANDS_OVER_HIGH = new Set(["o", "v", "w", "b"]);

/**
 * Where the high join crosses, as a fraction of the x-height.
 *
 * Near the waist rather than at it. At the x-height the join would run along
 * the top of the letters, which is a different thing altogether -- what a hand
 * does after an `o` is leave a little below the widest point and carry across
 * at about three quarters of the way up.
 */
const HIGH = 0.76;

/**
 * The two heights a join can cross at on this face.
 *
 * The low one is where the face asks, but never lower than the lead-out can
 * reach. That band runs from half a pen above the baseline up to the seam, so a
 * seam under half a pen leaves it empty -- and `attach` then falls back to the
 * whole letter and takes its rightmost point wherever it happens to be. A word
 * came out threaded together through the tops of its arches. A quarter of a pen
 * of room is enough for the band to find the foot of a stem in.
 *
 * Every part of the join has to agree about where this is, and so does the
 * lean: a shear leaves its own pivot line where it was, and the seam is the one
 * line it can be pivoted on without opening the joins. So this is the one place
 * that answers, and the pen is passed in because the floor is measured in it.
 */
export function seamsOf(script: Script, x: number, half: number): { low: number; high: number } {
  const low = Math.max(script.height * x, half * 1.25);
  return { low, high: Math.max(low, HIGH * x) };
}

/**
 * Which height each half of one letter's join crosses at.
 *
 * Both are the low seam on an ordinary letter. A letter that hands over high
 * leaves at the high one, and a letter drawn to be *set after* one of those
 * arrives at the high one -- which is a different drawing of the same letter,
 * and is what the contextual alternate substitutes in.
 */
export interface Crossing {
  entry: number;
  exit: number;
}

/** The measurements a join needs, which is fewer than a letter does. */
export interface Room {
  /** Half the pen: how far ink stands off its own spine. */
  half: number;
  /**
   * How far ink stands off a run lying along a line.
   *
   * Half the pen for a pen that is round, and not otherwise -- a nib held at an
   * angle is at its widest across a horizontal and at its narrowest across an
   * upright. The loop needs it because the loop is level where it meets the
   * stem, and how far its ink reaches past that point is the whole question of
   * whether a looped `l` stands taller than a plain one.
   */
  upright: number;
  /**
   * The pen's narrowest reach: how far ink is certain to stand off its spine,
   * whichever way the spine runs.
   *
   * Half the pen is how far it reaches at its widest, and testing a point
   * against that says the point *might* be inked. This says it is. The
   * difference is the whole of a nib: at a contrast of 0.78 the Formal Script's
   * pen is a fifth as wide one way as the other.
   */
  narrow: number;
  /** The x-height. */
  x: number;
  /**
   * The face's own sidebearing, for whichever side of the letter has no join
   * reaching out of it.
   *
   * A joined face has no sidebearings -- the space either side of a letter is a
   * stroke and not a space -- and that holds only while both halves are drawn.
   * A capital reaches out on its right and never on its left, so its left has
   * to be spaced the way every other face spaces everything.
   */
  sidebearing: number;
}

/** Which halves of the join a letter has. */
export interface Ends {
  /** A lead-in reaching out of its left, into the letter set before it. */
  entry: boolean;
  /** A lead-out reaching out of its right, into the letter set after it. */
  exit: boolean;
}

export const BOTH_ENDS: Ends = { entry: true, exit: true };

export interface Join {
  /** From the origin at the seam into the letter's own ink. */
  entry: Spine | null;
  /** From the letter's ink out to the advance, at the seam. */
  exit: Spine | null;
  /** How far the letter itself has to move over to make room for the entry. */
  inset: number;
  /** Where the exit stops, which is what the letter's advance must be. */
  width: number;
}

/*
 * How finely the letter's skeleton is sampled when the join goes looking for
 * where to attach.
 *
 * Sixty-four points along each run puts the attachment within about a sixtieth
 * of a stroke of the true extreme, which on a lowercase letter is a unit or
 * two -- under a tenth of the pen, and invisible.
 */
const SAMPLES = 64;

/**
 * How high up a round letter the lead-in may land, as a share of the x-height.
 *
 * Below the widest point, which is the whole of it: at the widest point the
 * bowl's edge is running straight up and the entry has to arrive across it,
 * and a third of the way up it is still opening out and the entry arrives
 * along it. Half was no use -- a bowl is widest at half its height, so that is
 * the very point being avoided. A quarter and a third draw the same letter;
 * a third keeps more of the bowl available on the faces whose seam sits high.
 */
/**
 * How far past its own advance a letter may hang, as a share of the x-height.
 *
 * Read off the reference: its `l` reaches 0.33 of an x-height past its advance,
 * its `f` 0.25 and its `d` 0.22, and every letter with nothing above the waist
 * stops between 0.09 and 0.11. So this is what a loop costs the letter beside
 * it, and it is the most one is allowed to cost.
 */
/**
 * What a round letter's share of the reach and the sidebearing is, against a
 * stemmed one's.
 *
 * The reference's `o` sets at 1.10 of an x-height with a bowl 1.163 wide -- an
 * advance narrower than the letter, so the next one laps onto the bowl. Ours
 * had the bowl right to a thousandth and set it at 1.38, because a whole reach
 * was added at each end of it.
 *
 * Swept, and stopped by two things rather than by taste. At 0.7 the four faces
 * read 1.12, 1.09, 1.13 and 1.01 of the reference's width; at 0.45, 1.09, 1.06,
 * 1.10 and 0.99; at 0.25, 1.07, 1.03, 1.07 and 0.96. Below about 0.45 the ink
 * of `e.begin` starts left of its own origin -- 2 units at 0.25 -- and a letter
 * that begins a word may not do that; and the Casual Script folds thirteen
 * letters at a pen of 8 and pulls them apart.
 */
const ROUND_REACH = 0.45;

const HANGS_OVER = 0.33;

const ROUND_ENTRY = 0.35;

/**
 * An arc from the seam to a point, level where it leaves the seam.
 *
 * The one piece of arithmetic this file could not do without, and the thing
 * that makes every letter of a joined face meet every other exactly.
 *
 * A stroke cut square across itself leaves an end face at right angles to the
 * way it was travelling. Two such faces meet with no gap and no overlap only if
 * the strokes arrive travelling the same way -- so if the join is to close for
 * every pair of the twenty-six letters rather than for the few that happen to
 * agree, every exit must arrive at the seam on the same heading and every entry
 * must leave it on that heading. Any *fixed* heading has that property -- what
 * matters is only that it does not depend on the letter, so the shape either
 * side can climb as steeply as it likes and still hand over on the agreed one.
 *
 * Level was picked because it is the simplest, and it turned out to be the one
 * heading that shows. An arc tangent to the horizontal lies flat for a long
 * stretch either side of the seam, and every letter of a word laying such a
 * stretch at the same height is a rule drawn through the word. The reference
 * hands over climbing: sliced down its own advance its lowercase carries ink
 * through 0.15 of an x-height, where a level handover carries it through half
 * that.
 *
 * There is exactly one circle through a given point and tangent to a given
 * direction at another, so nothing here is chosen -- it is solved. The minor
 * arc of it is the one taken, and taking the minor arc is also what gets the
 * direction right: on the major arc the stroke would leave the seam travelling
 * backwards.
 */
function levelArc(seam: Vec2, target: Vec2, room: Room, along: Vec2 = at(1, 0)): Spine {
  const line: Spine = { segments: [{ kind: "line", from: seam, to: target }], closed: false };
  /*
   * The centre is on the normal at the seam, so C = seam + r*n, and |C - T| = r
   * gives r = -|seam - T|^2 / (2 (seam - T) . n). One solve, nothing chosen. At
   * a level heading the normal is (0, 1) and this comes to (dx^2 + dy^2) /
   * (2 dy), which is what stood here before a heading could be asked for.
   */
  const length = Math.hypot(along.x, along.y) || 1;
  const unit = at(along.x / length, along.y / length);
  const normal = at(-unit.y, unit.x);
  const away = at(seam.x - target.x, seam.y - target.y);
  const under = 2 * (away.x * normal.x + away.y * normal.y);
  // Straight at the target already: there is no circle, and none is wanted.
  if (Math.abs(under) < 1e-6) return line;
  const radius = -(away.x * away.x + away.y * away.y) / under;
  /*
   * And no tighter than the pen can turn. A spine whose radius is under half
   * the pen has an inner edge that has passed through itself, which is not a
   * tight curve but a folded stroke -- and it shows up as a letter with a knot
   * in it rather than as anything anybody would call a join. Where the turn
   * would be that tight there is nothing to turn: the two ends are less than a
   * pen apart, so a straight run between them is the same shape.
   */
  if (Math.abs(radius) < room.half * 1.2) return line;
  const centre = at(seam.x + normal.x * radius, seam.y + normal.y * radius);
  const startAngle = Math.atan2(seam.y - centre.y, seam.x - centre.x);
  const finish = Math.atan2(target.y - centre.y, target.x - centre.x);
  let sweep = finish - startAngle;
  while (sweep > Math.PI) sweep -= Math.PI * 2;
  while (sweep <= -Math.PI) sweep += Math.PI * 2;
  const arc: SpineArc = {
    kind: "arc",
    centre,
    radius: Math.abs(radius),
    startAngle,
    endAngle: startAngle + sweep,
    sweepPositive: sweep > 0,
  };
  return { segments: [arc], closed: false };
}

/** Every run of the letter, as points, for the join to find its edges by. */
function skeleton(spines: Spine[]): Vec2[] {
  const points: Vec2[] = [];
  for (const spine of spines) {
    if (spineLength(spine) <= 0) continue;
    points.push(...alongSpine(spine, SAMPLES));
  }
  return points;
}

/**
 * Where the lead-in lands, and where the lead-out leaves from.
 *
 * Found by looking at the letter rather than by a table of fifty-two entries,
 * and the band each one searches is the whole of the decision.
 *
 * The lead-in wants the letter's left edge somewhere between the seam and the
 * x-height, which is where a hand arrives: on an `n` that is the top of the
 * first stem, so the entry and the stem meet at a point the way an up-stroke
 * and a down-stroke do; on an `o` it is the widest part of the bowl. Searching
 * the whole letter instead would find the dot of an `i` and the hook of an `f`,
 * both of which sit above everything a join has any business touching.
 *
 * The lead-out wants the right edge at or below the seam, which is where a hand
 * leaves: low on an `n`, and on an `o` a little under the widest point rather
 * than above it. That last is the compromise in this file. A written `o` hands
 * over high, and so do a `v`, a `w` and a `b` -- but only when something
 * follows them, which is a fact about the pair and not about the letter. Until
 * there is a GSUB table to say so, every letter leaves the same way, and
 * leaving low is the one that looks like handwriting for twenty-two of the
 * twenty-six rather than for four.
 */
function attach(
  points: Vec2[],
  band: (point: Vec2) => boolean,
  side: "left" | "right",
  near?: (point: Vec2) => number,
): Vec2 {
  const inside = points.filter(band);
  /*
   * And when nothing is in the band, the nearest thing to it -- not the whole
   * letter, which is what this used to fall back on and is exactly the search
   * the note above says not to make.
   *
   * The bands are thin. A lead-out looks between half a pen and the seam, and
   * on the Formal Script at its new proportions that is a strip seven units
   * tall; the skeleton is sampled sixty-four times per run whatever the run's
   * length, which on that letter's eight-hundred-unit stem is a step of
   * thirteen. So the sampling walked straight over the strip, the band came
   * back empty, and the fallback handed the join the rightmost point of the
   * whole letter -- the top of the `f`'s hook, seven hundred units up. The
   * letter's lead-out left from the tip of its ascender.
   *
   * Nothing in the band means the letter has nothing there to attach to, and
   * the answer is the closest it does have, which is a point on the same stem a
   * few units above or below. Where the band has anything at all this changes
   * nothing.
   */
  const looking = inside.length > 0
    ? inside
    : near
      ? nearest(points, near)
      : points;
  let best = looking[0];
  for (const point of looking) {
    if (side === "left") {
      // Leftmost, and of the leftmost the highest: a stem is one x all the way
      // up, and a hand arrives at the top of it rather than the middle.
      if (point.x < best.x - 1e-9 || (Math.abs(point.x - best.x) <= 1e-9 && point.y > best.y)) best = point;
    } else if (point.x > best.x + 1e-9 || (Math.abs(point.x - best.x) <= 1e-9 && point.y < best.y)) {
      best = point;
    }
  }
  return best;
}

/** Every point equally closest to the band, by whatever measure it gives. */
function nearest(points: Vec2[], howFar: (point: Vec2) => number): Vec2[] {
  let least = Infinity;
  for (const point of points) least = Math.min(least, howFar(point));
  return points.filter((point) => howFar(point) <= least + 1e-9);
}

/**
 * The same run somewhere else.
 *
 * A translation and nothing else, which matters: it is the only transform an
 * arc comes through as an arc, so it is the only one a skeleton in this engine
 * may be put through. Everything that is not a translation -- the face's slant,
 * a letter's own extra lean -- is taken on the finished outline instead, where
 * a shear maps a cubic to a cubic and costs nothing.
 */
export function movedSpine(spine: Spine, dx: number, dy: number): Spine {
  if (dx === 0 && dy === 0) return spine;
  return {
    ...spine,
    segments: spine.segments.map((segment) =>
      segment.kind === "line"
        ? {
            ...segment,
            from: at(segment.from.x + dx, segment.from.y + dy),
            to: at(segment.to.x + dx, segment.to.y + dy),
          }
        : { ...segment, centre: at(segment.centre.x + dx, segment.centre.y + dy) },
    ),
  };
}

/**
 * The loops a written ascender and descender open into.
 *
 * The second thing that separates a script from a slanted sans, and the one
 * that separates a formal hand from a casual one. A drawn ascender is a stem
 * that stops; a written one is a stroke that went up, came back down beside
 * itself, and left an eye where the two passed -- because a hand that has to
 * get back to the baseline to carry on writing does not lift off and start
 * again, it turns round.
 *
 * Added beside the stem rather than replacing it, which is both simpler and
 * more honest about what a hand does: the up-stroke and the down-stroke are two
 * strokes that touch, and the loop is the turn between them. One arc bowed hard
 * to the left of the stem is that turn.
 *
 * Only on runs that cross the x-height or the baseline on their way out. That
 * rules out the dot of an `i`, which is above the x-height and is not an
 * ascender, without this having to know what an `i` is.
 */
function loopsOn(spines: Spine[], room: Room, script: Script): Spine[] {
  if (script.loop <= 0) return [];
  const out: Spine[] = [];
  /*
   * How wide the eye is, which is the number that decides whether there is one.
   *
   * Written as a fraction of the ascender first, and that was wrong in a way
   * worth keeping a note of: the arc this draws is a semicircle at its widest,
   * so its radius is half its own height, and half an ascender on this face is
   * ninety units against a pen of eighty-four. The loop came out with a hole
   * eight units across -- a blob on a stem rather than an eye. An eye has to be
   * wide against the *pen*, not against the letter, so that is what it is
   * measured in.
   */
  const wide = script.loop * room.half * 2;
  if (wide < room.half) return [];

  /*
   * One loop up and one loop down, and no more.
   *
   * A hand turns round once at the top of a letter and once at the bottom,
   * whatever the letter is built from. A `y` here is drawn as an arm and a
   * tail, and both of them end below the baseline -- so asking each run
   * separately gave it two descender loops, one inside the other. The letter
   * has the loops, not the strokes: the highest end above the x-height gets the
   * one, the lowest end below the baseline gets the other.
   */
  // The run each end belongs to is carried along with it: the eye is struck on
  // that run and nowhere else, so it is that run it has to be checked against.
  let top: { end: Vec2; on: Spine } | null = null;
  let foot: { end: Vec2; on: Spine } | null = null;
  for (const spine of spines) {
    if (spine.closed || spineLength(spine) <= 0) continue;
    const ends = [spineStart(spine), spineEnd(spine)];
    const highest = Math.max(...ends.map((one) => one.y));
    const lowest = Math.min(...ends.map((one) => one.y));
    for (const end of ends) {
      // An ascender goes up out of the x-height; a descender goes down out of
      // the baseline. A run that stays entirely one side of the line it would
      // have crossed is a mark rather than a stroke -- which is what keeps the
      // dot of an `i` from being treated as an ascender.
      if (end.y > room.x && lowest < room.x && (!top || end.y > top.end.y)) top = { end, on: spine };
      if (end.y < 0 && highest > 0 && (!foot || end.y < foot.end.y)) foot = { end, on: spine };
    }
  }

  for (const [found, rising] of [[top, true], [foot, false]] as const) {
    if (!found) continue;
    const { end, on: run } = found;
    /*
     * A loop may not turn round past the line the stroke came from. One on an
     * `l` reaches down past the x-height, which is what a written one does; one
     * that reached past the baseline would be drawn through the letter after it.
     */
    /*
     * And the room is measured to where the *ink* has to stop, not to where the
     * spine may go. A loop turning round at the x-height puts an upright reach
     * of ink above it, and the `y`'s arms are supposed to be the highest thing
     * on that letter: opening the loops far enough to reach the reference's put
     * the eye fifty units over the line the arms stop on.
     *
     * Twice the reach, not once. The turn is already set an upright reach in
     * from the end it hangs from, and the far end of the eye then stands
     * another one proud of its own spine -- taking one off left the `y`
     * twenty-nine units over instead of fifty.
     */
    const available = (rising ? end.y : room.x - end.y) - room.upright * 2;
    /*
     * And a descender's loop lives in the descender.
     *
     * `available` is how far the eye may be let out before it fouls something,
     * and for a falling loop that is the whole way up to the x-height -- which
     * is the ceiling, not the size. Struck at the size the `loop` asks for, the
     * eye on a `g` was 1.23 x-heights long on a descender 0.84 deep, so it
     * turned round well up inside the bowl and was at its widest just under the
     * baseline: two strokes an x-height apart at -0.1, where the reference has
     * one stroke a fifth of an x-height wide and does not open out until -0.3.
     * Ours read two and a half to seven times as wide as the reference's all
     * the way down.
     *
     * A written descender goes down, turns, and comes back up into the stroke
     * it left -- it does not climb into the letter to do it. So the eye starts
     * out no longer than the descender it hangs from, and `reaching` still lets
     * it out past that if that is what it takes to land on the letter.
     */
    const asked = rising ? available : Math.min(available, -end.y - room.upright);
    const deep = Math.min(wide * 2, asked);
    // Radius is half the chord at a semicircle, so this is the same floor the
    // join keeps: no turn tighter than the pen can go round.
    if (deep < room.half * 2.4) continue;
    /*
     * The eye stops short of the stem's own end by exactly what its ink will
     * reach back over.
     *
     * At the top of the loop the stroke is running level, and a stroke running
     * level stands its full upright reach above its own spine -- while the stem
     * it is meeting is cut square and stands nothing above its. Ended flush
     * with that stem, the loop on a Formal Script `b` topped out at 820 against
     * a stem topping at 801 and an ascender at 790, and the same letter with
     * its loop turned off was on its line. So a letter grew twenty units taller
     * for having a loop on it.
     *
     * A share of the pen was the first answer and it was wrong in both
     * directions: four tenths was right on the Formal Script, whose nib is
     * narrow across a horizontal, and the same four tenths left the Monoline's
     * loop twenty units proud, because a round pen is at its full width across
     * everything. The number is not a share of anything -- it is the reach
     * itself, and the frame already knows it for whatever pen the face has.
     */
    const tip = at(end.x, rising ? end.y - room.upright : end.y + room.upright);
    /*
     * How far the eye reaches back is the pen's business until it stops
     * reaching the letter, and then it is the letter's.
     *
     * `wide` is measured in pen-halves, which is right for how *open* the eye
     * is -- an eye has to be wide against the pen or it is a blob. It is wrong
     * for how *far* the eye has to travel to get home, because that distance
     * belongs to the letter and does not shrink when the pen does. On the
     * Formal Script's curled `g` the eye reached y=164 at pen 84, well up
     * inside the bowl, and y=-19 at pen 40, which is below the bowl entirely:
     * struck in clear air, and joined to the letter by nothing but the hairline
     * where its turn grazed the tail -- this face's nib is 6.6 units across a
     * horizontal at that weight. The letter came off the pen in two pieces.
     *
     * So the eye is let out, as far as it needs and no further, until its far
     * end is standing on the letter. A weight where it already reaches is left
     * exactly as it was.
     */
    const home = rising
      ? { much: deep, over: 0 }
      /*
       * Asked with the pen's narrow reach rather than its wide one.
       *
       * `standsOn` within half a pen is a fair test for a round pen and an
       * optimistic one for a nib: a point half a pen from a spine has ink on it
       * only in the direction the nib is widest. It passed anyway for as long as
       * the eye was a semicircle, because a semicircle bulges sideways into the
       * letter and the two met there rather than at the foot. Narrowed to the
       * reference's shape the bulge is gone, the foot is all there is, and the
       * Casual Script's descending `f` came apart at four weights.
       */
      : reaching(spines, end, deep, available, room.narrow, room.x);
    const start = at(end.x + home.over, rising ? tip.y - deep : tip.y + home.much);
    /*
     * An eye on an ascender stands on that ascender or it is not drawn.
     *
     * It is struck straight down from the end it turns round, so its foot lands
     * back on the run only if that run goes straight down from there. Every
     * ascender here does except the `f`'s, which ends in a hook: its highest
     * end is a radius off to the side of its own stem, the eye was struck out
     * in clear air beside the letter, and the `f` came apart into two pieces on
     * both faces that loop.
     *
     * Checking against the whole letter instead of against the one run let the
     * `f` through anyway: its foot came down within half a pen of the far end
     * of the crossbar, which is drawn thin and never had ink out that far. The
     * run the eye turns round is the one it has to find.
     *
     * The eye on a descender is struck the other way, up into the body of the
     * letter and well past the end of the run that earned it -- a different
     * question, asked and answered nowhere, and left here as it was.
     */
    if (rising && !standsOn(run, start, room.half)) continue;
    /*
     * A half is as far as a single arc bows: at a half it is a semicircle, and
     * past that the construction below is asked for a sagitta larger than its
     * own radius and quietly gives back a shallower arc instead. So how far
     * down the stem the eye starts is how tall it is, and `eye` is how wide it
     * is drawn for that height -- a half being the semicircle this used to be
     * whatever the face wanted.
     */
    const shape = Math.max(0, Math.min(0.5, script.eye));
    /*
     * And an eye narrower than the pen drawing it is a blob rather than an eye,
     * which is the same thing `wide` guards at the other end. What has to clear
     * the pen is the part of the eye that is not the stem: the arc's rise, less
     * what the two strokes' own ink takes out of the middle of it.
     */
    if (deep * shape < room.upright * 1.5) continue;
    out.push(bowed(start, tip, rising ? shape : -shape));
  }
  return out;
}

/**
 * The shortest reach, no smaller than the one asked for, that puts a descender
 * eye's far end back on the letter -- or the one asked for, if none does.
 *
 * Walked out in pen-halves rather than solved, because what it is walking over
 * is the letter's whole outline and there is nothing to solve against.
 */
function reaching(
  spines: Spine[],
  end: Vec2,
  deep: number,
  available: number,
  half: number,
  across: number,
): { much: number; over: number } {
  const lands = (much: number, over: number) =>
    spines.some((one) => standsOn(one, at(end.x + over, end.y + much), half));
  if (lands(deep, 0) || half <= 0) return { much: deep, over: 0 };
  for (let much = deep + half; much <= available; much += half) {
    if (lands(much, 0)) return { much, over: 0 };
  }
  /*
   * And sideways, over the whole letter rather than a stem or two.
   *
   * The eye is struck straight up from the end it hangs off, and that is an
   * assumption about where the rest of the letter is rather than a fact about
   * it. Draw the `g`'s bowl to the reference's width and the line straight up
   * from its tail rises through where the bowl used to be: at pen 40 the eye
   * came out a crescent hanging off the bottom left with the letter's body two
   * hundred units away up and to the right, and no length of eye reaches
   * something it is not pointing at. Leaning it a stem or two does not either
   * -- the distance is the letter's, not the pen's.
   *
   * Straight up first and leaning only if that fails, so every letter that
   * never needed it is drawn exactly as it was.
   */
  for (let over = half; over <= across; over += half) {
    for (const side of [over, -over]) {
      if (lands(deep, side)) return { much: deep, over: side };
      for (let much = deep + half; much <= available; much += half) {
        if (lands(much, side)) return { much, over: side };
      }
    }
  }
  return lands(available, 0) ? { much: available, over: 0 } : { much: deep, over: 0 };
}

/** Whether this run passes under the point, for a loop to stand on it. */
function standsOn(spine: Spine, point: Vec2, reach: number): boolean {
  return alongSpine(spine, SAMPLES).some(
    (one) => Math.hypot(one.x - point.x, one.y - point.y) <= reach);
}

/** An arc from one point to another, bowed out by a fraction of the chord. */
function bowed(from: Vec2, to: Vec2, amount: number): Spine {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-9) return { segments: [{ kind: "line", from, to }], closed: false };
  const side = amount < 0 ? -1 : 1;
  const rise = Math.abs(amount) * chord;
  const radius = (chord * chord) / (8 * rise) + rise / 2;
  const middle = at((from.x + to.x) / 2, (from.y + to.y) / 2);
  const left = at((-dy / chord) * side, (dx / chord) * side);
  const back = Math.sqrt(Math.max(0, radius * radius - (chord * chord) / 4));
  const centre = at(middle.x - left.x * back, middle.y - left.y * back);
  const startAngle = Math.atan2(from.y - centre.y, from.x - centre.x);
  let sweep = Math.atan2(to.y - centre.y, to.x - centre.x) - startAngle;
  while (sweep > Math.PI) sweep -= Math.PI * 2;
  while (sweep < -Math.PI) sweep += Math.PI * 2;
  const arc: SpineArc = {
    kind: "arc",
    centre,
    radius,
    startAngle,
    endAngle: startAngle + sweep,
    sweepPositive: sweep > 0,
  };
  return { segments: [arc], closed: false };
}

/**
 * The loops this letter's ascenders and descenders open into, if any.
 *
 * `takes` is the letter's own answer to whether it has an ascender or a
 * descender to loop -- a question this cannot see from the spines, which is
 * exactly how every capital built on an upright came to have one.
 */
export function planLoops(
  spines: Spine[],
  room: Room,
  script: Script,
  takes = true,
): Spine[] {
  return script.on && takes ? loopsOn(spines, room, script) : [];
}

/**
 * The two halves of the join, the room the letter needs, and the width it ends
 * up with.
 *
 * `spines` is the letter as its recipe drew it, before any join. The letter's
 * own shape decides where the join attaches; the script's settings decide the
 * rest.
 *
 * `inset` is how far the letter has to move over to make room for its own
 * lead-in, and the caller has to apply it -- to the letter, not to the join,
 * which is already drawn where it belongs. That is the one awkward part of this
 * arrangement and it is deliberate: a joined face has no sidebearing to be
 * nudged inside of, because the space either side of the letter is a stroke and
 * not a space, so the room has to be made here where the size of that stroke is
 * known.
 */
export function planJoin(
  spines: Spine[],
  room: Room,
  script: Script,
  crossing?: Crossing,
  ends: Ends = BOTH_ENDS,
  round = false,
  waist: number | null = null,
  air = 0,
): Join | null {
  /*
   * A letter with neither end still comes through here, and only the strokes
   * fall away. What it is here for is the spacing: a joined face has no
   * sidebearing to be nudged inside of, so the room either side of a letter is
   * worked out here or nowhere -- and a letter that has been asked to give up
   * both its joins is still a letter of that face. Sent down the plain roman
   * path instead it is spaced off its own raw ink, which on a script `f` with
   * a descender loop under it is most of a second letter's width.
   */
  if (!script.on) return null;
  const points = skeleton(spines);
  if (points.length === 0) return null;

  const seams = seamsOf(script, room.x, room.half);
  const entryAt = crossing?.entry ?? seams.low;
  const exitAt = crossing?.exit ?? seams.low;
  /*
   * A round letter takes too much room here, and this is not where to fix it.
   *
   * The reference's `o` is the plainest statement of it in the whole font: its
   * bowl runs 0.03 to 1.19 of an x-height and its ink runs -0.03 to 1.19, so
   * the join hangs 0.06 past the bowl on the left and nothing at all on the
   * right. Its `n` is the opposite -- ink from -0.11 to 1.49 around a body of
   * about 0.98, which is a third of an x-height of tail at each end.
   *
   * A round letter needs no tail because its own stroke is the join: the hand
   * leaves the top of the bowl already travelling into the next letter, and the
   * advance (1.10) is shorter than the ink (1.22), so the letter after it
   * starts inside this one. A stem has no such stroke to spare and has to grow
   * one.
   *
   * Ours gives every letter the same tail and the round ones wear it worst --
   * hanging 0.26 to 0.38 of an x-height off the left of an `o`, all of them at
   * the same height, so a word comes out with a rule drawn through it at the
   * writing line. It costs the spacing as well as the look: the tail is added
   * to the advance at both ends, so an `o` sets at 1.32 against 1.10.
   *
   * Scaling this reach down for a round letter was tried and backed out. It
   * works -- a quarter of it brings the `o` to 1.11 to 1.13 and the four faces
   * to a fit of 1.05, 1.01, 1.05 and 0.96 -- and it breaks a promise the rest
   * of the font keeps: the reach is the room the letter takes as well as the
   * stroke it draws, and a side with no join stands in the sidebearing
   * instead. Cut the reach below the sidebearing and a letter that gives up a
   * join gets *wider*, so an `o.end` would set a word wider at its end than in
   * its middle. Four tests say so and they are right.
   *
   * The room and the stroke want separating, and the room is the one that is
   * wrong. It is measured at the letter's widest point; on a round letter that
   * is the waist, and no neighbour ever comes near the waist -- the letter
   * after an `o` arrives at the seam, a fifth of an x-height up, where the
   * bowl has already curved away. That is the same argument the band above
   * makes vertically, unmade horizontally. Measured there, a round letter
   * would take less room without its stroke growing shorter, and the reference
   * says how much less: its `o` sets at 1.10 with its bowl 1.16 wide, an
   * advance narrower than the letter, so the next letter laps onto the bowl.
   */
  /*
   * A round letter reaches less far, and stands in less of a sidebearing when
   * it has no join on a side.
   *
   * Both scaled by the same figure, because `reach` is two things at once: how
   * far the join stroke draws, and how much room the letter takes at that end.
   * Scale only the first and a letter that gives up a join comes out wider than
   * the one that kept it, which is an `o.end` setting a word wider at its end
   * than in its middle. Scaled together, a round letter is simply tighter on
   * every side, which is what round letters are in a roman face too.
   */
  const roundly = round ? ROUND_REACH : 1;
  const reach = script.reach * room.half * 2 * roundly;
  const side = room.sidebearing * roundly;

  /*
   * The bands stop half a pen inside the letter's own lines rather than on
   * them.
   *
   * A join attached exactly at the top of a `v`'s left arm ends with half a pen
   * of ink standing proud of the x-height -- the cut is square to the way the
   * join was travelling, and it arrives climbing. Every face here promises that
   * its letters stop on their lines, and a stroke that arrives at a line from
   * underneath has to stop short of it to keep that promise. Half a pen in is
   * where the join is buried inside ink the letter already had.
   */
  const offBand = (low: number, high: number) => (point: Vec2) =>
    Math.max(0, low - point.y, point.y - high);
  /*
   * A round letter is joined below its widest point, where its edge is still
   * climbing; everything else is joined at the top of the run the hand arrives
   * at.
   *
   * The band is the whole of the decision and it was the same band for both.
   * On a stem that is right -- the entry and the stem meet at a point, the way
   * an up-stroke meets a down-stroke. On a bowl it lands on the leftmost point
   * there is, which is the widest part, and the entry then has to climb from
   * the seam to the middle of the letter's height over whatever horizontal run
   * is left. Draw the bowl narrower and that run shortens: the arc stands up,
   * and a stroke a whole pen wide arriving steeply at the side of a bowl puts
   * its ink straight through the wall and takes a bite out of the counter.
   * That is what stopped the round letters being drawn to the reference's
   * width -- a notch in the `o` and the `e` on two faces at a bowl of 0.71.
   *
   * Landing under the widest point gives the entry the bowl's own lower left
   * to arrive along, so it meets the curve going the way the curve goes. It is
   * also where a hand enters an `o`: at the bottom of the stroke, not at its
   * side.
   */
  const ceiling = round ? room.x * ROUND_ENTRY : room.x - room.half;
  const lands = attach(points, (point) => point.y >= entryAt && point.y <= ceiling,
    "left", offBand(entryAt, ceiling));
  /*
   * The lead-out searches below its own crossing on an ordinary letter and
   * above it on one that hands over high -- which is the whole of the
   * difference between the two. An `n` is left from the foot of its last stem
   * and an `o` from the top of its bowl, and a band that looked in one
   * direction only would find the wrong end of one of them.
   */
  const leaves = exitAt > seams.low
    ? attach(points, (point) => point.y >= exitAt && point.y <= room.x - room.half,
      "right", offBand(exitAt, room.x - room.half))
    : attach(points, (point) => point.y >= room.half && point.y <= exitAt,
      "right", offBand(room.half, exitAt));

  /*
   * How much room the letter takes, which is not the same question as where the
   * join attaches to it and was written as though it were.
   *
   * The lead-out leaves from the letter's right edge *at or below the seam*,
   * and on a `w` or a `v` that is a good way in from the letter's actual right
   * edge -- the arms lean out as they rise, so the widest part is at the top and
   * the join leaves from the bottom. Spaced by the attachment, every one of
   * those letters was handed an advance that ended inside its own ink and the
   * letter after it was set on top of it.
   *
   * So the room comes from the whole letter and the attachment only says where
   * the stroke starts. Half a pen either side of the outermost run is the ink's
   * own edge closely enough for spacing -- and it does not have to be exact,
   * because what has to be exact is that the lead-out stops on the advance,
   * whatever the advance turns out to be.
   */
  /*
   * And measured on the part of the letter that shares a line with its
   * neighbours, which is the part at or below the x-height.
   *
   * What rises above that hangs over the letter beside it, because there is
   * nothing there to hang over: the next letter's body is down at the line. A
   * written `l` is a stem with a loop over it, and spaced by the loop it is as
   * wide as an `o` -- which is exactly what these faces did. The reference
   * gives its `l` an advance of 0.71 x-heights and lets the ink run 1.04, a
   * third of an x-height out past the advance; ours were 1.08, 1.73, 1.19 and
   * 1.79, and its `d`, `b`, `k`, `f` and `h` went the same way behind it.
   *
   * It is the same figure for every letter that has nothing up there: the
   * reference's `n`, `o`, `a`, `v`, `e`, `u`, `r`, `w`, `x` and `g` all reach
   * between 0.09 and 0.10 x-heights past their advance, and only the ones with
   * something above the x-height reach further -- 0.33 on the `l`, 0.25 on the
   * `f`, 0.22 on the `d`.
   *
   * Not the arms of a `v` or a `w`, which lean out as they rise and are widest
   * exactly at the x-height: they are inside the band and still measured, which
   * is what the paragraph above this one is about.
   *
   * A capital has nothing at or below the x-height that is not also its widest
   * part -- and one that is entirely above it, as every capital of a face with
   * a tall x-height very nearly is, would be left with no letter to measure at
   * all. So an empty band falls back to the whole letter.
   */
  /*
   * Half a pen above the waist, not on it.
   *
   * The arms of a `v` and a `w` lean out as they rise and are widest exactly at
   * the x-height, so a band that stops there stops in the middle of the part of
   * the letter it is trying to measure -- and which side of the line each arm
   * falls on then moves with the bounce. The `w` came out six tenths of a unit
   * narrower at the start of a word than in the middle of one, which rounds to
   * no difference at all in the file.
   *
   * Half a pen clear of it, a stroke that arrives at the waist is inside the
   * band whole. A loop at the ascender is nowhere near.
   */
  const band = waist === null ? null : waist + room.half;
  /*
   * And the same at the other end, because a descender is the same fact upside
   * down.
   *
   * What rises above the waist hangs over the letter after it; what falls below
   * the baseline hangs under the letter before it, and there is as little down
   * there to foul as there is up here. The reference says so plainly: its `p`
   * reaches 0.28 of an x-height left of its own origin, its `j` 0.58 and its
   * `f` 0.20, while everything with nothing below the line stops within 0.06.
   *
   * Measured to the waist only, the descender loop was inside the band and paid
   * for its swing in the advance -- the `p` came out at 1.19 to 1.34 of its own
   * face's `o` against the reference's 1.07, and every one of those faces drew
   * it at 1.01 to 1.07 with the loop turned off. The letter was right and the
   * spacing was reading a loop as though it were a body.
   *
   * Half a pen below the line, for the reason the waist is half a pen above it
   * -- and moved by the same bounce, which is what the waist above already
   * carries and this did not. A hand that sets each letter a little off the
   * line moves its baseline with it, so a floor left at nought is a floor that
   * cuts a lifted letter in a different place: the `f` and the `j` came out
   * *wider* at the start of a word than in the middle of one, by three units
   * and twenty-seven, where every other letter came out narrower by the same
   * three.
   *
   * The lift is not handed in because it does not need to be: the waist is the
   * x-height plus it.
   */
  const lift = waist === null ? 0 : waist - room.x;
  const floor = lift - room.half;
  const body = points.filter((one) => band !== null && one.y <= band && one.y >= floor);
  const spanning = body.length >= 2 ? body : points;
  /*
   * And only for a letter written in the middle of a word, which is the one
   * that has a neighbour to hang over.
   *
   * A capital is set down on its own -- it takes a lead-out into the letter
   * after it and never a lead-in from the letter before -- and the reference
   * spaces its capitals off the whole of their ink: its `H`, `O`, `A`, `V`,
   * `W` and `L` all sit within six hundredths of an x-height of their own
   * advance, where its lowercase reaches a tenth past. Measured on its band a
   * capital `T` is measured on its stem alone, and its bar came down eighty
   * units left of the origin.
   *
   * Asked once for the letter rather than of each side separately, because the
   * two sides have to be measured the same way for the same letter. Asked per
   * side, turning a letter's lead-out off changed how its right edge was found
   * as well as what was drawn there, and the width every letter gives up when
   * it loses that stroke stopped being the same width.
   *
   * And asked of what the letter can do, not of what this drawing of it is
   * doing: `d.begin` is the `d` at the start of a word and has given up its
   * lead-in, but it is still a written `d` with a loop over it and still has
   * the letter after it to hang over. Asked of the drawing, it was spaced like
   * a capital.
   *
   * The height is handed in rather than taken from `room.x`, because the letter
   * has already been moved by then. A hand that bounces sets each letter a
   * little off the line, and a `d` dropped thirty units has thirty units more
   * of its loop below the x-height than the same `d` standing level -- so the
   * advance moved with the bounce, and `d.begin`, which does not bounce because
   * it is not in the middle of a word, came out twenty-five units wider than
   * the `d` it is meant to be narrower than.
   */
  /*
   * A round letter is measured where its neighbour actually is, not at its
   * widest point.
   *
   * The room a letter takes was its widest point, and on a bowl that is the
   * waist -- where no neighbour ever comes. The letter after an `o` arrives at
   * the seam, and by the waist the bowl has curved away from it. The reference
   * states it plainly: its `o` runs -0.03 to 1.19 of an x-height and its
   * advance is 1.10, so the advance is narrower than the letter and the next
   * one laps onto the bowl. That is what round letters do in every roman face
   * too, and for the same reason.
   *
   * Measured at the seam, which is where the neighbour arrives, so it needs no
   * number of its own.
   *
   * Lower would be better on the numbers and is not available. Swept as a share
   * of the x-height, a ceiling of 0.16 puts the four faces at 1.11, 1.11, 1.15
   * and 1.03 of the reference's width and 0.08 at 1.09, 1.09, 1.12 and 0.99,
   * against 1.15, 1.14, 1.17 and 1.05 here. Two things stop it, and both are
   * the same fact from different sides: measured low, the room is taken from a
   * narrow slice near the letter's foot while the bowl's waist stands well
   * outside it.
   *
   * A word begins on that overhang. `e.begin` gives up its lead-in and has no
   * neighbour to lap onto, and below a ceiling of about 0.22 its ink starts
   * left of its own origin -- at 0.12 by 21 units of a 350 x-height. A letter
   * that begins a word may not do that.
   *
   * And the join has to reach further out to find the letter, which at a
   * hairline pen it cannot do without crossing itself: at a pen of 8, a ceiling
   * of 0.22 folds 37 letters on the Handwriting, 20 of which come apart, and
   * leaves a Formal Script `o` keeping 3 per cent of its ink after the union.
   * At the seam nothing folds at that weight on any of the four.
   *
   * Only the round ones. A `v` and a `w` lean out as they rise and are widest
   * at the x-height, and they are not falling away from anything -- the note on
   * the band above is about keeping them measured, and this must not undo it.
   *
   * This is the room only. The reach -- how far the join stroke draws, and how
   * much room a side with no join stands in instead -- is untouched, which is
   * where an earlier attempt at the same fault went wrong: cut the reach below
   * the sidebearing and a letter that gives up a join comes out wider, so an
   * `o.end` would set a word wider at its end than in its middle.
   *
   * Twice before, this broke that promise from the other side -- `e.begin`
   * stopped being narrower than the `e` -- and twice it was backed out with
   * the cause unestablished. Measured this time rather than reasoned about:
   * both drawings come out on the same 22 points of the 130, the same left and
   * right edge, and the same 14.9 units between them, which is the reach less
   * the sidebearing exactly as it should be. What had changed underneath was
   * the letters: round bowls, an overshoot that reaches over the line, and a
   * handover a third of the way up rather than at the feet. The old failure
   * does not reproduce on them.
   */
  const reachable = round
    ? spanning.filter((one) => one.y <= lift + seams.low)
    : spanning;
  const measured = reachable.length >= 2 ? reachable : spanning;
  const leftmost = measured.reduce((least, one) => Math.min(least, one.x), Infinity);
  const rightmost = measured.reduce((most, one) => Math.max(most, one.x), -Infinity);
  // Moved over by this much, the letter's own left edge sits exactly one reach
  // from the origin, which is the run the lead-in has to climb along.
  // What this letter asks for on top of the join's own reach, at each end.
  const spare = reach * Math.max(0, air);
  const inset = (ends.entry ? reach : side) + spare - (leftmost - room.half);
  const from = at(lands.x + inset, lands.y);
  const to = at(leaves.x + inset, leaves.y);
  const asked = rightmost + room.half + inset + spare + (ends.exit ? reach : side);
  /*
   * And never so narrow that the letter hangs over more than a loop's worth.
   *
   * Spacing off the body at the line is right until the letter has no body at
   * the line. An `l` is a stem, so its advance came out as the join and nothing
   * else -- 0.49 of an x-height on the Casual Script, where the reference gives
   * its `l` 0.71 and every other letter more. Two of them set side by side
   * would have put one loop through the other.
   *
   * The reference says how far is far enough: its `l` reaches 0.33 of an
   * x-height past its own advance, its `f` 0.25 and its `d` 0.22, and nothing
   * else in the lowercase reaches beyond 0.11. So a third of an x-height is
   * what a loop is allowed to hang over, and a letter that would hang over more
   * is given the room instead.
   */
  const hangs = spanning === points
    ? 0
    : Math.max(0, points.reduce((most, one) => Math.max(most, one.x), -Infinity) - rightmost);
  const width = asked + Math.max(0, hangs - room.x * HANGS_OVER);

  /*
   * A level run at each end before the turn, so the two halves have something
   * to agree on beyond a single point. Nought is a pure curve and still joins;
   * opened up, the letters sit further apart with a flatter line between them,
   * which is the difference between a fast hand and a careful one.
   */
  const level = Math.max(0, Math.min(1, script.flat)) * reach;
  /*
   * And each half carries on past the seam by the knit, so the two cross
   * rather than touch. Both ends are cut square, so meeting at a point is
   * meeting over no area -- see `knit`. The advance is not moved by it.
   */
  const knit = Math.max(0, script.knit) * room.half * 2;
  /*
   * The heading, as a rise per unit along.
   *
   * The contract is unchanged by it: the lead-in still passes through the
   * origin at the seam height and the lead-out still passes through the advance
   * at the same height, so the two halves meet where they always did. What
   * changes is the direction they are travelling as they cross, and that is the
   * one thing both sides have to agree on.
   */
  const rise = Math.tan((script.tilt * Math.PI) / 180);
  const climbing = at(1, rise);
  const falling = at(-1, -rise);
  const entry = !ends.entry ? null : chained(
    {
      segments: [{
        kind: "line",
        from: at(-knit, entryAt - knit * rise),
        to: at(level, entryAt + level * rise),
      }],
      closed: false,
    },
    levelArc(at(level, entryAt + level * rise), from, room, climbing),
  );
  const exit = !ends.exit ? null : chained(
    // Handed the heading backwards, because this half is drawn from the seam
    // into the letter and then turned round: reversed, it arrives climbing.
    reversed(levelArc(at(width - level, exitAt - level * rise), to, room, falling)),
    {
      segments: [{
        kind: "line",
        from: at(width - level, exitAt - level * rise),
        to: at(width + knit, exitAt + knit * rise),
      }],
      closed: false,
    },
  );

  return { entry, exit, inset, width };
}

/**
 * How far this letter sits off the line, and how much further over it leans.
 *
 * Worked out from the letter's own name so that a word is drawn the same way
 * every time it is drawn, and so that two letters that happen to sit beside
 * each other do not both bounce the same way. The hash is the cheap one -- this
 * is asked once per letter and wants to be boring rather than uniform.
 *
 * Both halves have to be applied somewhere that does not open the joins, and
 * those are two different places.
 *
 * The lift moves the letter off its line, which would carry the seam with it
 * and leave the letter after it reaching for a height that letter is no longer
 * at. So it is applied to the skeleton *before* the join is planned -- a
 * translation, which is the one transform an arc survives exactly -- and the
 * join is then drawn to wherever the letter ended up. The seam never moves; the
 * lead-in and lead-out simply climb a little further or a little less.
 *
 * The lean is applied to the finished outline like the face's own slant, but
 * turned about the seam rather than about the middle of the x-height. A shear
 * leaves the line it is pivoted on exactly where it was, so pivoting on the
 * seam is what lets a letter lean a degree and a half further than its
 * neighbour and still hand over to it in the same place.
 */
/*
 * What one unit of unsteadiness is worth: a twelfth of the x-height of bounce
 * either way, and three degrees of lean either way.
 *
 * Settled by drawing the same two lines at nought, one, two and three times
 * this and looking at them. At nought the writing is a machine's. At one it
 * reads as a hand without drawing attention to itself, which is what a face
 * called Handwriting wants. It is still legible at three -- a lively hand
 * rather than a mess -- so the control has real range in it, which is worth
 * saying because the first guess at these numbers was a third of them and did
 * nothing visible at any setting.
 */
const SETTLE = 0.12;
const TILT = 6;

/**
 * The furthest a letter of this face may sit from its line.
 *
 * For the invariants that measure a letter against the lines it was drawn
 * between. A face that says its hand is unsteady is not broken when its letters
 * are off their lines; it is broken when they are off them by more than it
 * said. Exported so the tests read the same number this does rather than a
 * copy of it that can drift.
 */
export function mostLift(script: Script, xHeight: number): number {
  return script.on ? Math.abs(script.irregularity) * xHeight * SETTLE * 0.5 : 0;
}

export function wobbleOf(name: string, script: Script, xHeight: number): { lift: number; lean: number } {
  if (!script.on || script.irregularity <= 0) return { lift: 0, lean: 0 };
  let hash = 2166136261;
  for (let index = 0; index < name.length; index++) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const first = ((hash >>> 8) & 1023) / 1023 - 0.5;
  const second = ((hash >>> 20) & 1023) / 1023 - 0.5;
  return {
    /*
     * Half a unit either way, so one whole unit is a sixteenth of the x-height
     * of bounce and three degrees of lean -- about thirty units and three
     * degrees on this face. A line of type is so exactly level that the eye
     * reads any departure from it at once, which is why this is worth having
     * and why it does not need to be large.
     */
    lift: first * script.irregularity * xHeight * SETTLE,
    lean: second * script.irregularity * TILT,
  };
}
