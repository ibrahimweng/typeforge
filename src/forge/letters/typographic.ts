/**
 * The typographic punctuation: the marks a typewriter never had.
 *
 * Curly quotes, the low quotes and the single guillemets, the en and em
 * dashes, the ellipsis, the bullet, the minus sign, the euro, the trade mark
 * and the daggers. Every one of them is in Windows-1252 and on every Mac
 * keyboard, and text that has been anywhere near a word processor is full of
 * them -- so a font without them sets a line of real prose with holes in it,
 * however good its letters are.
 *
 * Almost none of them is a new drawing. A curly quote is this face's comma,
 * raised to the cap line or turned over; a dash is its hyphen run longer; the
 * ellipsis is three of its full stops; the minus is the bar of its plus; the
 * euro is its C with two bars through it; the trade mark is its own T and M
 * set small. Built out of those, they take the weight, the width, the corners,
 * the wave and every effect the letters take, with the same number of points
 * at every weight -- and an edit to the comma reaches the quotes, as it has to,
 * or the font has two commas in it and one of them is a copy.
 *
 * One part of the table `LETTERS` in `../letters.ts` is assembled from; see it
 * for what a recipe is and how the table is used.
 */

import type { Contour, Vec2 } from "@/font/types";
import { contoursBounds } from "@/font/geometry";
import { recipeOf } from "../letters";
import { spineEnd, spineStart } from "../shapes";
import { blackness, spacingOf, type Style } from "../style";
import { sweep } from "../sweep";
import type { Spine, Stroke, Terminal } from "../types";
import {
  at,
  bookish,
  chevron,
  finish,
  type Frame,
  frame,
  inherit,
  openedRing,
  ink,
  joined,
  type LetterName,
  outOf,
  type Recipe,
  rippled,
  setInside,
  shovedStroke,
  signWidth,
  sized,
  stopRadius,
  straight,
  thin,
  turnedStroke,
  widthShare,
} from "./common";

/**
 * Where a run of strokes really puts its ink, pen, terminals and all.
 *
 * Swept rather than estimated from the skeleton, because the pieces here are
 * stood against a line -- the cap line, the one beside them -- and an estimate
 * that takes a butt end for a round one puts a square comma's head half a dot
 * above the line it was meant to reach.
 */
function inkBox(strokes: Stroke[]): { xMin: number; xMax: number; yMin: number; yMax: number } {
  const contours: Contour[] = strokes.flatMap((stroke) => sweep(stroke));
  if (contours.length === 0) return { xMin: 0, xMax: 0, yMin: 0, yMax: 0 };
  return contoursBounds(contours);
}

function shoved(strokes: Stroke[], dx: number, dy: number): Stroke[] {
  return dx === 0 && dy === 0 ? strokes : strokes.map((stroke) => shovedStroke(stroke, dx, dy));
}

// ---------------------------------------------------------------------------
// The quotes
// ---------------------------------------------------------------------------

/**
 * How high a curly quote's ink reaches.
 *
 * Geist's closing quote is its comma with its head on the cap line, the same
 * line its straight quote hangs from; Lora's stands well over it, 760 on a cap
 * height of 700, as a text face's quotes do so that they clear the capitals
 * they sit beside.
 */
function quoteTop(f: Frame): number {
  return bookish(f) ? f.cap * 1.086 : f.cap;
}

/**
 * The white between the two marks of a double quote.
 *
 * Lora's is 50 at the Regular closing to 36 by the Bold, which is the rule its
 * straight double quote already follows; Geist's holds at about a tenth of the
 * x-height at every weight (48, 52 and 53 at the Thin, Regular and Black).
 */
function quoteGap(f: Frame): number {
  if (bookish(f)) return Math.max(f.x * 0.11 - Math.max(0, f.half - f.x * 0.087) * 0.8, f.x * 0.04);
  return Math.max(f.xOwn * 0.098, f.half * 0.5);
}

/** How deep a curly quote may run, against the cap height: see `quoted`. */
const QUOTE_DEPTH = 0.48;

