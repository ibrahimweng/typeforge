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

import {
  centroid,
  contourArea,
  contourContainsPoint,
  contoursBounds,
  flattenContour,
  reverseContour,
} from "./geometry";
import { classifyContours, outersIn, type Roles } from "./outline";
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
 * How a set of contours says which of them are counters.
 *
 * Defined in `outline.ts`, which is where both readings are worked out, and
 * re-exported here because every boolean takes one.
 */
export type { Roles };

/**
 * How hard to work at joining, which is not the same question for everybody.
 *
 * `enough` retries only where the union achieved nothing at all. That is what
 * the export wants: a font file is happy to carry shapes that abut, and all it
 * needs back is a set that does not overlap. Paying more there put two minutes
 * on writing a font.
 *
 * `whole` retries wherever the answer came back in more than one solid, which
 * is what the cut layer wants, because it is about to ask the letter how many
 * pieces it is in and take one of them away. A letter that is really one piece
 * has to come back as one piece, or a break takes off a serif that was never
 * attached and nothing notices.
 */
export type Join = "enough" | "whole";

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
/**
 * Whether a contour goes anywhere between two nodes.
 *
 * Only when the two points are one point and neither handle leaves it. A curve
 * that comes back to where it started is not nothing -- a loop is a shape --
 * so both ends of the question have to be asked.
 */
function goesNowhere(from: GlyphNode, to: GlyphNode): boolean {
  const still = (handle: Vec2 | null, point: Vec2) =>
    handle === null || (Math.abs(handle.x - point.x) < 1e-9 && Math.abs(handle.y - point.y) < 1e-9);
  return (
    Math.abs(to.point.x - from.point.x) < 1e-9 &&
    Math.abs(to.point.y - from.point.y) < 1e-9 &&
    still(from.handleOut, from.point) &&
    still(to.handleIn, to.point)
  );
}

/**
 * The same shapes with the points that are written twice taken out.
 *
 * A point written twice is not part of a shape -- the outline arrives and does
 * not leave -- but it is very much part of what a boolean library makes of one.
 * The drawings here carry such points on purpose: a bowl holds the sides its
 * own shape does not need so that the same shape has the same number of nodes
 * however round it is, a run cut out of one holds the pieces it does not reach,
 * and a corner holds a wedge whether or not it turns. All of that is so two
 * weights can be joined into one variable font, which needs them drawn with the
 * same points.
 *
 * Handed those points, the fuse gives a different answer to the same shape.
 * A Ribbon `six` at the Black is three contours either way, with the same three
 * areas to the unit -- and fused it came back a letter with a hundred and
 * ninety unit hole through the middle of it, because twelve of the twenty-two
 * nodes in its tail were the same node twice. Which is not a rounding
 * disagreement to be tolerated; it is the library being handed something that
 * is not a shape.
 *
 * Applied by `removeOverlaps`, which is the fuse a font is written through, and
 * not inside `unite` itself. Every boolean here would be the tidier place for
 * it and it is the wrong one: the cast layer's shadow builds its shape out of
 * pieces that meet at a point, and settled first it came back with the counter
 * of an `o` closed up at one throw in six. The letters keep their doubled
 * points everywhere else, which is where they are needed.
 */
export function settled(contours: Contour[]): Contour[] {
  return contours.map((contour) => {
    if (contour.nodes.length < 3) return contour;
    const kept: GlyphNode[] = [];
    for (const node of contour.nodes) {
      const last = kept[kept.length - 1];
      // The later node's handle out, so the curve leaving is the one that left.
      if (last && goesNowhere(last, node)) last.handleOut = node.handleOut;
      else kept.push({ ...node });
    }
    // And a closed contour can come back to rest on the node it started from.
    while (contour.closed && kept.length > 2 && goesNowhere(kept[kept.length - 1], kept[0])) {
      kept[0].handleIn = kept[kept.length - 1].handleIn;
      kept.pop();
    }
    return kept.length === contour.nodes.length ? contour : { ...contour, nodes: kept };
  });
}

