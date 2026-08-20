/**
 * Drawing a letter from its recipe and the style it belongs to.
 *
 * The strokes are swept and the serifs are laid over them. Overlapping pieces
 * are left overlapping: that is how a serif is drawn by hand, it is invisible
 * under the fill rule font renderers use, and the export already fuses
 * everything before writing a file. Fusing here instead would mean doing
 * boolean geometry on every keystroke to gain nothing anyone can see.
 */

import type { Contour, GlyphNode, Vec2 } from "@/font/types";
import { LETTERS, type Recipe } from "./letters";
import { penReach, sweep } from "./sweep";
import type { Style } from "./style";
import type { Stroke, Terminal } from "./types";

export interface Drawn {
  contours: Contour[];
  advanceWidth: number;
}

export function letterNames(): string[] {
  return Object.keys(LETTERS);
}

export function canDraw(name: string): boolean {
  return name in LETTERS;
}

/** Draw one letter. */
export function drawLetter(name: string, style: Style): Drawn | null {
  const recipe = LETTERS[name];
  if (!recipe) return null;
  const built: Recipe = recipe(style);

  const contours: Contour[] = [];
  for (const stroke of built.strokes) {
    contours.push(...sweep(stroke));
    contours.push(...serifsFor(stroke, style));
  }
  return { contours, advanceWidth: built.advanceWidth };
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
  for (const [terminal, at, outward] of ends) {
    if (terminal.kind !== "slab") continue;
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
      out.push(wing(at, outward, side, inner, tip, thickness, bracket));
    }
  }
  return out;
}

/** Both ends of a stroke: the terminal, where it is, and which way it faces. */
function endsOf(stroke: Stroke): Array<[Terminal, Vec2, Vec2]> {
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
    [stroke.start, startPoint, startOut],
    [stroke.end, endPoint, endOut],
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