/** A stroke drawn smaller about a point: its run, its pen and its ends. */
function scaledStroke(stroke: Stroke, k: number, about: Vec2): Stroke {
  const to = (point: Vec2): Vec2 =>
    at(about.x + (point.x - about.x) * k, about.y + (point.y - about.y) * k);
  const spine: Spine = {
    closed: stroke.spine.closed,
    segments: stroke.spine.segments.map((segment) =>
      segment.kind === "line"
        ? { ...segment, from: to(segment.from), to: to(segment.to) }
        : { ...segment, centre: to(segment.centre), radius: segment.radius * k },
    ),
  };
  return inherit(stroke, {
    ...stroke,
    spine,
    pen: { ...stroke.pen, weight: stroke.pen.weight * k },
  });
}

/**
 * A stroke reflected left for right about an upright line: its run, the
 * angle its nib is held at, and any angle its ends are cut at.
 */
function mirroredStroke(stroke: Stroke, x: number): Stroke {
  const to = (point: Vec2): Vec2 => at(2 * x - point.x, point.y);
  const spine: Spine = {
    closed: stroke.spine.closed,
    segments: stroke.spine.segments.map((segment) =>
      segment.kind === "line"
        ? { ...segment, from: to(segment.from), to: to(segment.to) }
        : {
            ...segment,
            centre: to(segment.centre),
            startAngle: Math.PI - segment.startAngle,
            endAngle: Math.PI - segment.endAngle,
            sweepPositive: !segment.sweepPositive,
          },
    ),
  };
  const end = (terminal: Terminal): Terminal =>
    terminal.angle === undefined ? terminal : { ...terminal, angle: -terminal.angle };
  return inherit(stroke, {
    ...stroke,
    spine,
    pen: { ...stroke.pen, angle: -stroke.pen.angle },
    start: end(stroke.start),
    end: end(stroke.end),
  });
}

/**
 * The comma as a quote: raised so its ink tops out at the quote line, and for
 * an opening quote turned half a turn first, so its tail points up and its
 * head sits at the foot -- the 6 to the closing quote's 9.
 *
 * Turned about the middle of its own ink, so the turned comma covers exactly
 * the box the upright one did. An opening quote stands an overshoot higher on
 * a face that measures its rounds off their lines, as Geist's does (726 to its
 * closing quote's 710): its head is the round at the bottom and its point is
 * what reaches up.
 */
function quoted(f: Frame, full: Stroke[], opening: boolean): Stroke[] {
  /*
   * And never much more than half the cap height deep. Geist Black's quote is
   * its comma, 340 deep on a cap height of 710, and Lora Bold's 324 on 700;
   * but a plain face's comma at a Black is a pill most of the cap height long,
   * which hung from the cap line reached down past the middle of the
   * lowercase. Such a comma is taken down whole -- run and pen together, so
   * it is the same shape smaller -- rather than drawn again, which would ask
   * the wave book for a second comma the drawn weight never recorded.
   */
  const whole = inkBox(full);
  const deep = whole.yMax - whole.yMin;
  const most = f.cap * QUOTE_DEPTH;
  const comma =
    deep > most
      ? full.map((stroke) => scaledStroke(stroke, most / deep, at(whole.xMin, whole.yMax)))
      : full;
  const box = inkBox(comma);
  /*
   * A comma with a head -- a drop, a dot with a tail out of it -- is turned
   * over, which puts the head at the foot and the tail at the top: the 6. A
   * comma that is one leaning stroke has no head to turn, and turned half a
   * turn it is the same stroke leaning the same way, so the opening quote came
   * out identical to the closing one. That one is mirrored instead, leaning
   * the other way, as every face with a stroke for a comma draws its quotes.
   */
  const centre = at((box.xMin + box.xMax) / 2, (box.yMin + box.yMax) / 2);
  const turned = !opening
    ? comma
    : comma.length === 1
      ? comma.map((stroke) => mirroredStroke(stroke, centre.x))
      : comma.map((stroke) => turnedStroke(stroke, centre));
  const top = quoteTop(f) + (opening && !bookish(f) ? f.over : 0);
  // Measured again once turned: a cut that lies level along its line is laid
  // level again wherever the line now is, so the turned ink is not quite the
  // upright ink upside down.
  return shoved(turned, 0, top - (opening ? inkBox(turned) : box).yMax);
}

/** Two of the same mark side by side, as a double quote is two single ones. */
function doubled(f: Frame, one: Stroke[]): Stroke[] {
  const box = inkBox(one);
  return [...one, ...shoved(one, box.xMax - box.xMin + quoteGap(f), 0)];
}

