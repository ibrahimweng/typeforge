/**
 * Drawing a letter from its recipe and the style it belongs to.
 *
 * The strokes are swept and the serifs are laid over them. Overlapping pieces
 * are left overlapping: that is how a serif is drawn by hand, it is invisible
 * under the fill rule font renderers use, and the export already fuses
 * everything before writing a file. Fusing here instead would mean doing
 * boolean geometry on every keystroke to gain nothing anyone can see.
 */

import { contourArea, contoursBounds, reverseContour } from "@/font/geometry";
import type { Contour, GlyphNode, Vec2 } from "@/font/types";
import { FIGURES, LETTERS, recipeOf, type Recipe } from "./letters";
import { alongSpine, spinePath } from "./shapes";
import { penReach, sweep } from "./sweep";
import type { Style } from "./style";
import type { Stroke, Terminal } from "./types";

export interface Drawn {
  contours: Contour[];
  advanceWidth: number;
}

/** A stroke's centre-line and the pen along it, for drawing over the letter. */
export interface Bone {
  path: string;
  /** Where the pen sits, and how wide it is there. */
  pen: { at: Vec2; across: number; along: number; angle: number }[];
}

/**
 * The skeleton of a letter.
 *
 * The point of showing it is that this half of the application is about
 * skeletons and until now there was no way to look at one. A control that moves
 * where an arch springs from is much easier to understand next to the line it
 * moves than next to a number.
 *
 * Taken from the strokes rather than reconstructed, so what is drawn is the
 * spine the sweep actually used -- corners rounded off, radii held at the pen's
 * limit and all.
 */
export function skeletonOf(name: string, style: Style, form?: string): Bone[] {
  const recipe = recipeOf(name, form);
  if (!recipe) return [];
  return recipe(style).strokes.map((stroke) => {
    const reach = penReach(stroke.pen);
    return {
      path: spinePath(stroke.spine),
      pen: alongSpine(stroke.spine, 6).map((where) => ({
        at: where,
        across: reach.across,
        along: reach.along,
        angle: (reach.angle * 180) / Math.PI,
      })),
    };
  });
}

export function letterNames(): string[] {
  return Object.keys(LETTERS);
}

export function canDraw(name: string): boolean {
  return name in LETTERS;
}

/** A round letter is set a little tighter, or it looks loose beside a flat one. */
const ROUND_TIGHTENING = 0.82;

/**
 * Draw one letter, in whichever form has been chosen for it.
 *
 * The form changes which skeleton is used and nothing else. The pen, the
 * proportions and every named part are applied to an alternate exactly as they
 * are to the default, so a font with a flat-topped A still has one weight, one
 * shoulder and one serif.
 */
export function drawLetter(name: string, style: Style, form?: string): Drawn | null {
  const recipe = recipeOf(name, form);
  if (!recipe) return null;
  const built: Recipe = recipe(style);

  const upright: Contour[] = [];
  for (const stroke of built.strokes) {
    upright.push(...sweep(stroke));
    upright.push(...serifsFor(stroke, style));
  }
  const contours = leaning(upright, style);
  return { contours, advanceWidth: advanceFor(name, built, contours, style) };
}

/**
 * The letter, leaned over.
 *
 * Done to the finished outline rather than to the skeleton, and that is the
 * whole reason it is exact. A shear is an affine map, an affine map takes a
 * cubic to a cubic with no error at all, so a slanted face is as accurate as an
 * upright one. Slanting the skeleton instead would turn every circular arc into
 * an ellipse, and an ellipse does not offset to an ellipse -- the offsets would
 * have to be sampled and refitted, and the promise that a heavy cut is the same
 * construction as a light one rather than a pushed-about version of it would be
 * gone.
 *
 * Pivoted at the middle of the lowercase, so a letter leans about its own waist
 * instead of swinging out of its space from the baseline.
 */
function leaning(contours: Contour[], style: Style): Contour[] {
  const degrees = style.metrics.slant;
  if (!degrees) return contours;
  const lean = Math.tan((degrees * Math.PI) / 180);
  const pivot = style.metrics.xHeight / 2;
  const move = (point: Vec2): Vec2 => ({ x: point.x + (point.y - pivot) * lean, y: point.y });
  const leant = contours.map((contour) => ({
    ...contour,
    nodes: contour.nodes.map((node) => ({
      ...node,
      point: move(node.point),
      handleIn: node.handleIn ? move(node.handleIn) : null,
      handleOut: node.handleOut ? move(node.handleOut) : null,
    })),
  }));

  /*
   * And nudged back inside its own left edge if the lean carried it out.
   *
   * Leaning about the waist keeps the middle of a letter where it was and
   * swings the two ends in opposite directions, so anything reaching well below
   * the baseline swings left -- a j at thirteen degrees crossed the origin and
   * would have printed over whatever came before it. Only the letters that
   * actually cross are moved, and each by exactly what it needs, which is what
   * a slanted face wants anyway: its spacing is not its upright's spacing.
   */
  if (leant.length === 0) return leant;
  const edge = style.metrics.sidebearing;
  const shortfall = edge - contoursBounds(leant).xMin;
  if (shortfall <= 0) return leant;
  const shift = (point: Vec2): Vec2 => ({ x: point.x + shortfall, y: point.y });
  return leant.map((contour) => ({
    ...contour,
    nodes: contour.nodes.map((node) => ({
      ...node,
      point: shift(node.point),
      handleIn: node.handleIn ? shift(node.handleIn) : null,
      handleOut: node.handleOut ? shift(node.handleOut) : null,
    })),
  }));
}

