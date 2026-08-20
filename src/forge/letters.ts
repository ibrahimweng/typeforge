/**
 * Where the strokes of each letter run.
 *
 * A recipe here says nothing about weight, contrast, serifs or terminals. It
 * says only that an n is a stem on the left, an arch springing off it, and a
 * second stem coming down on the right -- the skeleton, which is what a letter
 * is underneath. Everything else arrives from the style when it is drawn.
 *
 * Splitting it that way is what lets one edit reach the whole font. The arch of
 * an n, the arch of an m and the arch of an h are not three drawings that
 * resemble each other; they are three uses of one description, so moving where
 * the arch springs from moves all three, and there is no fourth copy somewhere
 * that got missed.
 *
 * None of these shapes is traced from or fitted to an existing typeface. They
 * are constructed from the metrics and the parts, which is what makes the
 * result yours.
 */

import type { Vec2 } from "@/font/types";
import type { Style } from "./style";
import { terminalFor } from "./style";
import type { Spine, Stroke, Terminal } from "./types";

/** A letter, as strokes plus how much room it takes on the line. */
export interface Recipe {
  strokes: Stroke[];
  advanceWidth: number;
}

const point = (x: number, y: number): Vec2 => ({ x, y });

const straight = (from: Vec2, to: Vec2): Spine => ({
  segments: [{ kind: "line", from, to }],
  closed: false,
});

/**
 * A half turn, as an arch or the top of a bowl.
 *
 * Given in the terms a designer thinks in -- where the middle of the turn is,
 * how wide, which way up -- rather than in angles, so a recipe reads as a
 * description of the letter rather than as trigonometry.
 */
function turn(centre: Vec2, radius: number, from: number, to: number): Spine {
  return {
    segments: [
      {
        kind: "arc",
        centre,
        radius,
        startAngle: from,
        endAngle: to,
        sweepPositive: to > from,
      },
    ],
    closed: false,
  };
}

function ring(centre: Vec2, radius: number): Spine {
  return {
    segments: [
      {
        kind: "arc",
        centre,
        radius,
        startAngle: 0,
        endAngle: Math.PI * 2,
        sweepPositive: true,
      },
    ],
    closed: true,
  };
}

/** Join several spines end to end into one stroke that turns as it goes. */
function chain(...spines: Spine[]): Spine {
  return { segments: spines.flatMap((spine) => spine.segments), closed: false };
}

export type LetterName = string;

/**
 * The recipes.
 *
 * Each is a function of the style rather than a fixed set of coordinates, so
 * changing the x-height or the width of a counter redraws every letter at the
 * new proportions instead of scaling a drawing made for the old ones.
 */
export const LETTERS: Record<LetterName, (style: Style) => Recipe> = {
  i: (style) => stemLetter(style, style.metrics.xHeight, true),
  l: (style) => stemLetter(style, style.metrics.ascender, false),
  I: (style) => stemLetter(style, style.metrics.capHeight, false),

  n: (style) => arched(style, 1),
  m: (style) => arched(style, 2),

  u: (style) => {
    const { xHeight } = style.metrics;
    const cap = terminalFor(style);
    const half = archWidth(style) / 2;
    const left = sidebearing(style);
    const right = left + half * 2;
    const springAt = xHeight * (1 - style.parts.shoulder.spring);

    return {
      strokes: [
        // Down the left, round the bottom, and up the right: one continuous
        // stroke, which is why a u's bowl never disagrees with its stems.
        {
          spine: chain(
            straight(point(left, xHeight), point(left, springAt)),
            turn(point(left + half, springAt), half, Math.PI, Math.PI * 2),
            straight(point(right, springAt), point(right, xHeight)),
          ),
          pen: style.pen,
          start: cap,
          end: cap,
        },
      ],
      advanceWidth: right + sidebearing(style),
    };
  },

  o: (style) => {
    const { xHeight, overshoot } = style.metrics;
    const radius = (archWidth(style) / 2) * style.parts.bowl.roundness;
    const centre = point(sidebearing(style) + radius, xHeight / 2);
    void overshoot;
    return {
      strokes: [
        { spine: ring(centre, radius), pen: style.pen, start: BUTT, end: BUTT },
      ],
      advanceWidth: centre.x + radius + sidebearing(style),
    };
  },

  O: (style) => {
    const { capHeight } = style.metrics;
    const radius = capHeight / 2;
    const centre = point(sidebearing(style) + radius, capHeight / 2);
    return {
      strokes: [{ spine: ring(centre, radius), pen: style.pen, start: BUTT, end: BUTT }],
      advanceWidth: centre.x + radius + sidebearing(style),
    };
  },

  H: (style) => {
    const { capHeight } = style.metrics;
    const cap = terminalFor(style);
    const left = sidebearing(style);
    const right = left + style.metrics.counterWidth + style.pen.weight;
    const bar = capHeight * style.parts.crossbar.height;
    return {
      strokes: [
        { spine: straight(point(left, 0), point(left, capHeight)), pen: style.pen, start: cap, end: cap },
        { spine: straight(point(right, 0), point(right, capHeight)), pen: style.pen, start: cap, end: cap },
        {
          spine: straight(point(left, bar), point(right, bar)),
          pen: crossbarPen(style),
          start: BUTT,
          end: BUTT,
        },
      ],
      advanceWidth: right + sidebearing(style),
    };
  },

  T: (style) => {
    const { capHeight } = style.metrics;
    const cap = terminalFor(style);
    const half = (style.metrics.counterWidth + style.pen.weight) / 2;
    const middle = sidebearing(style) + half;
    return {
      strokes: [
        { spine: straight(point(middle, 0), point(middle, capHeight)), pen: style.pen, start: cap, end: BUTT },
        {
          spine: straight(point(middle - half, capHeight), point(middle + half, capHeight)),
          pen: crossbarPen(style),
          start: cap,
          end: cap,
        },
      ],
      advanceWidth: middle + half + sidebearing(style),
    };
  },
};