// ---------------------------------------------------------------------------
// The dashes
// ---------------------------------------------------------------------------

/**
 * How much longer than the hyphen each dash runs, against the em.
 *
 * Geist's en dash is its hyphen and 172 more at every weight, and its em dash
 * its hyphen and 488 more -- 503 and 819 of ink at the Regular, about half an
 * em and a little over four fifths of one. Lora's run shorter, as a text face's
 * do: 100 and 360 past its hyphen, 455 and 705 of ink.
 */
const DASH: Record<"en" | "em", { sans: number; book: number }> = {
  en: { sans: 0.172, book: 0.1 },
  em: { sans: 0.488, book: 0.36 },
};

/**
 * The hyphen, lengthened.
 *
 * The same run on the same pen at the same height, carried further along the
 * way it already travels: whatever this face does to its hyphen -- Geist's
 * depth, Lora's heavy bar, a wave, a round end -- its dashes do too, and they
 * cannot sit a unit higher or lower than it. A wavy hyphen is straightened
 * back to its two ends and waved again at its new length, so the wave has the
 * same wavelength along a dash as along the hyphen.
 *
 * A monospaced face draws them no longer than its widest letter already is:
 * every glyph there is set in one column, and a dash that widened the column
 * would widen every letter in the font with it.
 */
function dashed(f: Frame, hyphen: Stroke[], which: "en" | "em"): Stroke[] {
  const em = f.style.metrics.unitsPerEm;
  let extra = em * (bookish(f) ? DASH[which].book : DASH[which].sans);
  if (f.style.metrics.monospaced) {
    const box = inkBox(hyphen);
    const widest = f.cap * 0.62 * f.style.metrics.width + f.half * 2;
    extra = Math.max(0, Math.min(extra, widest - (box.xMax - box.xMin)));
  }
  return hyphen.map((stroke) => {
    const from = spineStart(stroke.spine);
    const to = spineEnd(stroke.spine);
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    const along = at((to.x - from.x) / length, (to.y - from.y) / length);
    const spine = straight(from, at(to.x + along.x * extra, to.y + along.y * extra));
    return inherit(stroke, { ...stroke, spine: rippled(f, spine, stroke.pen.weight / 2) });
  });
}

// ---------------------------------------------------------------------------
// The rest
// ---------------------------------------------------------------------------

/**
 * A letter of this face drawn small, its foot on `foot` and its ink from `left`.
 *
 * In the form the face draws that letter in, rather than the plain one: the
 * Sans's trade mark is Geist's T and M, not the plain sans's. Set inside, so a
 * joined face's capital does not reach out of the sign towards a letter that
 * is not there.
 */
function small(f: Frame, name: LetterName, share: number, left: number, foot: number): Stroke[] {
  // And a little narrower than the letters set small would be, as Geist's
  // and Lora's are: a T and an M at half size on a pen at two thirds of the
  // stem ran a fifth wider than either face's sign.
  const set = sized(f.style, share);
  const little = { ...set, metrics: { ...set.metrics, width: set.metrics.width * 0.85 } };
  const strokes = setInside(() => recipeOf(name, f.style.forms?.[name])!(little).strokes);
  return shoved(strokes, left - spacingOf(little), foot);
}

/** A disc, whatever the face does to its full stops: Geist's bullet is round. */
function disc(f: Frame, radius: number, y: number): Stroke {
  const round: Terminal = { kind: "round" };
  const x = f.edge - f.half + radius;
  return {
    spine: straight(at(x - 0.5, y), at(x + 0.5, y)),
    pen: { ...f.style.pen, contrast: 0, weight: radius * 2 },
    start: round,
    end: round,
  };
}