export function unite(
  contours: Contour[],
  roles: Roles = "nesting",
  join: Join = "enough",
): Contour[] {
  const paper = need();
  const drawable = contours.filter((contour) => contour.nodes.length >= 2);
  /*
   * One shape is already its own union -- but it still has to come back wound
   * the way everything downstream of a fuse is entitled to expect, which is
   * what this function promises and what the short way out used to skip.
   *
   * A lone contour is the outside of the letter, because there is nothing else
   * for it to be inside of. Handed back as it arrived it kept whatever winding
   * the file it came from used, and DejaVu winds the outer contour of H
   * clockwise -- so the counter motif, which finds counters by their winding,
   * read the whole letter as a hole, found no ink to keep, and subtracted the
   * H into nothing. Under `winding` the caller has promised the roles are
   * already right and is left alone.
   */
  if (drawable.length < 2) {
    if (roles === "winding") return contours;
    return contours.map((contour) =>
      contour.nodes.length >= 2 && contourArea(contour) < 0 ? reverseContour(contour) : contour,
    );
  }

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
  /*
   * Nudged a hair apart before anything else, and this is the whole trick.
   *
   * Handed shapes with edges lying exactly along one line, paper decides
   * wrongly, and on a letter that is not a rare case: it is wherever pieces
   * are cut level with the baseline or the cap height, wherever a serif sits
   * flush on a stem, wherever a stem runs down the side of a counter. Exactly
   * one line is a coincidence floating point has to notice and then judge, and
   * a hair of separation means there is no coincidence left to judge.
   *
   * It used to be the retry rather than the rule: fuse, look at the answer,
   * and try again nudged if the answer looked wrong. That is one boolean
   * instead of one boolean and a test, and it is cheaper -- but only if the
   * test can tell. It could not. Judged against the drawing by a rasteriser
   * rather than against its own arithmetic, 175 of the 2,503 drawings the
   * sixteen faces make came out of the fuse covering different ground from the
   * strokes that went in: a Slab thorn missing seven eighths of itself, a
   * Flared p with its bowl filled solid and a bite out of the stem, a Brush d
   * fused to a single blob, a Typewriter b with its counter closed over.
   * Every one had ink in a believable range and a believable number of pieces,
   * so no test made of ink and piece counts was ever going to catch them --
   * and every one of them is right when the shapes are nudged apart. Nudging
   * first leaves seven, and the worst of those is off by one per cent.
   *
   * Only where the shapes really meet. A letter genuinely in pieces -- the dot
   * and the stem of an i -- has no coincidence to break and may as well keep
   * its coordinates exactly.
   */
  const apart = touching(drawable) ? nudgeApart(drawable, outersIn(drawable, roles)) : drawable;
  const fused = fuse(compoundOf(paper, apart, roles));
  const result = withoutStrayHoles(contoursOf(fused));
  clear(paper);

  /*
   * The union can still give up, and there are four ways it does it.
   *
   * It comes back with nothing at all. It comes back with as many shapes as it
   * was given and none of them joined -- which is not a failure to overlap:
   * the bottom arm of a Flared E overlaps its stem by most of its own area,
   * and unjoined is what left that E as twelve separate solids and a Serif H
   * as nine. The letter looks right either way, since abutting shapes leave no
   * seam under a non-zero fill, so it went unnoticed until a cut took one of
   * the pieces away and the rest turned out never to have been attached.
   *
   * The third is the quietest: it comes back holding almost nothing. The w of
   * a Brush face -- two vees overlapping by a quarter of an arm, each with its
   * flares -- fused to a single contour of exactly zero area, and the letter
   * was simply not there: blank on the page, blank in the file, and not even
   * reported broken, because one contour of nothing counts as one piece to
   * anything counting pieces.
   *
   * Judged against the least a union can honestly come to, which is arithmetic
   * rather than a threshold: it must cover the biggest solid it was handed,
   * and the only thing that can be taken out of that is a counter, so it must
   * come to at least the biggest solid less every hole. Both halves matter --
   * an o fuses to a good deal less than its outer circle, and that is its own
   * counter doing it.
   *
   * This was a share of the total ink handed in, and a share cannot be made to
   * work for both of the things that come through here. Strokes of a letter
   * overlap a little, so the total is close to the answer; the bands a shadow
   * is built from overlap enormously, so the total is several times it, and a
   * perfectly good shadow of an o was being called a failure and thrown away
   * for a worse one -- which is what filled the counter of every round letter
   * that had a shadow thrown by it.
   *
   * And the fourth is the one that looks like success. A union cannot hold
   * more ink than it was handed, which is arithmetic rather than a threshold:
   * the shapes going in are counted one by one, so wherever two of them
   * overlap the same ground is counted twice, and joining them counts it once.
   * Same or smaller, always -- unless a counter has been read as solid on the
   * way through, in which case its area changes sign and the total goes up.
   * A hundredth of a per cent of slack, for the rounding a boolean does.
   */
  const handed = Math.abs(inkIn(drawable));
  const roomFor = outersIn(drawable, roles);
  const biggest = Math.max(
    0,
    ...drawable.map((contour, index) => (roomFor[index] ? Math.abs(contourArea(contour)) : 0)),
  );
  const holes = drawable.reduce(
    (total, contour, index) => total + (roomFor[index] ? 0 : Math.abs(contourArea(contour))),
    0,
  );
  const least = Math.max(0, biggest - holes);
  const swollen = (answer: Contour[]): boolean =>
    handed > 0 && Math.abs(inkIn(answer)) > handed * 1.0001;
  const gaveUp = (answer: Contour[]): boolean =>
    answer.length === 0 ||
    (least > 0 && Math.abs(inkIn(answer)) < least * 0.999) ||
    swollen(answer) ||
    (join === "whole"
      ? solidsIn(answer) > 1 || !stillDraws(answer, drawable, roles)
      : answer.length >= drawable.length);

  if (!gaveUp(result) || drawable === apart) return result.length > 0 ? result : contours;

  // Nudged and still wrong, so try it on the coordinates as they arrived. The
  // nudge fixes far more than it breaks, but it is a change to the shapes and
  // there is no reason to insist on it when it has not helped.
  const plain = withoutStrayHoles(contoursOf(fuse(compoundOf(paper, drawable, roles))));
  clear(paper);
  // Judged by the same test that called the first answer a failure, rather
  // than by a fresh rule invented for the comparison. A rule of its own has to
  // decide what beats what -- more ink, or fewer solids? -- and the first
  // version of it traded a Flared p in one piece for one in three, because the
  // three-piece answer happened to hold a little more ink.
  if (!gaveUp(plain)) return plain;
  if (plain.length === 0) return result.length > 0 ? result : contours;
  /*
   * Both gave up, so keep whichever failed less badly, and the order of the
   * questions is the order of how much they matter.
   *
   * Whether it still draws what it was given comes first, because that is the
   * only one of these that is about the shape rather than about a number: an o
   * thrown two stems at a hundred and fifty degrees came back from both
   * attempts with something wrong, and only one of the two had its counter.
   *
   * Then whether it stayed inside the ink it was handed, because a counter
   * filled in makes the ink go up. Then more ink, which is the right answer
   * when the failure is a shape that came back as a crumb -- and which, asked
   * first, hands back the filled counter every time, since filled is bigger.
   */
  if (join === "whole") {
    const drawsResult = stillDraws(result, drawable, roles);
    const drawsPlain = stillDraws(plain, drawable, roles);
    if (drawsResult !== drawsPlain) return drawsResult ? result : plain;
  }
  if (swollen(result) !== swollen(plain)) return swollen(result) ? plain : result;
  if (Math.abs(inkIn(plain)) > Math.abs(inkIn(result))) return plain;
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
  /*
   * The tool is fused only when its own pieces touch.
   *
   * They often do, on purpose: a comb of teeth cut deeper than its own pitch,
   * a field of slots laid across a letter at an angle, four cuts made into one
   * knife. Just as often they do not -- and a fuse is another whole boolean,
   * which on a face with everything switched on is one more than the cut
   * itself. Whether any two pieces of the tool overlap at all is a question
   * about rectangles, and answering it costs nothing.
   */
  const raw = compoundOf(paper, cutting, roles);
  const knife = touching(cutting) ? fuse(raw) : raw;

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
  const drawable = contours
    .filter((contour) => contour.nodes.length >= 3)
    .filter((contour) => !aSliver(contour));
  if (drawable.length === 0) return 0;
  return classifyContours(drawable).filter(Boolean).length;
}