const BUTT: Terminal = { kind: "butt" };

/** Where the ink starts, allowing for the pen's own width. */
function sidebearing(style: Style): number {
  return style.metrics.sidebearing + style.pen.weight / 2;
}

/** How wide the inside of an arch is, measured between stem centres. */
function archWidth(style: Style): number {
  return style.metrics.counterWidth + style.pen.weight;
}

/**
 * A bar can be lighter than the stems it crosses, which is how a crossbar
 * avoids looking heavier than the letter around it.
 */
function crossbarPen(style: Style) {
  return { ...style.pen, weight: style.pen.weight * style.parts.crossbar.weight };
}

/** i, l and I: one stem, with a dot when the letter wants one. */
function stemLetter(style: Style, height: number, dotted: boolean): Recipe {
  const cap = terminalFor(style);
  const x = sidebearing(style);
  const strokes: Stroke[] = [
    { spine: straight(point(x, 0), point(x, height)), pen: style.pen, start: cap, end: cap },
  ];
  if (dotted) {
    const gap = style.pen.weight * 0.75;
    const radius = style.pen.weight * 0.55;
    strokes.push({
      spine: ring(point(x, height + gap + radius), radius * 0.01),
      pen: { ...style.pen, weight: radius * 2 },
      start: BUTT,
      end: BUTT,
    });
  }
  return { strokes, advanceWidth: x + sidebearing(style) };
}

/**
 * n and m: a stem, then one arch and a stem for each hump.
 *
 * The arch springs from partway up the stem rather than from its top, which is
 * the single decision that most changes how a lowercase reads, and it is one
 * number in the style rather than a shape drawn into each letter.
 */
function arched(style: Style, humps: number): Recipe {
  const { xHeight } = style.metrics;
  const cap = terminalFor(style);
  const half = archWidth(style) / 2;
  const springAt = xHeight * style.parts.shoulder.spring;
  const left = sidebearing(style);

  const strokes: Stroke[] = [
    { spine: straight(point(left, 0), point(left, xHeight)), pen: style.pen, start: cap, end: cap },
  ];

  for (let hump = 0; hump < humps; hump++) {
    const from = left + hump * half * 2;
    const centre = point(from + half, springAt);
    const to = from + half * 2;
    strokes.push({
      // Over the top and straight down, as one stroke, so the arch and the
      // stem it lands on cannot disagree about where they meet.
      spine: chain(turn(centre, half, Math.PI, 0), straight(point(to, springAt), point(to, 0))),
      pen: style.pen,
      start: BUTT,
      end: cap,
    });
  }

  const rightmost = left + humps * half * 2;
  return { strokes, advanceWidth: rightmost + sidebearing(style) };
}