/**
 * How much room the letter takes on the line.
 *
 * Measured off the drawing rather than stated by the recipe, so a terminal or
 * an overshoot that reaches further than expected takes its space with it
 * instead of hanging outside the letter's own width.
 *
 * Figures are the exception: they are all given the width of the widest of
 * them, because a column of numbers only lines up if every digit occupies the
 * same space, and that is worth more than each one being spaced for itself.
 */
function advanceFor(name: string, recipe: Recipe, contours: Contour[], style: Style): number {
  if (recipe.width !== undefined) return recipe.width;
  if (FIGURES.includes(name)) return figureAdvance(style);
  return measure(recipe, contours, style);
}

function measure(recipe: Recipe, contours: Contour[], style: Style): number {
  if (contours.length === 0) return style.metrics.sidebearing * 2;
  const trailing = style.metrics.sidebearing * (recipe.round ? ROUND_TIGHTENING : 1);
  return contoursBounds(contours).xMax + trailing;
}

/** The figures are all drawn at the same width, so they need the same lean. */

const figureCache = new WeakMap<Style, number>();

function figureAdvance(style: Style): number {
  const known = figureCache.get(style);
  if (known !== undefined) return known;
  let widest = 0;
  for (const name of FIGURES) {
    const built = LETTERS[name](style);
    const contours = leaning(
      built.strokes.flatMap((stroke) => [...sweep(stroke), ...serifsFor(stroke, style)]),
      style,
    );
    widest = Math.max(widest, measure(built, contours, style));
  }
  figureCache.set(style, widest);
  return widest;
}

/**
 * The serifs on one stroke.
 *
 * A serif is two wings, one either side of the stroke, rather than a bar across
 * it. The middle of a bar would sit inside the stem where there is already ink,
 * so drawing only the parts that stick out says the same thing with less shape,
 * and it keeps the fillet -- the curve where the serif sweeps back into the
 * stem -- as an edge of the wing rather than as a hole that has to be
 * subtracted.
 */
function serifsFor(stroke: Stroke, style: Style): Contour[] {
  const out: Contour[] = [];
  const reference = penReach(style.pen).across;
  const ends = endsOf(stroke);
  for (const [terminal, at, outward, straightEnd] of ends) {
    if (terminal.kind !== "slab") continue;
    /*
     * Only a straight stroke gets a serif.
     *
     * A bar laid across the end of a curve sits at whatever angle the curve
     * happened to be travelling, and it reads as something snapped off rather
     * than as part of the letter: the c, e, s and 2 all came out with wings.
     * Serif faces finish a curved terminal differently -- flared, or with a
     * ball -- and until there is a shape for that, the plain terminal the style
     * already specifies is the honest answer.
     */
    if (!straightEnd) continue;
    const projection = terminal.projection ?? 0;
    const thickness = terminal.thickness ?? 0;
    if (projection <= 0 || thickness <= 0) continue;

    /*
     * How far the serif reaches is measured from the font's stem, not from the
     * stroke it happens to be sitting on.
     *
     * The arm of a T is a thin stroke -- thinner still on a face with contrast,
     * where the pen is narrow across a horizontal -- and sizing its serif from
     * its own width made the serif taller than the arm it belonged to, so a T
     * came out wearing two flags. Every serif in a typeface is the same size
     * whatever it is attached to, which is what makes them read as one family
     * of shapes rather than as decoration scaled to fit.
     *
     * The wing still starts at the edge of the stroke it is on, or it would
     * float clear of a thin one.
     */
    const inner = penReach(stroke.pen).across;
    const tip = reference + projection;
    if (tip <= inner) continue;
    // Never fillet more than the wing is deep or wide, or the curve would have
    // to begin before the serif does.
    const bracket = Math.min(terminal.bracket ?? 0, thickness, tip - inner);
    for (const side of [1, -1]) {
      /*
       * A serif never crosses a line the stroke it belongs to is standing on.
       *
       * A serif is a bar across the end of a stroke, and on an upright it goes
       * both ways: that is a foot. On an arm lying along the baseline it cannot,
       * because one of its two wings would hang under the line the letter is
       * standing on. The bottom arm of an E did exactly that -- two hundred
       * units below the baseline on the display face -- and so did an L and a
       * Z, while a T grew one above the cap height.
       *
       * Real serif faces have known this forever: the arms of a T turn down and
       * the foot of an L turns up. It falls out of one rule rather than a list
       * of letters, so a letter that gains an arm tomorrow gets it too.
       */
      if (crossesALine(at, outward, side, tip, inner, style)) continue;
      // Wound with the strokes it sits on, or the serif would cancel the stem
      // it is attached to rather than adding to it.
      const shape = wing(at, outward, side, inner, tip, thickness, bracket);
      out.push(contourArea(shape) < 0 ? reverseContour(shape) : shape);
    }
  }
  return out;
}

