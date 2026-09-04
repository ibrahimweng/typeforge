/**
 * Shapes shared between letters.
 *
 * The parameters carry a control letter's *qualities* across the font: how
 * heavy the stem is, how tall the x-height, how open the counter. They cannot
 * carry the shape. Reshaping the arch of an n says nothing about the arch of an
 * h, and h is one of the letters n is supposed to be speaking for.
 *
 * Measuring a real font settled how this had to work. In DejaVu Sans, h really
 * is n: fourteen of n's sixteen points appear in h at identical coordinates,
 * and the two that differ are the top of the left stem, raised to the ascender.
 * So the arch of h is not merely similar to n's, it is the same points, and
 * moving one should move the other.
 *
 * Two approaches were tried and dropped before this one. Cutting the arch out
 * as a region and grafting it in fails because an arch has no horizontal band
 * of its own -- its legs merge into the stems continuously, so any box that
 * contains the whole arch also contains parts of both stems. Matching whole
 * contours between letters fails because they differ: h's outline is longer
 * than n's, and b's bowl is 13 units narrower than o's.
 *
 * Matching individual points works, and has a property the others lack: it
 * links only what is genuinely shared. n's arch points are linked into h, and
 * n's stem-top points are not, so reshaping the arch reshapes h while raising
 * the stem leaves h's ascender alone. Nothing has to know which letters have
 * an arch or where it starts.
 */

import type { Glyph, Typeface, Vec2 } from "./types";

/** One point in one glyph. */
export interface NodeAddress {
  glyph: string;
  contour: number;
  node: number;
}

/**
 * Every point that follows a given point of a control letter.
 *
 * Keyed by `contour:node` within the control glyph.
 */
export type LinkMap = Map<string, NodeAddress[]>;

export const linkKey = (contour: number, node: number): string => `${contour}:${node}`;

/**
 * How far apart two points can sit and still count as the same point.
 *
 * Font coordinates are integers, so shared points land exactly on each other.
 * One unit of slack absorbs a rounding difference without ever pulling in a
 * neighbouring point, which is tens of units away in any real design.
 */
const SAME_POINT = 1;

function samePoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) <= SAME_POINT && Math.abs(a.y - b.y) <= SAME_POINT;
}

/**
 * Find the points of `target` that sit exactly where points of `source` sit.
 *
 * Position alone decides it. Two letters that share a shape share its
 * coordinates, and two that merely look similar do not -- which is the
 * distinction worth drawing, since imposing one letter's curve on another that
 * was drawn separately would change a design rather than propagate one.
 */
export function findSharedPoints(
  source: Glyph,
  target: Glyph,
): Array<{ sourceKey: string; contour: number; node: number }> {
  const shared: Array<{ sourceKey: string; contour: number; node: number }> = [];
  const claimed = new Set<string>();

  source.contours.forEach((sourceContour, sourceIndex) => {
    sourceContour.nodes.forEach((sourceNode, sourceNodeIndex) => {
      for (let contour = 0; contour < target.contours.length; contour++) {
        const nodes = target.contours[contour].nodes;
        for (let node = 0; node < nodes.length; node++) {
          const address = linkKey(contour, node);
          if (claimed.has(address)) continue;
          if (!samePoint(sourceNode.point, nodes[node].point)) continue;
          claimed.add(address);
          shared.push({ sourceKey: linkKey(sourceIndex, sourceNodeIndex), contour, node });
          return;
        }
      }
    });
  });

  return shared;
}

/**
 * How much of a control letter a glyph has to share before it counts as being
 * that letter.
 *
 * Measured rather than picked. Across DejaVu the sharing is sharply split: the
 * glyphs that are really an n -- h, eng, eta and a dozen others -- carry 14 of
 * its 16 points, while b, p and k carry two or three, which are the feet of a
 * stem that happens to stand in the same place. There is almost nothing in
 * between.
 *
 * Linking only the letters above the gap keeps the two mechanisms from
 * colliding. A glyph that follows the shape exactly is held at neutral
 * parameters, so it takes the edit once; a glyph that merely shares two feet
 * is left to the parameters, which is the right description of a letter that
 * was drawn separately.
 */