/**
 * Whether a contour is too thin to be a piece of anything.
 *
 * A boolean leaves crumbs. Where two edges lie along the same line the answer
 * comes back with a hair-width loop in it -- a Didone W fused to itself and a
 * contour of thirteen square units fell out, a Brush b managed one -- and
 * counted as a piece those are a letter reported broken that is not, which is
 * a warning that cries wolf on a font nobody has cut yet.
 *
 * Measured as thickness rather than as area, because area alone cannot tell a
 * crumb from a small letter: a full stop is small and solid, and a hair along
 * the side of a stem is not small at all. Area over perimeter is what a shape
 * has room for inside itself, and it separates the two by a hundredfold --
 * a tenth of a unit for the crumbs above against twelve for the dot of an i.
 * Half a unit is a twentieth of the width of the thinnest hairline anyone
 * draws, so nothing anybody meant to draw is thrown away here.
 */
function aSliver(contour: Contour): boolean {
  const walk = flattenContour(contour, 8);
  let edge = 0;
  for (let index = 0; index < walk.length; index++) {
    const from = walk[index];
    const to = walk[(index + 1) % walk.length];
    edge += Math.hypot(to.x - from.x, to.y - from.y);
  }
  if (edge <= 0) return true;
  return Math.abs(contourArea(contour)) / edge < 0.5;
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

/**
 * The same shapes, each grown outward by a different hair's breadth.
 *
 * Grown rather than moved, and that is the whole of it.
 *
 * What this has to break is the exact equality between one shape's edge and
 * another's. Sliding each shape a different hair does break it -- but it also
 * pulls apart shapes that were only ever touching, and a letter can be built
 * entirely out of those: a glyph laid out on a grid is a heap of cells sharing
 * their edges and overlapping nowhere, and slid apart it fused into six pieces
 * instead of one. Growing cannot do that. Two shapes that met still meet, and
 * now they overlap by a hair instead of agreeing exactly on where they meet.
 *
 * Counters shrink instead, by the same reasoning pointed the other way: what
 * grows is the ink, and the ink is on the other side of a counter.
 *
 * Each node moves away from its own shape's middle, handles carried with it so
 * the curve between two nodes keeps its shape. That is not a true offset --
 * a node further from the middle moves the same distance as a near one, where
 * a real offset would move each edge by its own normal -- and it does not need
 * to be. A hair is not a size, it is a way of not being in exactly the same
 * place.
 *
 * Spread by the golden ratio rather than by a multiple of the index, so every
 * shape grows by a different amount however many there are, all of them inside
 * one step, and the same amounts every time -- a letter has to be drawn the
 * same way twice.
 *
 * A ten-thousandth of a unit, which at the usual em is a ten-millionth of it.
 * Outlines are rounded to integers on the way out, so it rounds to nothing in
 * a file, and on a screen it is orders of magnitude under a pixel. It was a
 * hundredth when this was a last resort rather than the rule, and shrinking it
 * costs nothing: breaking an exact equality does not need room, only more room
 * than the arithmetic's own idea of the same place, and a ten-thousandth is a
 * thousand times paper's. What it buys is that the growth stops being visible
 * to anything measuring -- the cut layer asks where a motif landed to within a
 * thousandth of a unit, and it still lands there.
 */
const NUDGE = 0.0001;

function nudgeApart(contours: Contour[], isOuter: boolean[]): Contour[] {
  return contours.map((contour, index) => {
    const step = (index * 0.6180339887498949) % 1;
    const grow = (0.5 + step) * NUDGE * (isOuter[index] ? 1 : -1);
    const middle = centroid(contour);
    return {
      ...contour,
      nodes: contour.nodes.map((node) => {
        const away = { x: node.point.x - middle.x, y: node.point.y - middle.y };
        const span = Math.hypot(away.x, away.y);
        // A node sitting on its own middle has no outward to go, which happens
        // on a shape of no area and nowhere else. Left where it is.
        if (!(span > 0)) return node;
        const dx = (away.x / span) * grow;
        const dy = (away.y / span) * grow;
        const move = (point: Vec2 | null): Vec2 | null =>
          point === null ? null : { x: point.x + dx, y: point.y + dy };
        return {
          ...node,
          point: { x: node.point.x + dx, y: node.point.y + dy },
          handleIn: move(node.handleIn),
          handleOut: move(node.handleOut),
        };
      }),
    };
  });
}

/**
 * A union's answer without the holes that are inside nothing.
 *
 * A hole is a hole in something. One that encloses no ink and sits inside no
 * shape is not a counter and not a piece -- it is what the boolean left behind
 * where two edges nearly met, and paper leaves a few: a thin lens above the
 * bowl of a Brush b, a pair of chips where the flares of a Flared b run into
 * the stem. Small enough to see nothing on the page, and counted as pieces by
 * anything that reads the answer by nesting rather than by winding, which is
 * how three faces reported a b broken in two that draws perfectly.
 *
 * Only the fuse's own output is judged this way, where the winding is the
 * union's and is meant to say outer or counter outright. A contour arriving
 * from a file says no such thing and is never handed here.
 */
function withoutStrayHoles(contours: Contour[]): Contour[] {
  const solids = contours.filter((contour) => contourArea(contour) > 0);
  if (solids.length === 0) return contours;
  return contours.filter((contour) => {
    if (contourArea(contour) >= 0) return true;
    /*
     * All of a real counter lies inside the shape it is a counter of, and both
     * halves of that are needed to say so.
     *
     * Its points have to be inside, which one point cannot establish: the lens
     * over the bowl of a Brush b has a point in the letter and a point out of
     * it. And its box has to be inside, which the points cannot establish
     * either: the chip under the bowl of a Flared b is three points all lying
     * on the baseline with the curve between them bulging twenty units below
     * the letter, so every point of it is inside a shape it is mostly outside.
     *
     * The box test never turns away a real counter, because a shape inside
     * another shape has its box inside that shape's box as well.
     */
    const box = contoursBounds([contour]);
    return solids.some((solid) => {
      const around = contoursBounds([solid]);
      return (
        box.xMin >= around.xMin &&
        box.xMax <= around.xMax &&
        box.yMin >= around.yMin &&
        box.yMax <= around.yMax &&
        contour.nodes.every((node) => contourContainsPoint(solid, node.point))
      );
    });
  });
}

/**
 * A few points spread through a shape, for asking whether it is still there.
 *
 * Not one point, and not the centroid: the centroid of a C is outside the C,
 * and one point anywhere is one point that can land in the single place the
 * union happened to get right. Scanlines across the shape and the middle of
 * each span, which puts every sample well inside and spreads them over the
 * whole of it.
 */
function pointsInside(contour: Contour, want: number): Vec2[] {
  const polygon = flattenContour(contour, 8);
  if (polygon.length < 3) return [];
  const box = contoursBounds([contour]);
  const height = box.yMax - box.yMin;
  if (!(height > 0)) return [];
  const found: Vec2[] = [];
  const lines = want * 2;
  for (let step = 1; step < lines && found.length < want; step++) {
    const y = box.yMin + (height * step) / lines;
    const crossings: number[] = [];
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i];
      const b = polygon[j];
      if (a.y > y !== b.y > y) crossings.push(((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x);
    }
    crossings.sort((one, other) => one - other);
    for (let i = 0; i + 1 < crossings.length && found.length < want; i += 2) {
      if (crossings[i + 1] - crossings[i] > 1e-6) {
        found.push({ x: (crossings[i] + crossings[i + 1]) / 2, y });
      }
    }
  }
  return found;
}

/** Whether a point is in the ink, by winding, with the roles as stated. */
function inTheInk(contours: Contour[], isOuter: boolean[], point: Vec2): boolean {
  let winding = 0;
  for (let index = 0; index < contours.length; index++) {
    if (contours[index].nodes.length < 3) continue;
    if (contourContainsPoint(contours[index], point)) winding += isOuter[index] ? 1 : -1;
  }
  return winding > 0;
}

/**
 * Whether the answer still draws what the union was handed.
 *
 * The one thing a union promises: it covers the same ground. Shapes may be
 * swallowed, joined, absorbed into one outline -- but a point that was in the
 * ink has to still be in the ink, and a point that was in a counter has to
 * still be in a counter.
 *
 * Asked only where the caller said `whole`, which is the shaping layers rather
 * than the letter being drawn: it costs a point-in-polygon for every sample
 * against every contour of the answer, which is nothing beside a boolean but
 * is not nothing beside forty letters a frame. The layers are where it is
 * needed, because they hand the union sets no test made of ink and piece
 * counts can judge -- a shadow is thirty bands, every one overlapping most of
 * the others, and a counter filled in among those changes the total by less
 * than the overlaps do.
 *
 * Sampled rather than proved. Proving it means another boolean, and the
 * failures are whole counters: an o thrown a stem and a half straight up came
 * back solid while the same o thrown at eighty-nine degrees and at ninety-one
 * came back right.
 */
function stillDraws(answer: Contour[], given: Contour[], roles: Roles): boolean {
  if (answer.length === 0) return false;
  const isOuter = outersIn(given, roles);
  // The answer comes out of a fuse, which states roles by winding outright.
  const answerRoles = answer.map((contour) => contourArea(contour) >= 0);
  return given.every((contour) => {
    if (contour.nodes.length < 3) return true;
    const samples = pointsInside(contour, 5);
    if (samples.length === 0) return true;
    // One stray sample is allowed: a point can land within a rounding of an
    // edge, and a counter that is really gone disagrees on all five.
    const wrong = samples.filter(
      (point) => inTheInk(answer, answerRoles, point) !== inTheInk(given, isOuter, point),
    ).length;
    return wrong <= 1;
  });
}

/** What these contours add up to, a hole counting against the ink it is in. */
function inkIn(contours: Contour[]): number {
  return contours.reduce((total, contour) => total + contourArea(contour), 0);
}

/**
 * How many separate solids these contours make, counters not counted.
 *
 * The difference matters twice over, and getting it wrong costs in both
 * directions. A union that comes back as an outline and a counter has not
 * failed -- that is what an O looks like -- and reading two contours as two
 * pieces sent every letter with a hole in it down the slow path, which put two
 * minutes on exporting a slabbed font. The same distinction decides whether a
 * shape has just joined what came before or is standing on its own.
 */
function solidsIn(contours: Contour[]): number {
  return contours.filter((contour) => contourArea(contour) >= 0).length;
}

/**
 * Whether any two of these shapes' boxes overlap.
 *
 * A box test rather than a real one: it is allowed to say yes when the answer
 * is no, because the only cost of that is fusing something that did not need
 * it. Saying no when the answer is yes would be a wrong drawing, and boxes
 * never do that.
 */
function touching(contours: Contour[]): boolean {
  if (contours.length < 2) return false;
  const boxes = contours.map((contour) => contoursBounds([contour]));
  for (let one = 0; one < boxes.length; one++) {
    for (let other = one + 1; other < boxes.length; other++) {
      const a = boxes[one];
      const b = boxes[other];
      if (a.xMin < b.xMax && b.xMin < a.xMax && a.yMin < b.yMax && b.yMin < a.yMax) return true;
    }
  }
  return false;
}

function compoundOf(
  paper: PaperScope,
  contours: Contour[],
  roles: Roles = "nesting",
): paper.PathItem {
  const isOuter = outersIn(contours, roles);
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

/**
 * The smallest area a boolean's answer can hold and still be a shape.
 *
 * A hundredth of a square unit is a tenth of a unit each way, which at the
 * usual em is a ten-thousandth of it -- below what a font file can hold, since
 * outlines are rounded to integers on the way out, and below what the cut
 * layer works at, since the smallest motif is still units across.
 */
const SPECK = 0.01;

function contoursOf(item: paper.PathItem): Contour[] {
  const children = (item as paper.CompoundPath).children as paper.Path[] | undefined;
  const paths = children && children.length > 0 ? children : [item as paper.Path];
  return paths
    .filter((path) => path.segments && path.segments.length >= 2)
    .map(fromPath)
    /*
     * Without the specks paper leaves behind.
     *
     * A boolean can answer with a contour of two nodes in the same place,
     * enclosing exactly nothing -- the residue of an edge that used to lie
     * along another edge. It draws nothing, so it never showed; but anything
     * counting the pieces of a letter counts it, and a Flared p that fuses
     * perfectly was reported broken in two on the strength of one such speck
     * sitting at the bottom left corner of its stem.
     *
     * By area rather than by node count, because two nodes with handles on
     * them can enclose a real lens and four nodes in a line enclose nothing.
     */
    .filter((contour) => Math.abs(contourArea(contour)) >= SPECK);
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
