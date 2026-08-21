/**
 * Boolean geometry on outlines.
 *
 * Adding shapes together already had a home here, because a font file cannot
 * carry overlapping strokes and the export has to fuse them. Taking shapes
 * away is the same machinery pointed the other way, and it is what the cut
 * layer is made of: a slot through a stem is a rectangle subtracted, a saw
 * tooth is a triangle subtracted, an inline is the letter's own skeleton swept
 * thin and subtracted. One primitive, six operations.
 *
 * Two things about this module are worth knowing before using it.
 *
 * The first is that paper.js arrives asynchronously and the drawing happens
 * synchronously. A letter is drawn during a React render, forty times a second
 * while a slider moves, and there is nowhere in that to await a download. So
 * the library is fetched once, up front, and everything after that is an
 * ordinary function call. `ready()` is the fetch; `loaded()` says whether it
 * has landed. A caller that cuts before it has landed gets the uncut letter
 * rather than a wrong one.
 *
 * The second is winding. Paper decides what is a hole by which way a contour
 * runs, and it measures that in a frame where y points down while font units
 * point up. Rather than reason about the sign, every contour states its role
 * outright -- outer shape or counter -- which is what `classifyContours` is
 * for and is why it is asked on the way in to every operation.
 */

import { contourArea } from "./geometry";
import { classifyContours } from "./outline";
import type { Contour, GlyphNode, Vec2 } from "./types";

type PaperScope = typeof import("paper");

let cached: PaperScope | null = null;
let arriving: Promise<PaperScope> | null = null;

/**
 * Fetch the library, once.
 *
 * Safe to call from anywhere and as often as you like: the second caller waits
 * on the first one's download rather than starting another.
 */
export async function ready(): Promise<void> {
  await loadPaper();
}

/** Whether the boolean operations can be used right now. */
export function loaded(): boolean {
  return cached !== null;
}

/**
 * Load paper and give it a project to work in. The core build is used because
 * it carries no canvas or DOM code, which none of this needs.
 */
export async function loadPaper(): Promise<PaperScope> {
  if (cached) return cached;
  if (arriving) return arriving;
  arriving = (async () => {
    const module = await import("paper/dist/paper-core.js");
    const paper = ((module as { default?: PaperScope }).default ?? module) as PaperScope;
    // Geometry still needs somewhere to live, but never gets drawn.
    paper.setup(new paper.Size(1, 1));
    cached = paper;
    return paper;
  })();
  return arriving;
}

// ---------------------------------------------------------------------------
// The operations
// ---------------------------------------------------------------------------

/**
 * How a contour's role -- solid or counter -- is worked out on the way in.
 *
 * `nesting` counts how many contours enclose this one and calls it a counter
 * if that number is odd. It needs nothing of the caller, which is why the
 * export uses it: an imported font's winding has already been rewritten to
 * suit the output format by the time it gets here, so the contours no longer
 * say what they are and the shape has to be read instead.
 *
 * It is also wrong wherever one solid piece happens to sit inside another. A
 * letter drawn as overlapping pieces does that often -- the foot of a stem
 * sits inside the serif laid across it -- and counted by nesting the foot is
 * enclosed once, so it reads as a hole and is punched out of its own serif.
 *
 * `winding` takes each contour at its word: ink runs one way, counters run the
 * other. The sweep guarantees exactly that, so anything drawn here can say so
 * and be believed, and pieces sitting inside pieces stop being a question.
 */
export type Roles = "nesting" | "winding";

/**
 * Fuse overlapping shapes into one, keeping counters as holes.
 *
 * The first thing any cut needs, though not for the reason it first appears.
 * Taking a shape away distributes over a union -- cut each piece and fuse, or
 * fuse and cut once, and the ink that remains is identical -- so this is not
 * about getting the subtraction right.
 *
 * It is about being able to see the letter at all. A letter here is drawn as
 * overlapping pieces: a serif is a bar laid over a stem, an arch runs into the
 * stroke it springs from. None of those pieces has the letter's own edge, so
 * nothing that has to find one -- where its corners are, where its counters
 * are, whether a cut has just broken it in two -- can be asked of the pieces.
 * Fusing is what turns a heap of strokes into a shape with an outline, and
 * everything after it reads that outline.
 */
export function unite(contours: Contour[], roles: Roles = "nesting"): Contour[] {
  const paper = need();
  const drawable = contours.filter((contour) => contour.nodes.length >= 2);
  if (drawable.length < 2) return contours;

  clear(paper);
  /*
   * A real union, rather than untangling the crossings and re-deciding what is
   * a hole.
   *
   * The second is what the export used to do, and on most letters the two
   * agree. On an E they do not: where the stem and an arm both stop on the
   * baseline, untangling left the outline running out along the arm and back
   * again, tracing a rectangle of no width in between. Filled non-zero that
   * fold is invisible, which is why it survived a long time in the files this
   * has been writing -- but it is not a shape, and a second boolean handed one
   * gives back nothing at all. That is what made the E vanish the first time
   * anything was cut out of it.
   *
   * `fuse` below is that union.
   */
  const fused = fuse(compoundOf(paper, drawable, roles));
  const result = contoursOf(fused);
  clear(paper);
  return result.length > 0 ? result : contours;
}