const SUBSTANTIAL_SHARE = 0.5;

/**
 * Work out, for one control letter, which points elsewhere follow it.
 *
 * Composites are skipped: a glyph built from components already follows the
 * letters it is made of, and linking its resolved points as well would move it
 * twice.
 */
export function buildLinks(typeface: Typeface, controlName: string): LinkMap {
  const links: LinkMap = new Map();
  const index = typeface.glyphIndex.get(controlName);
  if (index === undefined) return links;
  const control = typeface.glyphs[index];
  if (control.contours.length === 0) return links;

  const controlPoints = control.contours.reduce((total, c) => total + c.nodes.length, 0);
  if (controlPoints === 0) return links;

  for (const glyph of typeface.glyphs) {
    if (glyph.name === controlName) continue;
    if (glyph.contours.length === 0) continue;
    if (glyph.components.length > 0) continue;

    const matches = findSharedPoints(control, glyph);
    if (matches.length / controlPoints < SUBSTANTIAL_SHARE) continue;

    for (const match of matches) {
      const existing = links.get(match.sourceKey);
      const address: NodeAddress = {
        glyph: glyph.name,
        contour: match.contour,
        node: match.node,
      };
      if (existing) existing.push(address);
      else links.set(match.sourceKey, [address]);
    }
  }

  return links;
}

/** A point of the control letter that moved, and by how far. */
export interface PointMove {
  key: string;
  dx: number;
  dy: number;
}

/** Compare a control letter before and after an edit. */
export function pointsThatMoved(before: Glyph, after: Glyph): PointMove[] {
  const moves: PointMove[] = [];
  after.contours.forEach((contour, contourIndex) => {
    const previous = before.contours[contourIndex];
    if (!previous) return;
    contour.nodes.forEach((node, nodeIndex) => {
      const was = previous.nodes[nodeIndex];
      if (!was) return;
      const dx = node.point.x - was.point.x;
      const dy = node.point.y - was.point.y;
      if (dx === 0 && dy === 0) return;
      moves.push({ key: linkKey(contourIndex, nodeIndex), dx, dy });
    });
  });
  return moves;
}

/**
 * Move every point that follows the ones the designer just moved.
 *
 * A point's handles travel with it, so a curve keeps its shape rather than
 * being dragged out of it.
 *
 * Returns the names of the glyphs that changed.
 */
export function propagateMoves(typeface: Typeface, links: LinkMap, moves: PointMove[]): string[] {
  const touched = new Set<string>();

  for (const move of moves) {
    const followers = links.get(move.key);
    if (!followers) continue;
    for (const address of followers) {
      const index = typeface.glyphIndex.get(address.glyph);
      if (index === undefined) continue;
      const node = typeface.glyphs[index].contours[address.contour]?.nodes[address.node];
      if (!node) continue;

      node.point = { x: node.point.x + move.dx, y: node.point.y + move.dy };
      if (node.handleIn) {
        node.handleIn = { x: node.handleIn.x + move.dx, y: node.handleIn.y + move.dy };
      }
      if (node.handleOut) {
        node.handleOut = { x: node.handleOut.x + move.dx, y: node.handleOut.y + move.dy };
      }
      touched.add(address.glyph);
    }
  }

  return [...touched];
}

/** How many points of a control letter are shared, and with how many glyphs. */
export interface LinkSummary {
  points: number;
  glyphs: string[];
}

export function summariseLinks(links: LinkMap): LinkSummary {
  const glyphs = new Set<string>();
  for (const followers of links.values()) {
    for (const address of followers) glyphs.add(address.glyph);
  }
  return { points: links.size, glyphs: [...glyphs].sort() };
}