/** Whether this wing would reach past a line the stroke end is sitting on. */
function crossesALine(
  at: Vec2,
  outward: Vec2,
  side: number,
  tip: number,
  inner: number,
  style: Style,
): boolean {
  const { metrics } = style;
  const across = { x: -outward.y * side, y: outward.x * side };
  const far = at.y + across.y * tip;
  /*
   * Each line with the direction the letter lies in from it. Needed because
   * a stroke ending exactly on a line is on neither side of it, so which way
   * the wing is heading cannot be read off the line alone -- asked that way,
   * both wings of every foot looked like they were crossing and every serif in
   * the font disappeared.
   */
  const lines: Array<[number, number]> = [
    [0, 1],
    [metrics.descender, 1],
    [metrics.xHeight, -1],
    [metrics.capHeight, -1],
    [metrics.ascender, -1],
  ];
  return lines.some(
    ([line, inward]) =>
      // The stroke ends on this line, and the wing sets off well past it. A
      // wing that only dips below -- which the foot of a diagonal does simply
      // by being at an angle -- is left alone.
      Math.abs(at.y - line) < inner && (far - line) * inward < -inner,
  );
}

/**
 * Both ends of a stroke: the terminal, where it is, which way it faces, and
 * whether the run arriving there is straight.
 */
function endsOf(stroke: Stroke): Array<[Terminal, Vec2, Vec2, boolean]> {
  const segments = stroke.spine.segments;
  if (stroke.spine.closed || segments.length === 0) return [];

  const first = segments[0];
  const last = segments[segments.length - 1];

  const startPoint = first.kind === "line" ? first.from : onArc(first.centre, first.radius, first.startAngle);
  const endPoint = last.kind === "line" ? last.to : onArc(last.centre, last.radius, last.endAngle);

  const startOut = first.kind === "line"
    ? unit(startPoint, first.to, -1)
    : tangentOnArc(first.startAngle, first.sweepPositive, -1);
  const endOut = last.kind === "line"
    ? unit(last.from, endPoint, 1)
    : tangentOnArc(last.endAngle, last.sweepPositive, 1);

  return [
    [stroke.start, startPoint, startOut, first.kind === "line"],
    [stroke.end, endPoint, endOut, last.kind === "line"],
  ];
}

const onArc = (centre: Vec2, radius: number, angle: number): Vec2 => ({
  x: centre.x + radius * Math.cos(angle),
  y: centre.y + radius * Math.sin(angle),
});

function unit(from: Vec2, to: Vec2, way: number): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: (dx / length) * way, y: (dy / length) * way };
}

function tangentOnArc(angle: number, sweepPositive: boolean, way: number): Vec2 {
  const sign = (sweepPositive ? 1 : -1) * way;
  return { x: -Math.sin(angle) * sign, y: Math.cos(angle) * sign };
}

const node = (point: Vec2): GlyphNode => ({ point, handleIn: null, handleOut: null, type: "corner" });

/**
 * One wing of a serif.
 *
 * Worked out in the stroke's own frame -- `across` runs along the end of the
 * stroke and `into` runs back up it -- and then written out in the letter's
 * coordinates, so the same code serifs the foot of a stem, the top of an
 * ascender and the end of an arm without knowing which is which.
 */
function wing(
  at: Vec2,
  outward: Vec2,
  side: number,
  inner: number,
  tip: number,
  thickness: number,
  bracket: number,
): Contour {
  const across = { x: -outward.y * side, y: outward.x * side };
  const into = { x: -outward.x, y: -outward.y };
  const place = (u: number, v: number): Vec2 => ({
    x: at.x + across.x * u + into.x * v,
    y: at.y + across.y * u + into.y * v,
  });

  const nodes: GlyphNode[] = [
    node(place(inner, 0)),
    node(place(tip, 0)),
    node(place(tip, thickness)),
  ];

  if (bracket > 0) {
    /*
     * The fillet: a quarter turn hollowing out the inside corner where the
     * serif meets the stem. Zero bracket leaves that corner square, which is a
     * slab serif; opening it out is what makes a text serif look grown from the
     * stem rather than stuck on it.
     */
    const corner = place(inner + bracket, thickness);
    const meet = place(inner, thickness + bracket);
    const handle = 0.5523 * bracket;
    nodes.push({
      point: corner,
      handleIn: null,
      handleOut: {
        x: corner.x - across.x * handle * 1,
        y: corner.y - across.y * handle * 1,
      },
      type: "tangent",
    });
    nodes.push({
      point: meet,
      handleIn: {
        x: meet.x - into.x * handle,
        y: meet.y - into.y * handle,
      },
      handleOut: null,
      type: "tangent",
    });
  } else {
    nodes.push(node(place(inner, thickness)));
  }

  return { nodes, closed: true };
}