/**
 * Take the second shape out of the first.
 *
 * `from` is expected to be one fused shape already -- run `unite` on it first.
 * Paper will resolve crossings in the subject itself if asked, but doing it
 * here would mean paying for the fuse again on every one of the six cuts a
 * letter might wear, when the letter only has to be fused once.
 *
 * The tool is fused first, because a tool is often made of pieces that overlap
 * each other on purpose: a comb of teeth cut deeper than its own pitch, a
 * field of slots laid across a letter at an angle.
 */
export function subtract(from: Contour[], tool: Contour[], roles: Roles = "nesting"): Contour[] {
  const paper = need();
  const cutting = tool.filter((contour) => contour.nodes.length >= 3);
  if (cutting.length === 0 || from.length === 0) return from;

  clear(paper);
  const subject = compoundOf(paper, from, roles);
  const knife = fuse(compoundOf(paper, cutting, roles));

  const cut = subject.subtract(knife);
  const result = contoursOf(cut);
  clear(paper);
  // Everything removed is a real answer -- a slot wide enough eats the letter --
  // and the checks are what say so. It is not a failure to be papered over.
  return result;
}

/**
 * Keep only what the two shapes have in common.
 *
 * What a counter motif is made of: the letter's own hole, replaced by a
 * diamond, is the letter with the hole filled in and the diamond taken out --
 * and knowing where the hole was means intersecting the motif with it.
 */
export function intersect(a: Contour[], b: Contour[], roles: Roles = "nesting"): Contour[] {
  const paper = need();
  if (a.length === 0 || b.length === 0) return [];

  clear(paper);
  const one = compoundOf(paper, a, roles);
  const other = fuse(compoundOf(paper, b, roles));
  const both = one.intersect(other);
  const result = contoursOf(both);
  clear(paper);
  return result;
}

/**
 * How many separate pieces a shape falls into.
 *
 * The question the cut layer has to be able to answer about itself. A slot
 * placed across the waist of an `e` is a slot; the same slot two units wider
 * is an `e` in two halves, and nothing about the settings says which of those
 * just happened. Counted off the fused outline: an outer contour is a piece,
 * and a hole is not.
 */
export function pieces(contours: Contour[]): number {
  const drawable = contours.filter((contour) => contour.nodes.length >= 3);
  if (drawable.length === 0) return 0;
  return classifyContours(drawable).filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Talking to paper
// ---------------------------------------------------------------------------

function need(): PaperScope {
  if (!cached) {
    throw new Error("Boolean geometry used before the library arrived. Call ready() first.");
  }
  return cached;
}

/**
 * Every path made by an operation is left in the project, so the project is
 * emptied around each one rather than each item being tracked and removed. A
 * boolean that throws halfway through leaves nothing behind either way.
 */
function clear(paper: PaperScope): void {
  paper.project?.activeLayer?.removeChildren();
}

/**
 * Make a shape consistent with itself: overlapping pieces fused, holes kept.
 *
 * Paper spells this as a union with nothing on the other side. The published
 * types insist on an argument, which is the only reason for the cast.
 *
 * Note that the item handed in is emptied and a new one comes back. Called for
 * its effect and discarded, a tool would arrive at the boolean with no
 * children at all -- so every subtraction would quietly take nothing away, and
 * every intersection would come back empty.
 */
function fuse(item: paper.PathItem): paper.PathItem {
  return (item as unknown as { unite(): paper.PathItem }).unite();
}

function compoundOf(
  paper: PaperScope,
  contours: Contour[],
  roles: Roles = "nesting",
): paper.PathItem {
  const isOuter =
    roles === "winding"
      ? contours.map((contour) => contourArea(contour) >= 0)
      : classifyContours(contours);
  const paths = contours.map((contour, index) => {
    const path = new paper.Path({
      segments: contour.nodes.map((node) => toSegment(paper, node)),
      closed: contour.closed,
    });
    // State the role of each contour in paper's own terms rather than relying
    // on a sign convention, since paper measures winding in a flipped frame.
    path.clockwise = isOuter[index];
    return path;
  });
  return new paper.CompoundPath({ children: paths });
}

function contoursOf(item: paper.PathItem): Contour[] {
  const children = (item as paper.CompoundPath).children as paper.Path[] | undefined;
  const paths = children && children.length > 0 ? children : [item as paper.Path];
  return paths
    .filter((path) => path.segments && path.segments.length >= 2)
    .map(fromPath);
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
