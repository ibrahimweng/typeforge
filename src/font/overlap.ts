/**
 * Merging overlapping contours.
 *
 * Drawing a letter as overlapping pieces is normal practice: a cedilla is drawn
 * against the C rather than fitted to it, a serif is a shape laid over a stem.
 * A font file cannot carry that. With the usual non-zero fill an overlap is
 * harmless, but under the even-odd rule some renderers apply, and in print
 * pipelines, the overlapping region drops out and leaves a hole.
 *
 * Boolean geometry on bezier curves is genuinely difficult to get right, so
 * this delegates to paper.js, which is well tested at it. Paper is a few
 * hundred kilobytes and is only needed when a font is written, so it is fetched
 * at that point rather than at start-up.
 */

import { classifyContours } from "./outline";
import type { Contour, GlyphNode, Vec2 } from "./types";

/**
 * Merge overlapping contours in one glyph, keeping counters as holes.
 *
 * Winding has to be right on the way in: paper reads a contour that runs
 * against its surroundings as a hole, and one that runs with them as solid. Run
 * `correctDirection` first.
 */
export async function removeOverlaps(contours: Contour[]): Promise<Contour[]> {
  const drawable = contours.filter((contour) => contour.nodes.length >= 2);
  if (drawable.length < 2) return contours;

  const paper = await loadPaper();
  const isOuter = classifyContours(drawable);

  const paths = drawable.map((contour, index) => {
    const path = new paper.Path({
      segments: contour.nodes.map((node) => toSegment(paper, node)),
      closed: contour.closed,
    });
    // State the role of each contour in paper's own terms rather than relying
    // on a sign convention, since paper measures winding in a flipped frame.
    path.clockwise = isOuter[index];
    return path;
  });

  const compound = new paper.CompoundPath({ children: paths });
  // resolveCrossings exists on every path item at runtime but is missing from
  // paper's published type declarations, so it has to be reached for directly.
  (compound as unknown as { resolveCrossings(): void }).resolveCrossings();
  compound.reorient(true, true);

  const children: paper.Path[] =
    compound.children && compound.children.length > 0
      ? (compound.children as paper.Path[])
      : [compound as unknown as paper.Path];

  const result = children
    .filter((path) => path.segments && path.segments.length >= 2)
    .map(fromPath);

  compound.remove();
  return result.length > 0 ? result : contours;
}

/** A node's handles are absolute here and relative to the point in paper. */
function toSegment(paper: PaperScope, node: GlyphNode): paper.Segment {
  const relative = (handle: Vec2 | null): paper.Point =>
    new paper.Point(
      handle ? handle.x - node.point.x : 0,
      handle ? handle.y - node.point.y : 0,
    );
  return new paper.Segment(
    new paper.Point(node.point.x, node.point.y),
    relative(node.handleIn),
    relative(node.handleOut),
  );
}

function fromPath(path: paper.Path): Contour {
  const nodes: GlyphNode[] = path.segments.map((segment) => {
    const point = { x: segment.point.x, y: segment.point.y };
    const hasIn = segment.handleIn.x !== 0 || segment.handleIn.y !== 0;
    const hasOut = segment.handleOut.x !== 0 || segment.handleOut.y !== 0;
    return {
      point,
      handleIn: hasIn ? { x: point.x + segment.handleIn.x, y: point.y + segment.handleIn.y } : null,
      handleOut: hasOut ? { x: point.x + segment.handleOut.x, y: point.y + segment.handleOut.y } : null,
      type: "corner" as const,
    };
  });
  return { nodes, closed: true };
}

// ---------------------------------------------------------------------------
// Loading paper
// ---------------------------------------------------------------------------

type PaperScope = typeof import("paper");
let cached: PaperScope | null = null;

/**
 * Load paper once and give it a project to work in. The core build is used
 * because it carries no canvas or DOM code, which none of this needs.
 */
async function loadPaper(): Promise<PaperScope> {
  if (cached) return cached;
  const module = await import("paper/dist/paper-core.js");
  const paper = ((module as { default?: PaperScope }).default ?? module) as PaperScope;
  // Geometry still needs somewhere to live, but never gets drawn.
  paper.setup(new paper.Size(1, 1));
  cached = paper;
  return paper;
}
