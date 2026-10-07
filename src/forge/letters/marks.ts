/**
 * The marks: the accents, drawn with the font's own pen.
 *
 * One part of the table `LETTERS` in `../letters.ts` is assembled from, moved
 * here unchanged so the recipes can be read a group at a time. Only that file
 * imports it; see it for what a recipe is and how the table is used.
 */

import type { Style } from "../style";
import {
  at,
  BUTT,
  chain,
  dot,
  fatFace,
  finish,
  frame,
  hook,
  ink,
  type LetterName,
  markBox,
  markFrame,
  markGrown,
  type Recipe,
  ring,
  unCondensed,
  shortEnd,
  straight,
  turn,
} from "./common";

/**
 * The box a chevron is drawn in -- a circumflex, a caron: never shallower
 * than a pen, and never steeper than about forty degrees.
 *
 * `markBox` lets a heavy pen take the height a mark would have had, which
 * suits a stroke or a dot. A chevron is two strokes meeting, and flattened to
 * half a pen tall its notch filled in: a heavy caron was a heart. So it keeps
 * a pen and a fifth of height and widens to keep its angle, as Geist Black's
 * does.
 */
function chevronBox(f: ReturnType<typeof markFrame>, m: ReturnType<typeof markBox>) {
  const top = Math.max(m.top, m.foot + f.half * 1.2);
  const w = Math.max(m.w, (top - m.foot) * 1.2);
  return { ...m, top, w, cx: m.cx - m.w + w };
}

/**
 * The box an acute or a grave is drawn in: on a fat face no wider than it is
 * tall, or thereabouts, so the stroke stands at the angle an accent is read by.
 * A heavy pen takes most of the height a mark has, and laid across the text
 * width in what is left, the Display's acute was a brick lying nearly flat.
 */
function slopeBox(f: ReturnType<typeof markFrame>, m: ReturnType<typeof markBox>) {
  if (!fatFace(f.style)) return m;
  const w = Math.min(m.w, Math.max((m.top - m.foot) * 1.3, f.half));
  return { ...m, w };
}

