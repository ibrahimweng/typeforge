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
import { alongSpine, spinePath, wavy } from "./shapes";
import { penReach, reachAlong, sweep } from "./sweep";
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
  const contours = insideTheEdge(leaning(upright, style), style);
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

  return leant;
}

/**
 * The letter nudged back inside its own left edge, if anything on it reaches
 * out past the space it was given.
 *
 * Two things do. Leaning about the waist keeps the middle of a letter where it
 * was and swings the two ends in opposite directions, so anything reaching well
 * below the baseline swings left -- a j at thirteen degrees crossed the origin
 * and would have printed over whatever came before it. And a serif laid along a
 * line is as wide as the stroke is across that line, which on a diagonal is
 * wider than the stroke itself: the foot of an x on the serif face reached past
 * its own sidebearing.
 *
 * Only the letters that actually cross are moved, and each by exactly what it
 * needs. The advance is measured off the drawing afterwards, so the letter
 * keeps its spacing rather than losing it on the other side.
 */
function insideTheEdge(contours: Contour[], style: Style): Contour[] {
  if (contours.length === 0) return contours;
  const shortfall = style.metrics.sidebearing - contoursBounds(contours).xMin;
  if (shortfall <= 0) return contours;
  const shift = (point: Vec2): Vec2 => ({ x: point.x + shortfall, y: point.y });
  return contours.map((contour) => ({
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
    /*
     * A serif on a stroke that stops on a line lies along that line, whichever
     * way the stroke came in.
     *
     * A bar square to a leaning stroke leans with it, so on a serif face the
     * feet of the A, K, R, V, W, X and Y and the arms of the v, w, x and y all
     * finished forty to seventy units past the line the stroke stopped on --
     * which is the same fault as the one the letters themselves had, arriving
     * by a different route. Turned flat, they sit on the line exactly, and the
     * letter reads as one thing again.
     *
     * The wing is worked out in whatever frame it is drawn in, so all that
     * changes is which way is out and how wide the stroke is measured to be:
     * a band crossing a line at an angle is wider across that line than it is
     * across itself.
     */
    const level = terminal.level === true && Math.abs(outward.y) > 1e-3;
    const facing = level ? { x: 0, y: Math.sign(outward.y) } : outward;
    const inner = level
      ? levelHalfWidth(stroke, outward)
      : penReach(stroke.pen).across;
    // The font's own stem, or this stroke's edge if that is further out, and
    // the projection beyond it. Measured from the stem so that every serif in
    // the face is the same size, and from the stroke where the stroke is the
    // wider of the two, or the wing would begin inside the ink it sits on.
    const tip = Math.max(reference, inner) + projection;
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
      if (crossesALine(at, facing, side, tip, style)) continue;
      /*
       * A face that undulates undulates here too, and the only way to say that
       * is to draw the bar as a stroke rather than as a shape.
       *
       * A serif is a bar across the end of a stroke. Drawn as a wing -- the
       * part that sticks out, with a fillet where it meets the stem -- it is a
       * shape, and a shape has no spine for a wave to run along. So on a face
       * with a wave the bar is swept like anything else, which costs it the
       * bracket and gains it everything the sweep can do. Which is the trade a
       * wavy face wants: the letters it is drawn for have unbracketed serifs,
       * and what they do have is feet that ripple.
       */
      const shape: Contour[] = waving(style)
        ? sweptWing(stroke, style, at, facing, side, inner, tip, thickness)
        : [wing(at, facing, side, inner, tip, thickness, bracket)];
      for (const piece of shape) {
        // Wound with the strokes it sits on, or the serif would cancel the stem
        // it is attached to rather than adding to it.
        out.push(contourArea(piece) < 0 ? reverseContour(piece) : piece);
      }
    }
  }
  return out;
}

/** Whether this wing would reach past a line the stroke end is sitting on. */
function crossesALine(at: Vec2, outward: Vec2, side: number, tip: number, style: Style): boolean {
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
  /*
   * A wing is in the way when it leaves squarely across a line, which is what
   * an arm lying along one does and what an upright standing on one does not.
   *
   * Asked instead as "does it reach past", the foot of every diagonal went as
   * well, because a bar square to a leaning stroke always dips a little below
   * the line the stroke stands on -- and a serif face that has lost the feet
   * of its A, K, V and X has lost more than it gained. Asked as a distance
   * from the line, it depended on how the serif was proportioned against the
   * pen: the arms of an E sat exactly on the boundary and flickered.
   *
   * Which way the wing leaves does not depend on either, so that is what is
   * asked. Eight tenths is a wing within about a third of a right angle to the
   * line, which takes in every arm and no diagonal in the alphabet.
   */
  return lines.some(
    ([line, inward]) =>
      Math.abs(at.y - line) < tip &&
      Math.abs(across.y) > 0.8 &&
      (far - line) * inward < 0,
  );
}

/** Whether this face has a wave for a flat run to follow. */
function waving(style: Style): boolean {
  const { depth, along } = style.parts.wave;
  return depth > 0 && (along === "flat" || along === "both");
}

/**
 * One wing of a serif, swept rather than drawn.
 *
 * The bar runs out along the line from the middle of the stroke it belongs to,
 * lying wholly on the inside so it can never cross the line the stroke is
 * standing on. Its inner end is buried in the stroke, which is why it can be a
 * plain square cut: there is nothing there to see.
 *
 * Both wings of a foot are built travelling the same way, so both take their
 * wave to the same side and the two halves of the foot are mirror images
 * rather than a wave with a step in the middle of it.
 */
function sweptWing(
  stroke: Stroke,
  style: Style,
  at: Vec2,
  outward: Vec2,
  side: number,
  inner: number,
  tip: number,
  thickness: number,
): Contour[] {
  const into = { x: -outward.x, y: -outward.y };
  // Travelling so that the left of the way it goes is the inside of the
  // letter, because that is the side the wave rides on.
  const along = { x: into.y, y: -into.x };
  const middle = { x: at.x + into.x * (thickness / 2), y: at.y + into.y * (thickness / 2) };
  const reach = Math.max(tip, inner + 1);
  const from = side > 0 ? middle : { x: middle.x - along.x * reach, y: middle.y - along.y * reach };
  const to = side > 0 ? { x: middle.x + along.x * reach, y: middle.y + along.y * reach } : middle;
  const { length, depth, along: where } = style.parts.wave;
  const spine = wavy(
    { segments: [{ kind: "line", from, to }], closed: false },
    length,
    depth,
    thickness / 2,
    where,
  );
  return sweep({
    spine,
    pen: { ...stroke.pen, contrast: 0, weight: thickness },
    start: { kind: "butt" },
    end: { kind: "butt" },
  });
}

/**
 * How far a stroke cut level with a line reaches either side of its own end,
 * measured along that line.
 *
 * Not half the pen: a band crossing a line at an angle covers more of the line
 * than it does of itself, and it is the line the serif is being laid along. The
 * two ends of the cut are the stroke's own two edges slid along it until they
 * are level, which is exactly what the sweep draws, so the serif starts where
 * the ink stops rather than a little inside or outside it.
 */
function levelHalfWidth(stroke: Stroke, outward: Vec2): number {
  const shift = reachAlong({ x: -outward.y, y: outward.x }, penReach(stroke.pen));
  return Math.abs(shift.x - (outward.x * shift.y) / outward.y);
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
