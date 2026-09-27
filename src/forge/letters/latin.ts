/**
 * The Latin letters that are not a letter with a mark on it: the ash, the slashed o, the eth, the thorn, the eszett and their neighbours.
 *
 * One part of the table `LETTERS` in `../letters.ts` is assembled from, moved
 * here unchanged so the recipes can be read a group at a time. Only that file
 * imports it; see it for what a recipe is and how the table is used.
 */

import { LETTERS } from "../letters";
import { spineEnd, spineStart } from "../shapes";
import type { Style } from "../style";
import {
  arch,
  archSpine,
  arm,
  arms,
  at,
  belly,
  bend,
  BUTT,
  chain,
  corners,
  deg,
  dot,
  finish,
  frame,
  ink,
  junction,
  type LetterName,
  openBowl,
  type Recipe,
  ring,
  slash,
  straight,
  struck,
  stub,
  thin,
  tStem,
  turn,
  eyeOf,
  wallAt,
  middleBar,
  tittle,
} from "./common";

export const LATIN_RECIPES: Record<LetterName, (style: Style) => Recipe> = {
  // -------------------------------------------------------------------------
  // The letters that are not a letter with a mark on it
  // -------------------------------------------------------------------------
  //
  // Nine of the Latin-1 set do not decompose into anything: Unicode has no
  // parts to offer for an ash, a slashed o, an eth, a thorn or an eszett, so
  // they are drawn like any other letter. Without them a font cannot set
  // Danish, Norwegian, Icelandic or German, which is most of the point of
  // having the accented set at all.

  /** An A and an E sharing a stroke, which is what an ash is. */
  AE: (style) => {
    const f = frame(style);
    const apex = f.edge + f.capBowl * 0.62;
    const stem = apex;
    const reach = f.capBowl * 1.1;
    const [, low] = arms(f, f.cap);
    return finish(f, [
      // The A's one diagonal, from the foot out to the shared upright.
      ink(f, straight(at(f.edge, 0), at(apex, f.cap)), f.end, BUTT),
      ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
      arm(f, stem, stem + reach, f.hangs(f.cap, f.bar)),
      arm(f, stem, stem + reach * 0.86, middleBar(f, f.cap)),
      arm(f, stem, stem + reach, f.sits(0, f.bar)),
      // The crossbar of the A half, which meets the diagonal partway down.
      thin(f, straight(at(f.edge + f.capBowl * 0.22, low), at(stem, low)), BUTT, BUTT),
    ]);
  },

  ae: (style) => {
    const f = frame(style);
    // Two bowls side by side in the room one and a bit would take, so the pair
    // reads as one letter rather than as an a that has run into an e.
    const bowl = Math.max(f.bowl * 0.68, f.least);
    const first = at(f.edge + bowl, f.x / 2);
    const second = at(first.x + bowl * 2, f.x / 2);

    // The e half, drawn the way the e itself is: the eye at whatever height the
    // crossbar says, and the bowl opened from where the circle reaches it.
    const eye = eyeOf(f, second);
    const rise = Math.max(-0.85, Math.min(0.85, (eye - second.y) / f.bowlH));
    const opens = (Math.asin(rise) * 180) / Math.PI;
    const belt = bend(f, second, f.bowlH, opens, opens + 300);

    return finish(
      f,
      [
        // Open at the top, where the a half runs into the e half. Closed, the
        // two read as an o and an e rather than as one letter.
        openBowl(f, first, bowl, f.bowlH, -80, 150),
        // From the middle of the wall, not its inside edge: see `wallAt`.
        thin(f, straight(at(wallAt(f, second, opens), eye), spineStart(belt))),
        ink(f, belt, BUTT, f.end),
      ],
      true,
    );
  },

  /** An O with a stroke through it, which is a letter in its own right. */
  Oslash: (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.capBowl, f.cap / 2);
    const outX = f.capBowl + f.half * 1.1;
    const outY = f.capBowlH + f.half * 1.1;
    return finish(
      f,
      [
        ink(f, ring(f, centre, f.capBowl, f.capBowlH)),
        ink(
          f,
          straight(at(centre.x - outX, centre.y - outY), at(centre.x + outX, centre.y + outY)),
          f.plain,
          f.plain,
        ),
      ],
      true,
    );
  },

  oslash: (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.bowl, f.x / 2);
    const outX = f.bowl + f.half * 1.1;
    const outY = f.bowlH + f.half * 1.1;
    return finish(
      f,
      [
        ink(f, ring(f, centre, f.bowl, f.bowlH)),
        ink(
          f,
          straight(at(centre.x - outX, centre.y - outY), at(centre.x + outX, centre.y + outY)),
          f.plain,
          f.plain,
        ),
      ],
      true,
    );
  },

  /** A D with a bar laid across its stem. */
  /*
   * The letters with a stroke through them, which is one idea six times over.
   *
   * A Polish l, a Croatian d, a Maltese h: the letter as it is already drawn,
   * with a short bar laid across its stem. Nothing about the letter changes, so
   * a face that squares its stems or leans them squares and leans these too,
   * and the bar is drawn with the same thin pen the crossbar of an H uses --
   * it is the same thing, in the same font, and should not be a second decision.
   *
   * Unicode gives none of them a decomposition, so unlike the hundred accented
   * letters these cannot be built out of parts and have to be drawn. They are
   * here rather than left out because a Polish that cannot set l is not Polish.
   */
  Lslash: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const reach = f.capBowl * 1.05;
    return finish(f, [
      ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
      arm(f, stem, stem + reach, f.sits(0, f.bar)),
      slash(f, stem, f.cap * 0.5),
    ]);
  },

  lslash: (style) => {
    const f = frame(style);
    return finish(f, [
      ink(f, straight(at(f.edge, 0), at(f.edge, f.asc)), f.end, f.end),
      slash(f, f.edge, f.asc * 0.55),
    ]);
  },

  /*
   * The same drawing as the Eth, which is what it is: two characters that
   * Unicode keeps apart because they are different letters in different
   * languages, and every font draws with one shape.
   */
  Dcroat: (style) => LETTERS.Eth(style),

  dcroat: (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.bowl, f.x / 2);
    const stem = centre.x + f.bowl + f.aside;
    const bar = f.x + (f.asc - f.x) * 0.55;
    return finish(f, [
      ink(f, ring(f, centre, f.bowl, f.bowlH)),
      ink(f, straight(at(stem, 0), at(stem, f.asc)), f.end, f.end),
      thin(
        f,
        straight(at(stem - f.half * 2.2, bar), at(stem + f.half * 2.2, bar)),
        f.plain,
        f.plain,
      ),
    ]);
  },

  Hbar: (style) => {
    const f = frame(style);
    const left = f.edge;
    const right =
      left + f.style.metrics.counterWidth * (f.style.metrics.stretch ?? 1) + f.style.pen.weight;
    const bar = f.cap * f.style.parts.crossbar.height;
    // Across both stems and out past the left of them, which is what tells an
    // H-bar from an H at a glance.
    const high = f.cap - (f.cap - bar) * 0.35;
    return finish(f, [
      ink(f, straight(at(left, 0), at(left, f.cap)), f.end, f.end),
      ink(f, straight(at(right, 0), at(right, f.cap)), f.end, f.end),
      thin(f, straight(at(left, bar), at(right, bar)), BUTT, BUTT),
      thin(
        f,
        straight(at(left - f.half * 2, high), at(right + f.half * 2, high)),
        f.plain,
        f.plain,
      ),
    ]);
  },

  hbar: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const bar = f.x + (f.asc - f.x) * 0.55;
    return finish(f, [
      ink(f, straight(at(stem, 0), at(stem, f.asc)), f.end, f.end),
      arch(f, stem, f.x),
      thin(
        f,
        straight(at(stem - f.half * 2.2, bar), at(stem + f.half * 2.2, bar)),
        f.plain,
        f.plain,
      ),
    ]);
  },

  /*
   * The rest of Latin Extended-A: the thirteen characters with no decomposition
   * to build them from.
   *
   * Every one of these is a letter somebody's language needs and none of them
   * is a letter under a mark, so the loop that reads Unicode's decompositions
   * cannot reach any of them. French cannot set `coeur` without the first pair,
   * Catalan cannot set `paral*lel` without the third, and Northern Sami needs
   * the eng and the barred t as much as it needs the eth it already has.
   */

  /**
   * The French ligature, drawn as a bowl with a flat right side and an E hung
   * off it.
   *
   * Not an O and an E set close together: the two share one stroke, which is
   * the difference between a ligature and a pair. Built the way the Eth is and
   * facing the other way -- a straight upright with the bowl bulging left off
   * it -- so the arms of the E have something straight to leave from at all
   * three heights, which a round O does not offer.
   */
  OE: (style) => {
    const f = frame(style);
    const radius = Math.max((f.crest(f.cap) - f.dip(0)) / 2, f.least);
    const wide = Math.max(radius * f.wide * 0.88, f.least);
    const stem = f.edge + wide;
    const reach = f.capBowl * 1.05;
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
        belly(f, at(stem, f.cap / 2), wide, radius, 90, 270),
        arm(f, stem, stem + reach, f.hangs(f.cap, f.bar)),
        arm(f, stem, stem + reach * 0.86, middleBar(f, f.cap)),
        arm(f, stem, stem + reach, f.sits(0, f.bar)),
      ],
      true,
    );
  },

  /**
   * The same ligature in lowercase, which is the ae with an o where the a is.
   *
   * Narrowed the same way and for the same reason: two bowls at their full
   * width read as two letters that have collided, and the pair has to read as
   * one letter with two counters.
   */
  oe: (style) => {
    const f = frame(style);
    const bowl = Math.max(f.bowl * 0.68, f.least);
    const first = at(f.edge + bowl, f.x / 2);
    const second = at(first.x + bowl * 2, f.x / 2);

    const eye = eyeOf(f, second);
    const rise = Math.max(-0.85, Math.min(0.85, (eye - second.y) / f.bowlH));
    const opens = (Math.asin(rise) * 180) / Math.PI;
    const belt = bend(f, second, f.bowlH, opens, opens + 300);

    return finish(
      f,
      [
        ink(f, ring(f, first, bowl, f.bowlH)),
        // From the middle of the wall, not its inside edge: see `wallAt`.
        thin(f, straight(at(wallAt(f, second, opens), eye), spineStart(belt))),
        ink(f, belt, BUTT, f.end),
      ],
      true,
    );
  },

  /**
   * The Dutch digraph, which is one character and two letters.
   *
   * Set tighter than two letters and looser than two stems, because it is
   * neither. A whole counter between them and the pair reads as an I and a J
   * that happen to be adjacent -- which is what it looked like set into a word,
   * where `Ĳsvogel` came out as `I Jsvogel`. The gap is measured off the
   * counter rather than off the pen, so it survives a display weight without
   * the J's hook ever reaching the I.
   */
  IJ: (style) => {
    const f = frame(style);
    const radius = Math.max(f.capBowl * 0.55, f.least);
    const apart = f.style.metrics.counterWidth * 0.55 + f.style.pen.weight;
    const first = f.edge;
    const stem = first + apart + radius;
    return finish(f, [
      ink(f, straight(at(first, 0), at(first, f.cap)), f.end, f.end),
      ink(
        f,
        chain(
          straight(at(stem, f.cap), at(stem, f.dip(0) + radius)),
          turn(at(stem - radius, f.dip(0) + radius), radius, 0, -90),
        ),
        f.end,
        f.end,
      ),
    ]);
  },

  ij: (style) => {
    const f = frame(style);
    const radius = Math.max(f.arch * 0.62, f.least);
    const apart = f.style.metrics.counterWidth * 0.55 + f.style.pen.weight;
    const first = f.edge;
    const stem = first + apart + radius;
    return finish(f, [
      ink(f, straight(at(first, 0), at(first, f.x)), f.end, f.end),
      tittle(f, first),
      ink(
        f,
        chain(
          straight(at(stem, f.x), at(stem, f.dip(f.desc) + radius)),
          turn(at(stem - radius, f.dip(f.desc) + radius), radius, 0, -95),
        ),
        f.end,
        f.end,
      ),
      tittle(f, stem),
    ]);
  },

  /**
   * The eng, which Northern Sami and the phonetic alphabet both need.
   *
   * An n whose right leg carries on below the line and hooks back, drawn as one
   * run from the top of the shoulder so that the leg has no terminal in the
   * middle of it.
   */
  eng: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const landing = stem + f.arch * 2;
    const floor = f.dip(f.desc);
    /*
     * The hook takes whatever room is left under the shoulder, and none if
     * there is none.
     *
     * How far down the arch's own leg begins is not a number this letter knows:
     * a high springing leaves a large corner radius and starts the leg most of
     * the way down the x-height, and on a shallow descender with a heavy pen
     * there is then nothing below it to turn in. Asked for a fixed hook anyway,
     * the leg was told to run upwards to reach it and the letter folded over
     * itself. So the leg is drawn first, and the hook is the distance between
     * where it actually stopped and the descender -- which on a face with no
     * room is nothing, and a straight-legged eng is a real eng.
     */
    const leg = archSpine(f, stem, f.x, floor + Math.max(f.arch * 0.62, f.least));
    const room = spineEnd(leg).y - floor;
    /*
     * And where there is none, the hook is drawn standing still rather than not
     * drawn -- the same arrangement `tailBelow` makes for the tails of the
     * greek, and for the same reason. How much room is left under the leg is
     * the pen's business, so a hook left out outright is a letter drawn with
     * four nodes fewer at the weights that have no room for one: the Brush's
     * `eng` came back with fourteen pieces of outline at the Thin, the Regular
     * and the Bold and ten at the Black.
     *
     * A radius even when nothing is turned through it, because the sweep reads
     * an arc of no radius as nothing at all and drops it, where an arc of no
     * sweep is kept and takes its heading from the run before it. And the two
     * pieces ninety-five degrees needs, said rather than worked out, so the
     * stalled hook and the drawn one come to the same nodes.
     */
    const hooks = room > f.least;
    const radius = hooks ? room : f.least;
    return finish(f, [
      ink(f, straight(at(stem, 0), at(stem, f.x)), f.end, f.end),
      ink(
        f,
        chain(leg, {
          segments: [
            {
              kind: "arc",
              centre: at(landing - radius, spineEnd(leg).y),
              radius,
              startAngle: deg(0),
              endAngle: deg(hooks ? -95 : 0),
              sweepPositive: false,
              pieces: 2,
            },
          ],
          closed: false,
        }),
        BUTT,
        f.end,
      ),
    ]);
  },

  /** The capital, which is an N with the same leg on it. */
  Eng: (style) => {
    const f = frame(style);
    const left = f.edge;
    const right = left + f.capBowl * 1.35;
    const radius = Math.max(f.capBowl * 0.5, f.least);
    const into = stub(f);
    const start = at(left, f.cap - into);
    const end = at(right, into);
    const [top, foot] = corners(f, [start, at(left, f.cap), at(right, 0), end]);
    return finish(f, [
      ink(f, straight(at(left, 0), at(left, f.cap)), f.end, f.end),
      ink(
        f,
        chain(
          straight(at(right, f.cap), at(right, f.dip(f.desc) + radius)),
          turn(at(right - radius, f.dip(f.desc) + radius), radius, 0, -95),
        ),
        f.end,
        f.end,
      ),
      ink(f, chain(straight(start, top), straight(top, foot), straight(foot, end))),
    ]);
  },

  /**
   * The Catalan geminated l: two of them with a dot between, which Unicode
   * gives one character apiece for the left half.
   *
   * The dot sits clear of the stem by a whole pen rather than by a hair, or a
   * heavy weight closes the gap and the pair reads as a thicker l.
   */
  Ldot: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const reach = f.capBowl * 1.05;
    const radius = f.half * 0.62;
    return finish(f, [
      ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
      arm(f, stem, stem + reach, f.sits(0, f.bar)),
      dot(f, at(stem + f.half * 2.8, f.cap * 0.45), radius),
    ]);
  },

  ldot: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const radius = f.half * 0.62;
    return finish(f, [
      ink(f, straight(at(stem, 0), at(stem, f.asc)), f.end, f.end),
      dot(f, at(stem + f.half * 2.8, f.x * 0.5), radius),
    ]);
  },

  /** The barred T, which Northern Sami needs beside the eth and the eng. */
  Tbar: (style) => {
    const f = frame(style);
    const half = f.capBowl * 0.95;
    const middle = f.edge + half;
    const bar = f.cap * 0.42;
    return finish(f, [
      ink(f, straight(at(middle, 0), at(middle, f.cap)), f.end, BUTT),
      thin(
        f,
        straight(
          at(middle - half, f.hangs(f.cap, f.bar)),
          at(middle + half, f.hangs(f.cap, f.bar)),
        ),
        f.end,
        f.end,
      ),
      thin(
        f,
        straight(at(middle - f.half * 2.4, bar), at(middle + f.half * 2.4, bar)),
        f.plain,
        f.plain,
      ),
    ]);
  },

  /*
   * And the lowercase, which is the t itself with a second bar low on the stem.
   *
   * Below the foot's turn rather than through it, or the bar and the foot are
   * one shape at a heavy weight and the letter reads as a t standing in a
   * puddle.
   */
  tbar: (style) => {
    const f = frame(style);
    const stem = tStem(f);
    const height = f.x * 0.38;
    return struck(
      LETTERS.t(style),
      thin(
        f,
        straight(at(stem - f.half * 2.2, height), at(stem + f.half * 2.2, height)),
        f.plain,
        f.plain,
      ),
    );
  },

  /**
   * The Greenlandic kra, which is a k with no ascender.
   *
   * Deprecated in 1973 and still in the block, so it is drawn: a character that
   * renders as an empty box is worse than one nobody types.
   */
  kgreenlandic: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const reach = stem + f.arch * 1.7;
    const waist = f.x * 0.42;
    const arm = at(reach, f.x);
    const leg = at(reach, 0);
    const meet = junction(f, arm, stem, waist, leg);
    return finish(f, [
      ink(f, straight(at(stem, 0), at(stem, f.x)), f.end, f.end),
      ink(f, chain(straight(arm, meet), straight(meet, leg)), f.end, f.end),
    ]);
  },

  /** An apostrophe and an n, which Afrikaans used to set as one character. */
  napostrophe: (style) => {
    const f = frame(style);
    const tick = f.edge;
    const stem = tick + f.half * 2 + f.arch * 0.5;
    return finish(f, [
      ink(f, straight(at(tick, f.asc * 0.72), at(tick, f.asc)), f.plain, f.plain),
      ink(f, straight(at(stem, 0), at(stem, f.x)), f.end, f.end),
      arch(f, stem, f.x),
    ]);
  },

  /**
   * The long s, which is an f with the right half of its bar taken off.
   *
   * The nub is what tells it from an l and from an integral sign both, so it
   * stays even on a face whose f has hardly any bar at all.
   */
  longs: (style) => {
    const f = frame(style);
    const radius = Math.max(f.arch * 0.66, f.least);
    const stem = f.edge + radius;
    return finish(f, [
      ink(
        f,
        chain(
          straight(at(stem, 0), at(stem, f.crest(f.asc) - radius)),
          turn(at(stem - radius, f.crest(f.asc) - radius), radius, 0, 92),
        ),
        f.end,
        f.end,
      ),
      thin(
        f,
        straight(at(stem - f.arch * 0.5, f.hangs(f.x, f.bar)), at(stem, f.hangs(f.x, f.bar))),
        f.end,
        BUTT,
      ),
    ]);
  },

  Eth: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const radius = Math.max((f.crest(f.cap) - f.dip(0)) / 2, f.least);
    const bar = f.cap * f.style.parts.crossbar.height;
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
        belly(f, at(stem, f.cap / 2), radius * f.wide, radius, -90, 90),
        thin(
          f,
          straight(at(stem - f.half * 1.6, bar), at(stem + f.half * 2.2, bar)),
          f.plain,
          BUTT,
        ),
      ],
      true,
    );
  },

  /** A bowl with a stroke rising off it, crossed by a bar. */
  eth: (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.bowl, f.x / 2);
    const top = f.crest(f.asc);
    // Up and to the left, off the bowl's right shoulder.
    const from = at(centre.x + f.bowl * 0.8, f.x * 0.62);
    const to = at(centre.x - f.bowl * 0.35, top);
    // The bar lies across that stroke rather than flat, which is what tells an
    // eth from a d with something above it.
    const along = { x: to.x - from.x, y: to.y - from.y };
    const length = Math.max(Math.hypot(along.x, along.y), 1);
    const across = { x: -along.y / length, y: along.x / length };
    const middle = at(from.x + along.x * 0.5, from.y + along.y * 0.5);
    const reach = Math.max(f.bowl * 0.46, f.half * 1.4);
    return finish(
      f,
      [
        ink(f, ring(f, centre, f.bowl, f.bowlH)),
        ink(f, straight(from, to), BUTT, f.plain),
        thin(
          f,
          straight(
            at(middle.x - across.x * reach, middle.y - across.y * reach),
            at(middle.x + across.x * reach, middle.y + across.y * reach),
          ),
          f.plain,
          f.plain,
        ),
      ],
      true,
    );
  },

  /** A stem with the bowl in the middle rather than at the top. */
  Thorn: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const radius = Math.max(f.cap * 0.22, f.least);
    return finish(f, [
      ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
      belly(f, at(stem, f.cap * 0.54), radius * f.wide, radius, -90, 90),
    ]);
  },

  thorn: (style) => {
    const f = frame(style);
    const stem = f.edge;
    return finish(
      f,
      [
        ink(f, straight(at(stem, f.dip(f.desc)), at(stem, f.asc)), f.end, f.end),
        ink(f, ring(f, at(stem + f.bowl, f.x / 2), f.bowl, f.bowlH)),
      ],
      true,
    );
  },

  /**
   * The eszett: a tall stroke with a bowl over it and a second one below, the
   * lower of the two left open at its foot the way an eszett always is.
   */
  germandbls: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const top = f.crest(f.asc);
    const base = f.dip(0);
    const waist = base + (top - base) * 0.44;
    const upperR = Math.max((top - waist) / 2 + f.half * 0.2, f.least);
    const lowerR = Math.max((waist - base) / 2 + f.half * 0.2, f.least);
    const reach = Math.max(f.bowl * 0.86, f.least);
    return finish(f, [
      ink(f, straight(at(stem, 0), at(stem, top - upperR)), f.end, BUTT),
      belly(f, at(stem, top - upperR), reach, upperR, -90, 90),
      // Opened at the bottom left rather than closed back onto the stem.
      belly(f, at(stem, base + lowerR), reach, lowerR, -35, 90),
    ]);
  },
};