export const MARK_RECIPES: Record<LetterName, (style: Style) => Recipe> = {
  // -------------------------------------------------------------------------
  // The marks
  // -------------------------------------------------------------------------
  //
  // Drawn with the font's own pen, so an accent on a heavy face is heavy and an
  // accent on a slanted one leans with the letters. That is the whole reason
  // for drawing them here rather than shipping a set of fixed shapes: a tilde
  // that stayed the same while the face around it changed would look borrowed
  // from another font, which is exactly what it would be.
  //
  // Each one stands on its own above the x-height. Where it ends up on a letter
  // is settled later, by lining its foot up with the top of the letter it goes
  // on -- so these only have to be the right shape, not in the right place.

  grave: (style) => {
    const f = markFrame(style);
    const m = slopeBox(f, markBox(f));
    return finish(f, [
      ink(f, straight(at(m.cx - m.w, m.top), at(m.cx + m.w, m.foot)), shortEnd(f), shortEnd(f)),
    ]);
  },

  acute: (style) => {
    const f = markFrame(style);
    const m = slopeBox(f, markBox(f));
    return finish(f, [
      ink(f, straight(at(m.cx - m.w, m.foot), at(m.cx + m.w, m.top)), shortEnd(f), shortEnd(f)),
    ]);
  },

  circumflex: (style) => {
    const f = markFrame(style);
    const m = chevronBox(f, markBox(f));
    // One run with a corner in it rather than two strokes meeting, so the apex
    // is joined the way every other corner in the font is -- and rounds off
    // with them when the face asks for that.
    return finish(f, [
      ink(
        f,
        chain(
          straight(at(m.cx - m.w, m.foot), at(m.cx, m.top)),
          straight(at(m.cx, m.top), at(m.cx + m.w, m.foot)),
        ),
        shortEnd(f),
        shortEnd(f),
      ),
    ]);
  },

  caron: (style) => {
    const f = markFrame(style);
    const m = chevronBox(f, markBox(f));
    // The circumflex the other way up, which is what a caron is.
    return finish(f, [
      ink(
        f,
        chain(
          straight(at(m.cx - m.w, m.top), at(m.cx, m.foot)),
          straight(at(m.cx, m.foot), at(m.cx + m.w, m.top)),
        ),
        shortEnd(f),
        shortEnd(f),
      ),
    ]);
  },

  /*
   * A tilde: over a hump and down into a dip.
   *
   * Two half-turns that meet where both are heading straight down, so the wave
   * is tangent-continuous and the sweep has no kink in it. Circular, like
   * everything else here, which fixes the proportion: the run is four radii
   * across and two tall. That is a fair tilde and not an accident -- a flatter
   * one would have to be elliptical, and an ellipse does not offset to an
   * ellipse, so it would be the one shape in the font whose weight was
   * approximate.
   */
  tilde: (style) => {
    const f = markFrame(style);
    const m = markBox(f);
    /*
     * Heavier only by running wider, on the pen a mark can carry (see
     * `markGrown`). Its two ends are cut level across a wave that rises from
     * them, so a heavier pen pushed the left one out past where the letter is
     * spaced from, and on a sloped face it leant into the letter before.
     */
    const grown = markGrown(f);
    const pen =
      grown > 0
        ? frame({ ...f.style, pen: { ...f.style.pen, weight: f.style.pen.weight - grown } })
        : f;
    const radius = Math.max(m.w / 2, f.least);
    const middle = (m.foot + m.top - grown) / 2;
    return finish(f, [
      ink(
        pen,
        chain(
          turn(at(m.cx - radius, middle), radius, 180, 0),
          turn(at(m.cx + radius, middle), radius, 180, 360),
        ),
        shortEnd(pen),
        shortEnd(pen),
      ),
    ]);
  },

  dieresis: (style) => {
    const f = markFrame(style);
    const m = markBox(f);
    const radius = f.half * 0.95 + f.x * 0.02 * Math.max(0, 1 - (f.half * 2) / 86);
    const height = m.foot + (m.top - m.foot) * 0.5;
    // Set apart by the width of the mark, so the pair reads as two dots rather
    // than as a smudge at a heavy weight or as two separate marks at a light one
    // -- and never nearer than two thirds of a dot's width between them.
    const apart = Math.max(m.w * 0.5, radius * 1.35);
    return finish(f, [
      dot(f, at(m.cx - apart, height), radius),
      dot(f, at(m.cx + apart, height), radius),
    ]);
  },

  dotaccent: (style) => {
    const f = markFrame(style);
    const m = markBox(f);
    const radius = f.half * 0.95;
    return finish(f, [dot(f, at(m.cx, m.foot + (m.top - m.foot) * 0.5), radius)]);
  },

  macron: (style) => {
    const f = markFrame(style);
    const m = markBox(f);
    const height = m.foot + (m.top - m.foot) * 0.45;
    return finish(f, [
      ink(f, straight(at(m.cx - m.w, height), at(m.cx + m.w, height)), shortEnd(f), shortEnd(f)),
    ]);
  },

  ring: (style) => {
    const f = markFrame(unCondensed(style));
    const m = markBox(f);
    /*
     * Drawn lighter than the stems, and wide enough to have a hole in it.
     *
     * A ring is the one mark whose whole job is the white inside it, and a
     * small shape drawn with the font's full pen has almost none: at a text
     * weight it came out a disc with a pinhole. Lightening the pen is what a
     * designer does here, and it is what every face with an angstrom in it
     * does.
     *
     * As round as the face is, though. A technical font squares its bowls, and
     * the ring on an angstrom is a bowl like any other.
     */
    const pen = { ...f.style.pen, weight: f.style.pen.weight * 0.62 };
    /*
     * Held inside the mark box like every other mark, but never turned tighter
     * than the pen drawing it. Taken from the width alone it outgrew the box on
     * a wide face and put the ring of an Aring half an em over the cap line;
     * held to the box alone it closed up, because what a ring is is the white
     * inside it and there was almost none left.
     */
    const radius = Math.max(Math.min(m.w * 0.82, (m.top - m.foot) / 2), pen.weight);
    const centre = at(m.cx, m.foot + radius + pen.weight / 2);
    return finish(f, [{ spine: ring(f, centre, radius), pen, start: BUTT, end: BUTT }], true);
  },

  breve: (style) => {
    const f = markFrame(style);
    const m = markBox(f);
    // A cup: the bottom half of a turn, opening upwards. Lighter than the
    // stems for the same reason the ring is -- what it is is the curve, and a
    // full-weight pen on a shape this small fills the curve in.
    const pen = { ...f.style.pen, weight: f.style.pen.weight * 0.82 };
    // Deeper by what its pen gained past the most a mark carries (see
    // `markGrown`), or a heavier weight's cup was the same size drawn thicker
    // into itself, and on an Expanded had less ink than a lighter one's.
    const radius = Math.max(Math.min(m.w * 0.9, m.top - m.foot + markGrown(f)), pen.weight * 0.7);
    return finish(f, [
      { spine: turn(at(m.cx, m.top), radius, 180, 360), pen, start: BUTT, end: BUTT },
    ]);
  },

  /*
   * Two acutes side by side, which is what a double acute is.
   *
   * Hungarian's own accent, and Unicode calls it by that name. Drawn as two
   * of the acute already here rather than as its own shape, at the same slope,
   * so a face that gives its accents a flatter angle gives this one the same
   * flatter angle. Narrower than one acute each, or the pair reaches half again
   * as wide as every other mark in the font and an o with one on stops looking
   * like the o beside it.
   */
  hungarumlaut: (style) => {
    const f = markFrame(style);
    const m = markBox(f);
    /*
     * On a fat face each stroke a little longer than the pen is wide, so the
     * pair read as two acutes rather than two tilted squares.
     */
    const wide = fatFace(f.style) ? Math.max(m.w * 0.44, f.half * 0.8) : m.w * 0.44;
    // Never nearer than a pen and a bit apart, or at a heavy weight the two
    // strokes ran into one notched block.
    const apart = Math.max(m.w * 0.62, f.half * 1.75, fatFace(f.style) ? wide + f.half * 1.1 : 0);
    return finish(
      f,
      [-1, 1].map((side) =>
        ink(
          f,
          straight(at(m.cx + side * apart - wide, m.foot), at(m.cx + side * apart + wide, m.top)),
          shortEnd(f),
          shortEnd(f),
        ),
      ),
    );
  },

  /*
   * An ogonek: the little tail under a Polish a.
   *
   * The cedilla pointed the other way, and that is not a shortcut -- it is
   * what the two are. One hooks away from the letter to the left and the other
   * to the right, and everything else about them is the same decision: how far
   * below the foot they hang, how tight the turn is, how the end is cut. Built
   * from the same run so a face that squares its cedilla squares this too.
   */
  ogonek: (style) => hook(style, 1),

  /*
   * A comma below, which is not a cedilla however often it is set as one.
   *
   * Latvian and Romanian want a comma under the letter, and Unicode gives
   * those letters the cedilla in their decomposition anyway -- which is a
   * fact about the encoding rather than about the shape, and is why the glyphs
   * are named `commaaccent` and not `cedilla`. Set with a cedilla they are
   * wrong in the way that a reader of the language notices and nobody else
   * does.
   *
   * The comma already drawn, turned upside down and hung under the letter,
   * because that is what a comma below is.
   */
  commaaccent: (style) => {
    const f = markFrame(style);
    const m = markBox(f);
    /*
     * Hung as deep as the cedilla and no deeper. Sized against the x-height
     * and the pen, as the cedilla is, rather than against the descender, which
     * a face may set to almost nothing -- and reaching a fixed number of its
     * own widths below the line put a Sans gcommaaccent eighty units under the
     * descender, which is a letter that hangs out of its own line.
     */
    const drop = Math.max(f.x * 0.15, f.least) * 2;
    const radius = Math.max(f.half * 0.8, f.least * 0.5);
    const top = at(m.cx + radius * 0.4, -radius * 0.2);
    return finish(f, [
      {
        spine: straight(top, at(top.x - radius * 0.5, -drop)),
        pen: { ...f.style.pen, contrast: 0, weight: radius * 1.7 },
        start: { kind: "round" },
        end: { kind: "round" },
      },
    ]);
  },

  /*
   * The comma the other way up, sitting over the letter.
   *
   * For the g and nothing else. A comma below goes below, except on a letter
   * that is already using the room below -- and the only one of those that
   * takes the mark is the g, whose descender reaches the bottom of the line
   * before the mark has started. Every font that has a ģ puts the comma over
   * it instead, turned, and this is that.
   */
  commaturnedabove: (style) => {
    const f = markFrame(style);
    const m = markBox(f);
    const radius = Math.max(f.half * 0.8, f.least * 0.5);
    const foot = at(m.cx - radius * 0.4, m.foot + radius * 0.2);
    return finish(f, [
      {
        spine: straight(foot, at(foot.x + radius * 0.5, m.foot + (m.top - m.foot) * 0.9)),
        pen: { ...f.style.pen, contrast: 0, weight: radius * 1.7 },
        start: { kind: "round" },
        end: { kind: "round" },
      },
    ]);
  },

  /*
   * The caron of a ď, an ľ, a ť and an Ľ: an apostrophe standing beside the
   * stem, as every Czech and Slovak text is set, rather than a chevron over
   * the ascender. Narrowing to its foot as the comma accent does, and as long
   * as the ordinary caron is tall and a half again, so it reads beside a stem
   * as tall as an ascender. Placed by `besideTop` in `build.ts`.
   */
  apostrophemod: (style) => {
    const f = markFrame(style);
    const m = markBox(f);
    const radius = Math.max(f.half * 0.8, f.least * 0.5);
    // And never so short beside a heavy pen that it reads as a dot.
    const tall = Math.max((m.top - m.foot) * 1.5, radius * 3.2);
    const top = at(m.cx + radius * 0.3, m.top);
    const foot = at(top.x - Math.max(radius * 0.6, tall * 0.18), m.top - tall);
    const middle = at((top.x + foot.x) / 2, (top.y + foot.y) / 2);
    return finish(f, [
      {
        // Two pieces, so a written hand never bows it: at a hairline it bowed
        // and at a text weight it did not, and the mark changed its points.
        spine: chain(straight(top, middle), straight(middle, foot)),
        pen: { ...f.style.pen, contrast: 0, weight: radius * 1.7 },
        start: { kind: "round" },
        end: { kind: "round" },
      },
    ]);
  },

  /*
   * A cedilla, which hangs under the letter rather than sitting over it.
   *
   * Drawn below the baseline for the same reason the others are drawn above the
   * x-height: it is put where it belongs afterwards, by lining its head up with
   * the foot of the letter, so what matters here is only its shape.
   */
  cedilla: (style) => hook(style, -1),
};