/** A dagger: an upright the height of a capital, crossed by one bar or two. */
function dagger(style: Style, bars: number[]): Recipe {
  const f = frame(style);
  const w = signWidth(f) * 1.05;
  const x = f.edge - f.half + w / 2;
  return finish(f, [
    ink(f, straight(at(x, 0), at(x, f.cap)), f.plain, f.plain),
    ...bars.map((share) =>
      thin(
        f,
        straight(at(x - w / 2, f.cap * share), at(x + w / 2, f.cap * share)),
        f.plain,
        f.plain,
      ),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// The per mille and the florin
// ---------------------------------------------------------------------------

/**
 * The white between the per mille's two lower rings.
 *
 * Geist's rings stand 80 apart at the Thin, 60 at the Regular and 49 at the
 * Black: closing as the pen grows, and then held, as a sixth of the x-height
 * less most of the half pen, and never under a tenth of the x-height.
 */
function ringGap(f: Frame): number {
  return Math.max(f.xOwn * 0.17 - f.half * 0.7, f.xOwn * 0.093);
}

/** How far a florin leans, as Geist's and Lora's do: about five degrees. */
const FLORIN_LEAN = 5;

/** A stroke turned about a point, anticlockwise by `degrees`. */
function rotatedStroke(stroke: Stroke, about: Vec2, degrees: number): Stroke {
  const turn = (degrees * Math.PI) / 180;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const to = (point: Vec2): Vec2 =>
    at(
      about.x + (point.x - about.x) * cos - (point.y - about.y) * sin,
      about.y + (point.x - about.x) * sin + (point.y - about.y) * cos,
    );
  const spine: Spine = {
    closed: stroke.spine.closed,
    segments: stroke.spine.segments.map((segment) =>
      segment.kind === "line"
        ? { ...segment, from: to(segment.from), to: to(segment.to) }
        : {
            ...segment,
            centre: to(segment.centre),
            startAngle: segment.startAngle + turn,
            endAngle: segment.endAngle + turn,
          },
    ),
  };
  return inherit(stroke, { ...stroke, spine });
}

/** The first straight run of a spine, and its index. */
function firstStraight(spine: Spine): number {
  return spine.segments.findIndex(
    (segment) =>
      segment.kind === "line" &&
      Math.abs(segment.to.y - segment.from.y) > Math.abs(segment.to.x - segment.from.x),
  );
}

/**
 * The florin: this face's own f, leaning, its hook turned over at the foot.
 *
 * Geist's is its f with a second hook, the first turned half a turn, standing
 * on the baseline and leaning five degrees; Lora's is the italic f, carried
 * down to the descender. So the f's stem and hook are taken, turned half a
 * turn about a point on the stem, and the two straight runs trimmed to where
 * they overlap, so the stem is one run with a hook at each end -- standing on
 * the line on a face that draws a plain f, carried down to the descender on a
 * text face. A face whose f already descends is a florin already, and is
 * only leaned. The bar stays level, and moves with the stem it crosses.
 */
function florin(f: Frame, letter: Stroke[]): Stroke[] {
  if (letter.length === 0) return letter;
  const heights = letter.map((stroke) => {
    const box = inkBox([stroke]);
    return box.yMax - box.yMin;
  });
  const which = heights.indexOf(Math.max(...heights));
  const stem = letter[which];
  const bars = letter.filter((_, index) => index !== which);
  const straightAt = firstStraight(stem.spine);
  const ink = inkBox([stem]);
  const was = inkBox([stem]);
  const standing = was.yMin > -f.half && !bookish(f);
  const make = (lower: number): Stroke[] => {
    let strokes = [stem];
    let about = at(0, (ink.yMin + ink.yMax) / 2);
    if (straightAt >= 0) {
      const run = stem.spine.segments[straightAt] as Extract<
        Spine["segments"][number],
        { kind: "line" }
      >;
      const x = run.from.x;
      about = at(x, about.y);
      const low = Math.min(run.from.y, run.to.y);
      const high = Math.max(run.from.y, run.to.y);
      if (ink.yMin > -f.half) {
        /*
         * Turned about the middle of the ink on a face that stands its
         * florin on the line, and about a point that puts the turned hook on
         * the descender on a text face.
         *
         * And never so high that the two straight runs no longer overlap: at
         * a heavy weight the f's hook takes most of its height, and turned
         * about the middle of its ink the two runs missed each other and the
         * trimmed one ran backwards through itself. A little overlap always,
         * so the runs keep their points at every weight.
         */
        const wanted = bookish(f) ? (ink.yMax + f.desc * 1.08) / 2 : (ink.yMin + ink.yMax) / 2;
        const middle = Math.min(wanted - lower, high - Math.max(2, f.half * 0.25));
        about = at(x, middle);
        const turned = turnedStroke(stem, about);
        // Each straight run trimmed at its free end to the other's, so the
        // two overlap and nothing stands out of either.
        const trim = (stroke: Stroke, lowest: number, highest: number): Stroke => {
          const segments = stroke.spine.segments.map((segment, index) => {
            if (index !== straightAt || segment.kind !== "line") return segment;
            const clamp = (y: number) => Math.min(Math.max(y, lowest), highest);
            return { ...segment, from: at(segment.from.x, clamp(segment.from.y)) };
          });
          return inherit(stroke, {
            ...stroke,
            spine: { ...stroke.spine, segments },
            start: { kind: "butt" },
          });
        };
        strokes = [
          trim(stem, Math.max(low, 2 * middle - high), high),
          trim(turned, 2 * middle - high, Math.min(2 * middle - low, high)),
        ];
      }
    }
    const leaned = strokes.map((stroke) => rotatedStroke(stroke, about, -FLORIN_LEAN));
    const slide = (y: number): number => (y - about.y) * Math.sin((FLORIN_LEAN * Math.PI) / 180);
    const level = bars.map((bar) => {
      const box = inkBox([bar]);
      return shovedStroke(bar, slide((box.yMin + box.yMax) / 2), 0);
    });
    // Stood back on the line the f stood on, where it does not descend.
    const now = inkBox(leaned);
    return shoved([...leaned, ...level], 0, standing ? was.yMin - now.yMin : 0);
  };
  /*
   * Leaned, the hooks' far ends come down: Geist's florin is as tall as its
   * f, so the turn is taken a little lower until it is again.
   */
  const first = make(0);
  if (!standing) return first;
  const short = was.yMax - was.yMin - (inkBox(first).yMax - inkBox(first).yMin);
  return short > 0.5 ? make(short / 2) : first;
}

/** How much lighter a per mille's two small rings are by a Black: see `perthousand`. */
const PER_MILLE_LIGHTER = 0.4;

/** The least a per mille's smaller rings keep open: a share of their stem, and of the em. */
const PER_MILLE_OPEN: [number, number] = [0.4, 0.05];

export const TYPOGRAPHIC_RECIPES: Record<LetterName, (style: Style) => Recipe> = {
  /*
   * The per mille: the percent with a second ring beside its lower one, as
   * Geist's is to the unit -- the same ring, and as far from the first as
   * Geist sets it.
   */
  perthousand: outOf("percent", (f, percent) => {
    const strokes = percent();
    // The rings are the closed runs, and the lower one is the one further
    // down; the slash is what is left. Asked of the runs rather than of
    // their sizes, which at a heavy weight put a ring taller than the slash.
    const centre = (stroke: Stroke): number => {
      const box = inkBox([stroke]);
      return (box.yMin + box.yMax) / 2;
    };
    const rings = strokes.filter((stroke) => stroke.spine.closed);
    if (rings.length === 0) return { strokes };
    const lowest = Math.min(...rings.map(centre));
    const lower = rings.filter((ring) => centre(ring) <= lowest + 1);
    const ring = inkBox(lower);
    const gap = ringGap(f);
    const width = ring.xMax - ring.xMin;
    /*
     * A monospaced face sets every glyph in one column, and a per mille a
     * ring wider than its percent would widen the column and every letter in
     * the font with it. There its two lower rings are drawn smaller, side by
     * side in the room the percent's one had, as a typewriter's are. And on
     * any face never past an em and a half: at a heavy weight of a wide face
     * the three rings ran two ems across. An em and a half of the Normal,
     * that is: held to it on an Expanded, a Black's two lower rings were
     * drawn small enough to come out lighter than the Regular's.
     */
    const whole = inkBox(strokes);
    const limit = f.style.metrics.monospaced
      ? whole.xMax
      : Math.max(whole.xMax, f.style.metrics.unitsPerEm * 1.5 * Math.max(1, widthShare(f.style)));
    const share = Math.min(1, (limit - ring.xMin) / (2 * width + gap));
    // Drawn the same way whether it is taken down or not, so the glyph has
    // the same points on both sides of the weight where it starts to be.
    const about = at(ring.xMin, ring.yMin);
    /*
     * And on a monospaced face, past the Bold, their pens lighter again than
     * their size alone takes off: a ring drawn smaller on a pen as much
     * smaller keeps its counter's share and not its size, and at 194 and 260
     * the typewriter's two small counters were pinholes.
     */
    const heavy =
      share < 1 && f.style.metrics.monospaced
        ? Math.min(1, Math.max(0, (blackness(f.style) - 0.45) / 0.55))
        : 0;
    /*
     * And never so heavy for their size that their counters shut: lighter
     * again, where they are drawn smaller, until each keeps two fifths of
     * the smaller ring's stem across and never under a twentieth of an em
     * (`PER_MILLE_OPEN`), on a Condensed of the width axis, where the
     * typewriter's were pinholes from 142.
     */
    const open = Math.max(
      f.half * 2 * share * PER_MILLE_OPEN[0],
      f.style.metrics.unitsPerEm * PER_MILLE_OPEN[1],
    );
    const small = lower.map((stroke) => {
      const one = scaledStroke(stroke, share, about);
      const lightened =
        heavy > 0
          ? inherit(one, {
              ...one,
              pen: { ...one.pen, weight: one.pen.weight * (1 - PER_MILLE_LIGHTER * heavy) },
            })
          : one;
      return share < 1 && widthShare(f.style) < 1 && stroke.spine.closed
        ? openedRing(lightened, open)
        : lightened;
    });
    return {
      strokes: [
        ...strokes.map((stroke) =>
          lower.includes(stroke) ? small[lower.indexOf(stroke)] : stroke,
        ),
        ...shoved(small, (width + gap) * share, 0),
      ],
      // Spaced as the percent is, which is set as a round letter.
      round: true,
    };
  }),

  florin: outOf("f", (f, letter) => ({
    strokes: florin(
      f,
      setInside(() => letter()),
    ),
  })),

  /*
   * The quotes. The low ones are the comma itself, exactly as Geist's and
   * Lora's are; the high ones are the comma raised, and the opening ones the
   * comma turned over.
   */
  quotesinglbase: outOf("comma", (_f, comma) => ({ strokes: comma() })),
  quotedblbase: outOf("comma", (f, comma) => ({ strokes: doubled(f, comma()) })),
  quoteright: outOf("comma", (f, comma) => ({ strokes: quoted(f, comma(), false) })),
  quoteleft: outOf("comma", (f, comma) => ({ strokes: quoted(f, comma(), true) })),
  quotedblright: outOf("comma", (f, comma) => ({
    strokes: doubled(f, quoted(f, comma(), false)),
  })),
  quotedblleft: outOf("comma", (f, comma) => ({ strokes: doubled(f, quoted(f, comma(), true)) })),

  // Half of a guillemet each, the same chevron at the same height.
  guilsinglleft: (style) => {
    const f = frame(style);
    return finish(f, [chevron(f, -1, f.edge)]);
  },
  guilsinglright: (style) => {
    const f = frame(style);
    return finish(f, [chevron(f, 1, f.edge)]);
  },

  endash: outOf("hyphen", (f, hyphen) => ({ strokes: dashed(f, hyphen(), "en") })),
  emdash: outOf("hyphen", (f, hyphen) => ({ strokes: dashed(f, hyphen(), "em") })),

  /*
   * Three full stops, closer than three set one after another would be.
   *
   * Geist sets them 185 apart, centre to centre, at the Thin and at the
   * Regular, and a dot and a third apart once its dots are bigger than that
   * allows (259 at the Black); Lora 270 apart at both its weights.
   */
  ellipsis: outOf("period", (f, period) => {
    const one = period();
    const box = inkBox(one);
    const pitch = Math.max(f.xOwn * (bookish(f) ? 0.54 : 0.35), (box.xMax - box.xMin) * 1.32);
    return { strokes: [...one, ...shoved(one, pitch, 0), ...shoved(one, pitch * 2, 0)] };
  }),

  /*
   * A round dot, a little under twice the full stop across (Geist's is 224 to
   * its full stop's 113, and 119 to 59 at the Thin) and more on a text face
   * (Lora's 301 to 117), centred on the middle of the x-height, where a list
   * of lowercase text wants it. Never more than six tenths of the x-height
   * across, which is where Geist Black stops it.
   */
  // Spaced as the full stop is, being a bigger one: Geist's stands 44 off
  // either side to its full stop's 44.
  bullet: outOf("period", (f) => {
    // And a fifth past that again a quarter of what it would have grown, so
    // a much heavier weight's is not the same dot as a lighter one's.
    const wanted = stopRadius(f) * (bookish(f) ? 2.4 : 1.9);
    const most = f.xOwn * 0.3;
    const radius = Math.min(wanted, most) + Math.max(0, wanted - most * 1.2) * 0.25;
    return finish(f, [disc(f, radius, f.xOwn / 2)]);
  }),

  /*
   * The bar of the plus and nothing else: the same length, the same weight,
   * on the same line -- which is what a minus has to be, or a column of sums
   * does not line up. Whichever of the plus's runs lies flattest.
   */
  minus: outOf("plus", (_f, plus) => {
    const strokes = plus();
    const flatness = (stroke: Stroke): number => {
      const box = inkBox([stroke]);
      return box.xMax - box.xMin - (box.yMax - box.yMin);
    };
    const bar = strokes.reduce((best, one) => (flatness(one) > flatness(best) ? one : best));
    return { strokes: [bar] };
  }),

  /*
   * The C with two bars through its back, reaching out past it on the left
   * and stopping inside its counter: Geist's stand at 0.36 and 0.61 of the cap
   * height and run out a tenth of it past the bowl, and Lora's do the same.
   */
  Euro: outOf("C", (f, c) => {
    const letter = setInside(() => c());
    const box = inkBox(letter);
    /*
     * Monoline, on every face, and lighter than a stem once the stem is
     * heavy: Geist's bars are 74 deep at the Regular and under a hundred at
     * the Black, and Lora's are as deep as its hyphen. At the stem's own
     * weight a Black's two bars filled the counter between them, and on a
     * pen with contrast they were hairlines.
     *
     * Heavier with the stem but a long way behind it: Geist Black's are 85
     * deep on a stem of 194 (0.44 of it). At 0.55 of the stem a heavy
     * weight's bars stood as deep as slabs and filled the counter between
     * them. And out past the bowl by a tenth of the cap height at every
     * weight, as Geist's Black's are by 60: reached out by half a stem, a
     * heavy weight's ran out like two planks nailed across the C.
     */
    const stem = f.style.pen.weight;
    const deep = Math.min(stem, Math.max(stem * 0.44, f.xOwn * 0.14));
    const out = f.cap * 0.1;
    const middle = f.cap * 0.485;
    const apart = Math.max(f.cap * 0.125, deep * 0.9);
    const reach = box.xMin + (box.xMax - box.xMin) * 0.5;
    const across = (y: number): Stroke => {
      const bar = thin(f, straight(at(box.xMin - out, y), at(reach, y)), f.plain, f.plain);
      return inherit(bar, { ...bar, pen: { ...bar.pen, contrast: 0, weight: deep } });
    };
    return joined(f, shoved(letter, out, 0), [
      shovedStroke(across(middle + apart), out, 0),
      shovedStroke(across(middle - apart), out, 0),
    ]);
  }),

  /*
   * This face's own T and M, set small with their heads on the cap line:
   * half the cap height on Geist (359 to 710), a little more on Lora (299 to
   * 700), and on a pen lighter than the letters', as a superior figure's is.
   */
  trademark: (style) => {
    const f = frame(style);
    const share = bookish(f) ? 0.57 : 0.5;
    const foot = f.cap * (1 - share);
    const left = f.edge - f.half;
    const t = small(f, "T", share, left, foot);
    const gap = Math.max(spacingOf(sized(f.style, share)) * 0.4, f.half * 0.5);
    const m = small(f, "M", share, inkBox(t).xMax + gap, foot);
    /*
     * Stood with its ink where a letter's starts. A joined face's T opens
     * with a flourish reaching back past its own side, which in a word is the
     * stroke the letter before hands over on; in a sign nothing is before it,
     * and left there it ran into whatever was.
     */
    const both = [...t, ...m];
    return { strokes: shoved(both, left - inkBox(both).xMin, 0) };
  },

  // Geist's: an upright from the line to the cap line, and a bar at 0.69 of
  // it; the double dagger's second bar at 0.31.
  dagger: (style) => dagger(style, [0.69]),
  daggerdbl: (style) => dagger(style, [0.69, 0.31]),
};
