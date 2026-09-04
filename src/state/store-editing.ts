/**
 * Editing a letter: the outlines, the points, the pen, the parameters.
 *
 * The largest part of the store by a long way, and the reason is that the
 * geometry is not here. Every method in this file is coordination -- take a
 * snapshot, apply a change that `@/font` works out, record the undo step, mark
 * the document changed. The shapes themselves are made in `@/font`.
 */

import { reverse as reverseContour } from "@/font/outline";
import { NEARLY_STRAIGHT, offSmooth } from "@/font/marks";
import { retracted, simplified, withPointOn, withoutPoint } from "@/font/pen";
import { deriveParams, isControlGlyph, readControls, type ControlChange } from "@/font/control";
import { buildLinks, pointsThatMoved, propagateMoves } from "@/font/link";
import { cloneGlyph } from "@/font/types";
import { effectiveParams } from "@/font/transform";
import { noCuts, NO_CUTS, sameCut, type CutName, type Cuts } from "@/font/cuts";
import { noCast, NO_CAST, sameCast, type Cast, type CastName } from "@/font/cast";
import {
  DEFAULT_PARAMS,
  type Glyph,
  type Contour,
  type GlyphParams,
  type Vec2,
} from "@/font/types";
import { correctDirection, dominantConvention, insertExtrema } from "@/font/outline";
import { followPens, inkOf, penAtNodes, type SavedPen } from "@/quill/written";
import type { QuillSegment, QuillStroke } from "@/quill/types";
import { strokeToContour } from "@/font/freehand";
import { isClockwise, reverseContour as flipContour } from "@/font/geometry";
import { slice } from "@/font/knife";
import { shapeFrom, type Box, type ShapeKind } from "@/font/shapes";
import {
  cornered,
  isOnGrid,
  openCorner,
  reconnect,
  rounded,
  smoothed,
  tidy,
  tidyWouldRemove,
} from "@/font/nodes";
import {
  alignedTo,
  boundsOfPoints,
  transformContours,
  transformNode,
  type Affine,
  type Edge,
} from "@/font/reshape";
import type { Bounds } from "@/font/geometry";
import { removeOverlaps } from "@/font/overlap";
import { ready as readyToCut, subtract, unite } from "@/font/boolean";

import type { NodeRef } from "./model";
import { nodeKey } from "./model";
import { NavigationStore } from "./store-navigation";

/**
 * The two edits that may touch an expanded letter's outlines and still leave
 * the way back to its strokes.
 *
 * Everything else that changes those contours is a person editing the ink,
 * which is the point of expanding, and which means the strokes no longer
 * describe the letter. These two are the expand and un-expand themselves.
 */
const KEEPS_STROKES = new Set(["Take the ink", "Back to strokes"]);

export abstract class EditingStore extends NavigationStore {
  /**
   * Apply an edit to one glyph, recording enough to undo it.
   *
   * The glyph is cloned before and after, so history holds two copies of one
   * glyph rather than of the whole font.
   */
  /**
   * Turn one contour inside out.
   *
   * Direction is not decoration: it decides whether a contour fills or cuts a
   * hole in the one around it. A counter drawn the same way round as its bowl
   * fills solid, and the only way to see that was to export the font and look.
   * Offering it as an operation is what makes it a thing somebody can fix.
   */
  /**
   * Move what is drawn: mirror, scale, rotate, slant.
   *
   * The transform is asked for rather than passed in, because every one of
   * them needs to know what it is happening about and only this knows what is
   * selected. The caller says "turn it thirty degrees"; this works out that
   * thirty degrees means thirty degrees about the middle of the four points
   * somebody has picked, and not about the origin or the middle of the letter.
   *
   * Nothing selected means the whole letter, which is what every drawing tool
   * does and what somebody who has just opened a glyph and pressed mirror
   * expects.
   */
  reshapeGlyph(
    glyphName: string,
    label: string,
    make: (centre: Vec2, bounds: Bounds) => Affine,
  ): void {
    const glyph = this.glyph(glyphName);
    if (!glyph || glyph.contours.length === 0) return;

    const picked = this.state.selectedNodes;
    const whole = picked.size === 0;

    /*
     * What the transform happens about: the selection if there is one, the
     * letter if there is not.
     */
    const inHand: Contour[] = whole
      ? glyph.contours
      : glyph.contours.map((contour, index) => ({
          ...contour,
          nodes: contour.nodes.filter((_, node) => picked.has(nodeKey({ contour: index, node }))),
        }));
    const bounds = boundsOfPoints(inHand);
    const centre = { x: (bounds.xMin + bounds.xMax) / 2, y: (bounds.yMin + bounds.yMax) / 2 };
    const transform = make(centre, bounds);

    this.editGlyph(glyphName, label, (one) => {
      if (whole) {
        /*
         * The whole letter goes through `transformContours`, which puts the
         * winding back after a flip. A mirror reverses every contour, and
         * winding is what decides whether a contour fills or cuts a hole, so
         * a flipped letter left alone comes back with its counters solid.
         */
        one.contours = transformContours(one.contours, transform);
        return;
      }
      /*
       * A partial selection does not get that treatment, and must not. Turning
       * a contour round is a statement about the whole contour; a few of its
       * points having been mirrored does not make it a mirrored contour, and
       * reversing it would scramble the order of points nobody touched.
       */
      one.contours = one.contours.map((contour, index) => ({
        ...contour,
        nodes: contour.nodes.map((node, at) =>
          picked.has(nodeKey({ contour: index, node: at })) ? transformNode(node, transform) : node,
        ),
      }));
    });
  }

  /**
   * Line the selected points up with each other.
   *
   * Not a transform, because it is not one movement applied to everything: each
   * point goes to the edge of what is selected, so three points aligned left
   * all land on the leftmost of the three. That is what makes it the operation
   * for levelling the two feet of an `n` against each other.
   */
  alignSelection(glyphName: string, edge: Edge): void {
    const glyph = this.glyph(glyphName);
    const picked = this.state.selectedNodes;
    if (!glyph || picked.size < 2) return;

    const inHand: Contour[] = glyph.contours.map((contour, index) => ({
      ...contour,
      nodes: contour.nodes.filter((_, node) => picked.has(nodeKey({ contour: index, node }))),
    }));
    // Off the points alone, not their handles: aligning is about where the
    // outline passes, and a handle sticking out to one side is not a place the
    // outline goes.
    let xMin = Infinity;
    let yMin = Infinity;
    let xMax = -Infinity;
    let yMax = -Infinity;
    for (const contour of inHand) {
      for (const node of contour.nodes) {
        xMin = Math.min(xMin, node.point.x);
        yMin = Math.min(yMin, node.point.y);
        xMax = Math.max(xMax, node.point.x);
        yMax = Math.max(yMax, node.point.y);
      }
    }
    if (!Number.isFinite(xMin)) return;
    const move = alignedTo(edge, { xMin, yMin, xMax, yMax });

    this.editGlyph(glyphName, "Align points", (one) => {
      one.contours = one.contours.map((contour, index) => ({
        ...contour,
        nodes: contour.nodes.map((node, at) => {
          if (!picked.has(nodeKey({ contour: index, node: at }))) return node;
          const to = move(node.point);
          // The handles come along by the same step, so a curve keeps its
          // shape and only its end moves.
          const by = { x: to.x - node.point.x, y: to.y - node.point.y };
          return {
            ...node,
            point: to,
            handleIn: node.handleIn
              ? { x: node.handleIn.x + by.x, y: node.handleIn.y + by.y }
              : null,
            handleOut: node.handleOut
              ? { x: node.handleOut.x + by.x, y: node.handleOut.y + by.y }
              : null,
          };
        }),
      }));
    });
  }

  /*
   * The tools that make and unmake whole shapes.
   *
   * A rectangle and an ellipse because type is full of both -- a stem is a
   * rectangle, a bar is a rectangle, the dot on an `i` is a circle -- and a
   * knife because dividing a shape is the operation no boolean can express:
   * taking the top off a stem, splitting a bowl from the stem it hangs on.
   */

  /**
   * Put a freehand stroke into the letter.
   *
   * Wound the way the font is wound, for the same reason a dragged shape is: a
   * stroke drawn anticlockwise into a clockwise font would cut a hole through
   * whatever it was drawn over. Which way a hand happened to go round a bowl
   * is not a decision about filling.
   */
  addStroke(glyphName: string, trail: Vec2[]): boolean {
    const typeface = this.state.typeface;
    if (!typeface) return false;
    const drawn = strokeToContour(trail);
    if (!drawn) return false;

    const clockwise = dominantConvention(typeface.glyphs) === "truetype";
    const contour = drawn.closed && isClockwise(drawn) !== clockwise ? flipContour(drawn) : drawn;

    this.editGlyph(glyphName, "Draw freehand", (one) => {
      one.contours = [...one.contours, contour];
    });
    return true;
  }

  /**
   * Drop a dragged shape into the letter, wound the way the font is wound.
   *
   * The convention is read off the font rather than imposed, exactly as
   * correcting a direction reads it. Which way a contour runs decides whether
   * it fills or cuts a hole, so a rectangle added to a UFO with a TrueType
   * winding is a rectangle that punches a hole in the letter it was added to.
   */
  addShape(glyphName: string, kind: ShapeKind, box: Box): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const clockwise = dominantConvention(typeface.glyphs) === "truetype";
    const shape = shapeFrom(kind, box, clockwise, this.state.polygonSides);
    if (!shape) return;
    const named = { rectangle: "a rectangle", ellipse: "an ellipse", polygon: "a polygon" }[kind];
    this.editGlyph(glyphName, `Draw ${named}`, (one) => {
      one.contours = [...one.contours, shape];
    });
    // Left selected, because the next thing anybody does with a shape they
    // just drew is move it or scale it, and both need it picked.
    const contour = (this.glyph(glyphName)?.contours.length ?? 1) - 1;
    this.set({
      selectedNodes: new Set(shape.nodes.map((_, node) => nodeKey({ contour, node }))),
    });
  }

  /**
   * Cut the letter along a dragged line.
   *
   * Says when the line missed rather than pushing an edit that changed
   * nothing: a knife stroke that fell short of the outline, or grazed it
   * without going through, looks exactly like one that worked until you try to
   * drag the half that was never made.
   */
  cutGlyph(glyphName: string, from: Vec2, to: Vec2): void {
    const glyph = this.glyph(glyphName);
    if (!glyph) return;
    const cut = slice(glyph.contours, from, to);
    if (!cut) {
      this.say("That cut did not go through anything. Drag right across a shape.", "error");
      return;
    }
    const made = cut.length - glyph.contours.length;
    this.editGlyph(glyphName, "Cut", (one) => {
      one.contours = cut;
    });
    // The point indices have all moved, so a selection kept from before would
    // be pointing at whatever now happens to sit at those numbers.
    this.set({ selectedNodes: new Set() });
    this.say(`Cut into ${made + 1} piece${made === 0 ? "" : "s"}.`, "success");
  }

  /*
   * The operations on one or two points.
   *
   * Every one of these needs to know which points are in hand, which is why
   * they live here rather than in `nodes.ts` -- the arithmetic next door takes
   * nodes and gives back nodes and has never heard of a selection. What is
   * added here is the part that is a decision rather than a calculation: what
   * happens when nothing is selected, and where the selection goes afterwards
   * when the operation has changed how many points there are.
   */

  /** Make the picked points smooth, or let them turn again. */
  retypeSelection(glyphName: string, kind: "smooth" | "corner"): void {
    const picked = this.state.selectedNodes;
    /*
     * This one needs a selection and does not fall back to the whole letter.
     * Smoothing every point in an `A` would move handles all over a letter
     * that has no curves in it, which is not a thing anybody means by pressing
     * a button once.
     */
    if (picked.size === 0) {
      this.say("Pick the points to change first.", "error");
      return;
    }
    const change = kind === "smooth" ? smoothed : cornered;
    this.editGlyph(glyphName, kind === "smooth" ? "Make smooth" : "Make corner", (one) => {
      one.contours = one.contours.map((contour, index) => ({
        ...contour,
        nodes: contour.nodes.map((node, at) =>
          picked.has(nodeKey({ contour: index, node: at })) ? change(node) : node,
        ),
      }));
    });
  }

  /**
   * Put the picked points, or the whole letter, on whole units.
   *
   * The one here that does fall back to the whole letter, because rounding
   * everything is what somebody means by it: a font is drawn on whole units
   * and a coordinate between two of them is one the exported file rounds
   * anyway.
   */
  roundSelection(glyphName: string): void {
    const glyph = this.glyph(glyphName);
    if (!glyph) return;
    const picked = this.state.selectedNodes;
    const whole = picked.size === 0;
    const inHand = (contour: number, node: number): boolean =>
      whole || picked.has(nodeKey({ contour, node }));

    /*
     * Counted before anything is edited, and nothing is edited when the count
     * is nought. Every number this application shows is displayed rounded, so
     * a coordinate a tenth of a unit off looks identical before and after --
     * which makes the count the only way anybody can tell the operation did
     * something, and makes a silent no-op that marks the font as modified a
     * thing nobody could see was wrong.
     */
    let moving = 0;
    glyph.contours.forEach((contour, index) => {
      contour.nodes.forEach((node, at) => {
        if (inHand(index, at) && !isOnGrid(node)) moving += 1;
      });
    });
    if (moving === 0) {
      this.say(
        whole
          ? "Every point in this letter is already on a whole unit."
          : "Those points are already on whole units.",
        "info",
      );
      return;
    }

    this.editGlyph(glyphName, "Round coordinates", (one) => {
      one.contours = one.contours.map((contour, index) => ({
        ...contour,
        nodes: contour.nodes.map((node, at) => (inHand(index, at) ? rounded(node) : node)),
      }));
    });
    this.say(`Put ${moving} point${moving === 1 ? "" : "s"} back on whole units.`, "success");
  }

  /**
   * Take out the points that should not be there and straighten what nearly is.
   *
   * Says how many it removed, because this is the one operation in the set
   * that removes something and a button that silently deletes four points is a
   * button nobody presses twice. The selection goes: every index after a
   * removed point has moved, and a selection pointing at the wrong points is
   * worse than none.
   */
  tidyGlyph(glyphName: string): void {
    const glyph = this.glyph(glyphName);
    if (!glyph) return;
    const removing = tidyWouldRemove(glyph.contours);
    this.editGlyph(glyphName, "Tidy up paths", (one) => {
      one.contours = one.contours.map((contour) => tidy(contour));
    });
    this.set({ selectedNodes: new Set() });
    this.say(
      removing === 0
        ? "Nothing to tidy up: no doubled points and nothing off the straight."
        : `Removed ${removing} point${removing === 1 ? "" : "s"} that was doing nothing.`,
      removing === 0 ? "info" : "success",
    );
  }

  /**
   * Replace a corner with two points and a flat between them.
   *
   * One point, because the operation is about a specific corner and opening
   * several at once would leave somebody looking at a letter with new points
   * all over it. The two it makes are left selected, since dragging them
   * apart is the entire reason for opening a corner.
   */
  openSelectedCorner(glyphName: string): void {
    const glyph = this.glyph(glyphName);
    const picked = [...this.state.selectedNodes];
    if (!glyph) return;
    if (picked.length !== 1) {
      this.say("Pick the one corner to open.", "error");
      return;
    }
    const [contourIndex, nodeIndex] = picked[0].split(":").map(Number);
    const contour = glyph.contours[contourIndex];
    if (!contour) return;
    const opened = openCorner(contour, nodeIndex);
    if (opened.nodes.length === contour.nodes.length) {
      this.say("That point has no corner to open: it is the end of an open path.", "error");
      return;
    }
    this.editGlyph(glyphName, "Open corner", (one) => {
      one.contours = one.contours.map((each, index) => (index === contourIndex ? opened : each));
    });
    this.set({
      selectedNodes: new Set([
        nodeKey({ contour: contourIndex, node: nodeIndex }),
        nodeKey({ contour: contourIndex, node: nodeIndex + 1 }),
      ]),
    });
  }

  /**
   * Close an opened corner back up: two points and the flat become one.
   *
   * The two have to be neighbours on the same path, because the operation is
   * "carry these two sides on until they meet" and two points at opposite ends
   * of a letter have no sides in common to carry.
   */
  reconnectSelection(glyphName: string): void {
    const glyph = this.glyph(glyphName);
    const picked = [...this.state.selectedNodes];
    if (!glyph) return;
    if (picked.length !== 2) {
      this.say("Pick the two points to join.", "error");
      return;
    }
    const refs = picked
      .map((key) => key.split(":").map(Number))
      .sort((one, other) => one[0] - other[0] || one[1] - other[1]);
    const [[contourIndex, first], [otherContour, second]] = refs;
    const contour = glyph.contours[contourIndex];
    if (!contour || contourIndex !== otherContour) {
      this.say("Those two points are on different paths.", "error");
      return;
    }
    // Sorted, so the pair is either consecutive or wraps the end of the ring.
    const count = contour.nodes.length;
    const wraps = contour.closed && first === 0 && second === count - 1;
    const at = wraps ? second : first;
    if (!wraps && second !== first + 1) {
      this.say("Those two points are not next to each other on the path.", "error");
      return;
    }
    const joined = reconnect(contour, at);
    if (joined.nodes.length === count) {
      this.say("Those two sides run parallel, so there is no corner to put back.", "error");
      return;
    }
    this.editGlyph(glyphName, "Reconnect nodes", (one) => {
      one.contours = one.contours.map((each, index) => (index === contourIndex ? joined : each));
    });
    this.set({
      selectedNodes: new Set([nodeKey({ contour: contourIndex, node: wraps ? 0 : at })]),
    });
  }

  /**
   * The four operations this application already knew how to do and had never
   * offered.
   *
   * Every one of them is engine code that has been in the tree since the
   * exporter needed it: adding the points a curve turns at, winding the
   * contours the right way round, fusing overlaps, cutting one shape out of
   * another. They ran once, silently, on the way to a file, and there was no
   * way to ask for any of them while drawing -- which meant the Checks view
   * could tell somebody their extremes were missing and offer them nothing to
   * do about it but place the points by hand.
   *
   * Named for what Glyphs calls them, and on the same keys, because somebody
   * arriving here has those in their fingers already.
   */

  /** Put a point wherever a curve reaches its furthest in any direction. */
  addExtremes(glyphName: string): void {
    this.editGlyph(glyphName, "Add extremes", (glyph) => {
      glyph.contours = glyph.contours.map((contour) => insertExtrema(contour));
    });
  }

  /**
   * Wind every contour the way the rest of the font is wound.
   *
   * The convention is read off the font rather than imposed on it. A font
   * opened from a `.ttf` is wound one way and one opened from a UFO the
   * other, and both are correct; forcing either would flip every contour in
   * somebody's file for no reason they asked for.
   */
  correctPathDirection(glyphName: string): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const format = dominantConvention(typeface.glyphs);
    this.editGlyph(glyphName, "Correct path direction", (glyph) => {
      glyph.contours = correctDirection(glyph.contours, format, "nesting");
    });
  }

  /**
   * Fuse overlapping contours into the outline they add up to.
   *
   * Asynchronous, and the only one of the four that is: it goes through the
   * boolean library, which is loaded on demand rather than carried in the
   * bundle for the fonts that never need it.
   */
  async removeOverlap(glyphName: string): Promise<void> {
    const typeface = this.state.typeface;
    const glyph = this.glyph(glyphName);
    if (!typeface || !glyph || glyph.contours.length < 2) return;
    this.set({ busy: true });
    try {
      const fused = await removeOverlaps(glyph.contours, "nesting");
      if (fused.length > 0) {
        this.editGlyph(glyphName, "Remove overlap", (one) => {
          one.contours = fused;
        });
      }
      this.set({ busy: false });
    } catch (error) {
      this.set({
        busy: false,
        status: {
          message: error instanceof Error ? error.message : "The overlap could not be removed.",
          tone: "error",
        },
      });
    }
  }

  /**
   * One contour cut out of the others, or added to them.
   *
   * Takes the paths by index because that is how the paths list names them,
   * and the paths list is where a person picks which two shapes they mean.
   */
  async combineContours(
    glyphName: string,
    indices: number[],
    how: "unite" | "subtract",
  ): Promise<void> {
    const glyph = this.glyph(glyphName);
    if (!glyph || indices.length < 2) return;
    const picked = indices.map((index) => glyph.contours[index]).filter(Boolean);
    if (picked.length < 2) return;

    // The boolean library is fetched on demand rather than carried in the
    // bundle, so it has to have arrived before any of it is asked for. It
    // throws rather than waiting, which is right -- and makes this async.
    await readyToCut();

    const combined =
      how === "unite"
        ? unite(picked, "nesting")
        : // The first is what is being cut into; the rest are the knife. Which
          // way round is on the button's hover, because the two directions
          // give completely different answers and the list order is the only
          // thing that could decide it.
          subtract([picked[0]], picked.slice(1), "nesting");

    /*
     * Nothing left is an answer, and it has to be said.
     *
     * Cutting a shape out of one it completely contains leaves nothing, which
     * is arithmetic rather than a fault -- and it is exactly what happens when
     * somebody picks the two paths of an `o` the other way round. Returning
     * quietly makes a working button look broken, so this says what happened
     * and leaves the letter alone.
     */
    if (combined.length === 0) {
      this.say(
        how === "unite"
          ? "Those paths add up to nothing."
          : `Path ${indices[0] + 1} is inside what you are cutting out of it, so nothing would be left.`,
        "error",
      );
      return;
    }

    const label = how === "unite" ? "Unite paths" : "Subtract paths";
    this.editGlyph(glyphName, label, (one) => {
      const kept = one.contours.filter((_, index) => !indices.includes(index));
      one.contours = [...kept, ...combined];
    });
  }

  reverseContour(glyphName: string, index: number): void {
    this.editGlyph(glyphName, "Reverse path direction", (glyph) => {
      const contour = glyph.contours[index];
      if (contour) glyph.contours[index] = reverseContour(contour);
    });
  }

  /**
   * Move a contour up or down the order it is drawn in.
   *
   * Order matters for the same reason direction does, and for one more: an
   * exported font lists the contours in this order, so two fonts that look
   * identical and differ here are two different files.
   */
  moveContour(glyphName: string, index: number, by: number): void {
    this.editGlyph(glyphName, "Reorder path", (glyph) => {
      const to = index + by;
      if (to < 0 || to >= glyph.contours.length) return;
      const [moved] = glyph.contours.splice(index, 1);
      glyph.contours.splice(to, 0, moved);
    });
    /*
     * The selection is dropped rather than followed.
     *
     * It is keyed by contour index, so after a reorder every key points at a
     * different contour -- and a selection that silently jumps to other points
     * is worse than one that clears.
     */
    this.set({ selectedNodes: new Set() });
  }

  /** Take a contour out of the letter. */
  removeContour(glyphName: string, index: number): void {
    this.editGlyph(glyphName, "Delete path", (glyph) => {
      glyph.contours.splice(index, 1);
    });
    this.set({ selectedNodes: new Set() });
  }

  /**
   * Move a glyph within its advance, from either side.
   *
   * Changing the left sidebearing slides the outline and widens the advance to
   * match, so the space on the right is untouched; changing the right one only
   * changes the advance. That asymmetry is what a designer means by the two
   * words, and having it here rather than in a view is what lets the Spacing
   * table and the glyph editor agree about it.
   */
  shiftSidebearing(name: string, delta: number, side: "left" | "right"): void {
    if (delta === 0) return;
    this.editGlyph(
      name,
      side === "left" ? "Set left sidebearing" : "Set right sidebearing",
      (glyph) => {
        if (side === "left") {
          for (const contour of glyph.contours) {
            for (const node of contour.nodes) {
              node.point = { x: node.point.x + delta, y: node.point.y };
              if (node.handleIn) node.handleIn = { x: node.handleIn.x + delta, y: node.handleIn.y };
              if (node.handleOut) {
                node.handleOut = { x: node.handleOut.x + delta, y: node.handleOut.y };
              }
            }
          }
        }
        glyph.advanceWidth = Math.max(0, glyph.advanceWidth + delta);
      },
    );
  }

  /**
   * Close the outline the pen is drawing.
   *
   * The pen's second action, and it did not exist. `addPoint` appends to the
   * last open contour or starts a new one, and nothing anywhere in this
   * application ever set `closed` -- so every outline drawn with the pen stayed
   * open, and an open contour does not fill. A person could draw a perfectly
   * good `o` and watch it stay a wire.
   *
   * Refused under three points, because two points closed is a line drawn twice
   * and a font full of them is a font full of contours with no area.
   */
  closeOutline(name: string): boolean {
    const glyph = this.glyph(name);
    const contour = glyph?.contours[glyph.contours.length - 1];
    if (!contour || contour.closed || contour.nodes.length < 3) return false;

    this.editGlyph(name, "Close the outline", (editing) => {
      const last = editing.contours[editing.contours.length - 1];
      if (last) last.closed = true;
    });
    this.set({ drawing: false });
    this.say("Outline closed.", "success");
    return true;
  }

  // -------------------------------------------------------------------------
  // Writing: strokes drawn with a pen, rather than outlines drawn by hand
  // -------------------------------------------------------------------------

  /**
   * The pen a fresh stroke is written with.
   *
   * Held on the desk rather than on the letter, because it is the hand rather
   * than the drawing: somebody who sets a pen to forty degrees means the next
   * stroke as much as this one, and having to set it again per stroke is what
   * makes an alphabet come out inconsistent.
   */
  get pen(): { width: number; contrast: number; angle: number } {
    return this.state.pen;
  }

  setPen(pen: Partial<{ width: number; contrast: number; angle: number }>): void {
    this.set({ pen: { ...this.state.pen, ...pen } });
  }

  /** The strokes of a letter, or an empty list where it was not written. */
  strokesOf(name: string): QuillStroke[] {
    return this.glyph(name)?.written?.strokes ?? [];
  }

  /**
   * Bring a written letter's ink back into step with its strokes.
   *
   * Called after every change to the strokes, and it is the reason the rest of
   * the application never has to know a pen was involved: the contours are
   * always what the strokes sweep to, so the proof page and the exporter and
   * every path tool go on reading contours.
   *
   * A letter that has been expanded is left alone. There the outlines are the
   * letter and the strokes are only kept so it can be taken back.
   */
  private reswept(glyph: Glyph): void {
    const written = glyph.written;
    if (!written || written.expanded) return;
    glyph.contours = inkOf(written.strokes, this.state.typeface?.unitsPerEm ?? 1000);
  }

  /**
   * Start a written stroke, or add a point to the one being written.
   *
   * The mirror of the pen's `addPoint`, and deliberately the same gesture: a
   * click puts a corner down, a pull brings a curve out of it. What differs is
   * what the line means. The pen's line is the edge of the letter and this one
   * is its middle, so this one is not the shape -- the shape is what the pen
   * sweeps along it, and it appears the moment there are two points.
   */
  writePoint(name: string, at: Vec2): void {
    const glyph = this.glyph(name);
    if (!glyph) return;
    /*
     * Writing on a letter whose ink has been taken puts it back to strokes.
     *
     * Because otherwise the stroke goes in and the letter does not move: the
     * ink stopped following the strokes when it was taken, so `reswept` is a
     * no-op and the person is drawing into nothing while the status line
     * cheerfully offers to fill it in. Nothing is lost by going back, and this
     * is why: an expanded letter still carrying its strokes is one nobody has
     * hand-edited, since the first edit clears them. So the outlines here are
     * exactly what the sweep made and re-sweeping them changes nothing.
     */
    if (glyph.written?.expanded) this.unexpandWritten(name);
    const { width, contrast, angle } = this.state.pen;
    const using = this.state.usingPen ?? undefined;
    const going = this.state.writing;

    /*
     * A click with nothing being written starts a stroke rather than adding to
     * the last one, and this is the distinction the pen next door had to learn
     * too. "Is the last stroke open" is a fact about the shape; "is somebody
     * part way through writing one" is a fact about the session. With one flag
     * for both, a stroke finished with Escape was still the open one, so the
     * next click reached back and extended it -- and two strokes of an `n` came
     * out as a single zig-zag through the middle of the letter.
     *
     * The stroke starts empty and carries no segment, because one point is a
     * place and not a stroke. The point waits on the desk until a second click
     * gives it somewhere to go.
     */
    if (!going || going.name !== name) {
      this.editGlyph(name, "Write", (editing) => {
        const written = editing.written ?? { strokes: [] };
        written.strokes.push({
          spine: { segments: [], closed: false },
          width: [{ at: 0, width }],
          nib: [{ at: 0, contrast, angle, ...(using ? { pen: using } : {}) }],
          start: { kind: "butt" },
          end: { kind: "butt" },
          join: "round",
        });
        editing.written = written;
      });
      this.set({ writing: { name, from: { ...at } } });
      return;
    }

    this.editGlyph(name, "Write", (editing) => {
      const strokes = editing.written?.strokes ?? [];
      const open = strokes[strokes.length - 1];
      if (!open || open.spine.closed) return;
      const segments = open.spine.segments;
      const last = segments[segments.length - 1];
      const from = last && last.kind !== "arc" ? last.to : going.from;
      /*
       * A straight cubic rather than a line, so that pulling a handle out of
       * either end has somewhere to pull from. A line segment would have to be
       * replaced by a cubic the moment somebody curved it, and the spine would
       * change kind under a gesture that was meant to shape it.
       */
      segments.push({
        kind: "cubic",
        from: { ...from },
        c1: { ...from },
        c2: { ...at },
        to: { ...at },
      });
      open.nib = penAtNodes(open.spine, open.nib);
      this.reswept(editing);
    });
  }

  /**
   * The classical calligraphic grid, measured in pen widths.
   *
   * A calligrapher does not set an x-height in units, they set it in nib
   * widths: a Textura at four and a half, a Roundhand at five, a display hand
   * at three. That is the whole construction of a written alphabet and it is
   * the one piece of the craft the guides could not express -- so somebody who
   * knows exactly what they are doing had to work out that 4.5 nibs of a
   * sixty-unit pen is two hundred and seventy units, and type it.
   *
   * The ascender and descender each run two pen widths beyond, which is the
   * classical proportion, and the vertical metrics are set to match so the
   * proof page and the exporter agree with the guides.
   */
  writtenGrid(nibs: number): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const width = Math.max(1, this.state.pen.width);
    const xHeight = Math.round(width * nibs);
    const beyond = Math.round(width * 2);
    const metrics = {
      ...typeface.metrics,
      xHeight,
      capHeight: xHeight + beyond,
      ascender: xHeight + beyond,
      descender: -beyond,
    };
    typeface.metrics = metrics;
    this.set({
      guides: [
        { axis: "y" as const, at: 0 },
        { axis: "y" as const, at: xHeight },
        { axis: "y" as const, at: xHeight + beyond },
        { axis: "y" as const, at: -beyond },
        // One pen width in from the left, which is the distance Textura sets
        // between two stems and the usual place a written letter starts.
        { axis: "x" as const, at: Math.round(width) },
      ],
    });
    this.say(
      `Guides at ${nibs} pen widths: x-height ${xHeight}, and ${beyond} beyond each way.`,
      "success",
    );
  }

  // -------------------------------------------------------------------------
  // Saved pens
  // -------------------------------------------------------------------------

  get pens(): SavedPen[] {
    return this.state.pens;
  }

  /**
   * Write the next stroke with a saved pen, or with the hand's own again.
   *
   * Also sets the hand's three numbers to the pen's, so the panel shows what
   * will actually be drawn rather than a set of numbers the saved pen is about
   * to override.
   */
  usePen(id: string | null): void {
    if (!id) {
      this.set({ usingPen: null });
      return;
    }
    const saved = this.state.pens.find((one) => one.id === id);
    if (!saved) return;
    this.set({
      usingPen: id,
      pen: { width: saved.width, contrast: saved.contrast, angle: saved.angle },
    });
  }

  /**
   * Save the pen in hand under a name.
   *
   * From whatever the panel is currently showing, which is either a stop that
   * was picked or the hand's own -- so "make this a pen" works from a letter
   * that came out well, which is how somebody who is not thinking in numbers
   * arrives at a set of pens.
   *
   * The name is a starting point rather than a question. Asked for up front it
   * was a browser prompt, the only one in the application: unstyled, blocking,
   * and with no way to change the answer afterwards. Given a name straight away
   * the pen exists, and the row it lands in is a field to type over -- which is
   * how a version is named next door, and means renaming works for the five
   * pens that ship as well as the ones somebody makes.
   */
  savePen(name: string): string | null {
    const taken = new Set(this.state.pens.map((one) => one.name));
    let trimmed = name.trim() || "Pen";
    // A duplicate name is not wrong, but two rows reading the same thing are
    // two rows nobody can tell apart.
    if (taken.has(trimmed)) {
      let at = 2;
      while (taken.has(`${trimmed} ${at}`)) at += 1;
      trimmed = `${trimmed} ${at}`;
    }
    const { width, contrast, angle } = this.state.pen;
    const id = `pen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    this.set({
      pens: [...this.state.pens, { id, name: trimmed, width, contrast, angle }],
      usingPen: id,
    });
    this.say(`Saved as ${trimmed}. Type over the name to change it.`, "success");
    return id;
  }

  /**
   * Change a saved pen, and with it every stroke that follows it.
   *
   * The whole point of the feature and the one operation that has to reach
   * outside the letter in hand: every written glyph in the font is brought back
   * into line, and their outlines re-swept. One history entry for all of it,
   * because it is one act.
   */
  editPen(id: string, change: Partial<Omit<SavedPen, "id">>): void {
    const typeface = this.state.typeface;
    const before = this.state.pens;
    const after = before.map((one) => (one.id === id ? { ...one, ...change } : one));
    this.set({ pens: after });
    if (change.name !== undefined && Object.keys(change).length === 1) return;
    if (!typeface) return;

    const touched: Array<{ index: number; was: Glyph }> = [];
    typeface.glyphs.forEach((glyph, index) => {
      if (!glyph.written?.strokes.some((one) => one.nib.some((stop) => stop.pen === id))) return;
      touched.push({ index, was: cloneGlyph(glyph) });
      glyph.written.strokes = followPens(glyph.written.strokes, after);
      this.reswept(glyph);
      glyph.dirty = true;
    });
    if (touched.length === 0) return;

    const now = touched.map(({ index }) => cloneGlyph(typeface.glyphs[index]));
    this.push({
      label: "Change the pen",
      undo: () => {
        this.set({ pens: before });
        touched.forEach(({ index, was }) => {
          typeface.glyphs[index] = cloneGlyph(was);
        });
      },
      redo: () => {
        this.set({ pens: after });
        touched.forEach(({ index }, at) => {
          typeface.glyphs[index] = cloneGlyph(now[at]);
        });
      },
    });
    this.touch();
    this.say(
      `${touched.length} letter${touched.length === 1 ? "" : "s"} followed the pen.`,
      "success",
    );
  }

  /**
   * Put a saved pen on a stop, or take a stop off the pen it follows.
   *
   * Detaching keeps the numbers rather than resetting them, because the point
   * of detaching is that this one place is nearly right and needs to be its
   * own -- and a detach that reset the pen would throw away the thing being
   * kept.
   */
  setStopPen(name: string, stroke: number, stop: number, id: string | null): void {
    const saved = id ? this.state.pens.find((one) => one.id === id) : undefined;
    this.editGlyph(name, id ? "Use the pen" : "Free the pen", (editing) => {
      const one = editing.written?.strokes[stroke];
      const held = one?.nib[stop];
      if (!one || !held) return;
      if (saved) {
        held.pen = saved.id;
        held.contrast = saved.contrast;
        held.angle = saved.angle;
        one.width = [{ at: 0, width: saved.width }];
      } else {
        delete held.pen;
      }
      this.reswept(editing);
    });
  }

  /** Take a saved pen away. Strokes that followed it keep the shape they had. */
  deletePen(id: string): void {
    const typeface = this.state.typeface;
    this.set({
      pens: this.state.pens.filter((one) => one.id !== id),
      usingPen: this.state.usingPen === id ? null : this.state.usingPen,
    });
    if (!typeface) return;
    /*
     * Detached rather than left pointing at nothing. `penOf` falls back to the
     * stop's own values for a pen that is gone, so the letters would look right
     * either way -- but a stop that names a pen the font does not have is a
     * thing somebody has to explain later.
     */
    for (const glyph of typeface.glyphs) {
      for (const one of glyph.written?.strokes ?? []) {
        for (const stop of one.nib) if (stop.pen === id) delete stop.pen;
      }
    }
    this.touch();
  }

  /** Which pen the panel is showing. */
  get stop(): { stroke: number; stop: number } | null {
    return this.state.stop;
  }

  /** Show this pen in the panel, and light its ellipse on the canvas. */
  pickStop(stroke: number, stop: number): void {
    this.set({ stop: { stroke, stop } });
  }

  /** Whether a stroke is part-written and waiting for more points. */
  get writing(): { name: string; from: Vec2 } | null {
    return this.state.writing;
  }

  /** Finish the stroke being written, leaving its ends loose. */
  finishStroke(): void {
    if (!this.state.writing) return;
    this.set({ writing: null });
  }

  /** Close the stroke being written into a ring, as an `o` is written. */
  closeStroke(name: string): boolean {
    const strokes = this.strokesOf(name);
    const open = strokes[strokes.length - 1];
    if (!open || open.spine.closed || open.spine.segments.length < 2) return false;
    this.editGlyph(name, "Close the stroke", (editing) => {
      const written = editing.written;
      const last = written?.strokes[written.strokes.length - 1];
      if (!last) return;
      last.spine.closed = true;
      last.nib = penAtNodes(last.spine, last.nib);
      this.reswept(editing);
    });
    this.set({ writing: null });
    this.say("Stroke closed.", "success");
    return true;
  }

  /**
   * Change the pen at one stop of one stroke.
   *
   * Where turning the pen actually happens. `width` is the axis the pen is held
   * along and belongs to the width profile, so setting it here sets the whole
   * stroke's width; `contrast` and `angle` belong to the stop and are what a
   * turning pen changes between stops.
   */
  setStrokePen(
    name: string,
    stroke: number,
    stop: number,
    pen: Partial<{ width: number; contrast: number; angle: number }>,
    live = false,
  ): void {
    const change = (editing: Glyph): void => {
      const one = editing.written?.strokes[stroke];
      if (!one) return;
      const held = one.nib[stop];
      if (!held) return;
      if (pen.contrast !== undefined) held.contrast = pen.contrast;
      if (pen.angle !== undefined) held.angle = pen.angle;
      if (pen.width !== undefined) one.width = [{ at: 0, width: pen.width }];
      this.reswept(editing);
    };
    if (live) this.editGlyphLive(name, change);
    else this.editGlyph(name, "Change the pen", change);
  }

  /** Move one point of a written stroke's spine. */
  moveStrokePoint(name: string, stroke: number, node: number, to: Vec2, live = false): void {
    const change = (editing: Glyph): void => {
      const one = editing.written?.strokes[stroke];
      if (!one) return;
      const segments = one.spine.segments;
      /*
       * A node is the meeting of two segments, so moving it moves the end of
       * one and the start of the next, and the handles that sat on the old
       * place go with it. Anything that moved only one side would open a gap in
       * the spine, which sweeps as two strokes rather than one.
       */
      const before = segments[node - 1];
      const after = segments[node];
      const from =
        before && before.kind !== "arc"
          ? before.to
          : after && after.kind !== "arc"
            ? after.from
            : undefined;
      if (!from) return;
      const shift = { x: to.x - from.x, y: to.y - from.y };
      const nudge = (point: Vec2 | undefined): void => {
        if (!point) return;
        point.x += shift.x;
        point.y += shift.y;
      };
      if (before && before.kind === "cubic") {
        nudge(before.c2);
        before.to = { ...to };
      }
      if (after && after.kind === "cubic") {
        nudge(after.c1);
        after.from = { ...to };
      }
      this.reswept(editing);
    };
    if (live) this.editGlyphLive(name, change);
    else this.editGlyph(name, "Move the stroke", change);
  }

  /**
   * Pull the curve out of the point a stroke was just written to.
   *
   * The spine is a chain of cubics, so the handle being pulled is the one
   * leaving the point just placed, and the one arriving at it is that mirrored
   * -- which is what makes the stroke run through the point smoothly rather
   * than turning a corner there. Live, and recorded once when the pointer comes
   * up, like every other drag.
   */
  pullStroke(name: string, stroke: number, node: number, to: Vec2): void {
    this.editGlyphLive(name, (editing) => {
      const one = editing.written?.strokes[stroke];
      const segments = one?.spine.segments;
      if (!one || !segments) return;
      const arrived = segments[node - 1];
      if (arrived?.kind !== "cubic") return;
      const point = arrived.to;
      arrived.c2 = { x: point.x - (to.x - point.x), y: point.y - (to.y - point.y) };
      const leaving = segments[node];
      if (leaving && leaving.kind === "cubic") leaving.c1 = { ...to };
      this.reswept(editing);
    });
  }

  /** Take a written stroke out of the letter. */
  deleteStroke(name: string, stroke: number): void {
    this.editGlyph(name, "Delete the stroke", (editing) => {
      const written = editing.written;
      if (!written) return;
      written.strokes.splice(stroke, 1);
      if (written.strokes.length === 0) editing.written = undefined;
      else this.reswept(editing);
      if (written.strokes.length === 0) editing.contours = [];
    });
  }

  /**
   * Write a stroke from a line drawn in one movement.
   *
   * The freehand tool's answer, and the same fitting the outline freehand uses:
   * a trail of pointer positions in, a handful of curves out. Writing is the
   * gesture this suits best of anything in the editor, because a written
   * letter *is* a movement -- the outline freehand is a person imitating a
   * curve and this is a person making one.
   */
  writeTrail(name: string, trail: Vec2[]): boolean {
    if (trail.length < 2) return false;
    const fitted = strokeToContour(trail, { closeWithin: 0 });
    if (!fitted || fitted.nodes.length < 2) return false;
    const { width, contrast, angle } = this.state.pen;
    const using = this.state.usingPen ?? undefined;
    const segments: QuillSegment[] = [];
    for (let index = 1; index < fitted.nodes.length; index++) {
      const from = fitted.nodes[index - 1];
      const to = fitted.nodes[index];
      segments.push({
        kind: "cubic",
        from: { ...from.point },
        c1: { ...(from.handleOut ?? from.point) },
        c2: { ...(to.handleIn ?? to.point) },
        to: { ...to.point },
      });
    }
    if (segments.length === 0) return false;
    this.editGlyph(name, "Write", (editing) => {
      const written = editing.written ?? { strokes: [] };
      const spine = { segments, closed: false };
      written.strokes.push({
        spine,
        width: [{ at: 0, width }],
        nib: penAtNodes(spine, [{ at: 0, contrast, angle, ...(using ? { pen: using } : {}) }]),
        start: { kind: "butt" },
        end: { kind: "butt" },
        join: "round",
      });
      editing.written = written;
      this.reswept(editing);
    });
    this.set({ writing: null });
    return true;
  }

  /**
   * Take a written letter's ink as its own, so the outline tools can reach it.
   *
   * The escape hatch, and the reason writing does not have to be able to draw
   * everything: write the letter, take the ink, and fix the one curve that is
   * wrong with the tools that are already here. The strokes stay, so it can be
   * put back for as long as nobody has edited the outlines.
   */
  expandWritten(name: string): boolean {
    const glyph = this.glyph(name);
    if (!glyph?.written || glyph.written.expanded) return false;
    this.editGlyph(name, "Take the ink", (editing) => {
      if (editing.written) editing.written.expanded = true;
    });
    this.say("The ink is the letter now. The strokes are kept, so this can be undone.", "success");
    return true;
  }

  /** Put an expanded letter back to its strokes. */
  unexpandWritten(name: string): boolean {
    const glyph = this.glyph(name);
    if (!glyph?.written?.expanded) return false;
    this.editGlyph(name, "Back to strokes", (editing) => {
      if (!editing.written) return;
      editing.written.expanded = false;
      this.reswept(editing);
    });
    this.say("Back to strokes.", "success");
    return true;
  }

  /**
   * Take the outgoing handle off the point the pen last placed.
   *
   * Clicking that point is how a curve is ended: the handle on the arriving
   * side stays and the leaving one goes, so the next click draws a straight
   * line out of a curve. Without it a curve could only ever be followed by
   * another curve.
   */
  retractLast(glyphName: string): boolean {
    const glyph = this.glyph(glyphName);
    const contour = glyph?.contours[glyph.contours.length - 1];
    if (!glyph || !contour || contour.closed || contour.nodes.length === 0) return false;
    const last = contour.nodes[contour.nodes.length - 1];
    if (!last.handleOut) return false;

    this.editGlyph(glyphName, "End the curve", (one) => {
      const editing = one.contours[one.contours.length - 1];
      const node = editing?.nodes[editing.nodes.length - 1];
      if (node) Object.assign(node, retracted(node));
    });
    return true;
  }

  /**
   * Stop drawing, and never leave a stub behind.
   *
   * The verb the pen did not have, and the whole reason a session ends with a
   * dozen paths of litter in the list. There was exactly one way to finish an
   * outline -- a click landing within seven pixels of its first point -- and
   * nothing at all for "I have changed my mind": no Escape, no Enter, no
   * effect from picking up another tool. So every abandoned attempt stayed,
   * and an open contour of one or two points draws as nothing while sitting in
   * the Paths list for ever.
   *
   * A contour of fewer than three points is not a drawing anybody is going to
   * come back to, so finishing drops it. That single rule is what keeps the
   * list clean, and it is safe because three points is also the least that can
   * enclose any area at all.
   */
  finishOutline(glyphName: string, andClose = false): boolean {
    const glyph = this.glyph(glyphName);
    const contour = glyph?.contours[glyph.contours.length - 1];
    if (!glyph || !contour || contour.closed || !this.state.drawing) return false;

    this.set({ drawing: false });

    if (contour.nodes.length < 3) {
      this.editGlyph(glyphName, "Stop drawing", (one) => {
        one.contours = one.contours.slice(0, -1);
      });
      this.say("Stopped drawing. The unfinished outline was dropped.", "info");
      return true;
    }
    if (andClose) return this.closeOutline(glyphName);

    /*
     * Left open, deliberately.
     *
     * Escape means "I am done adding to this", not "close it into a shape I
     * did not draw". An open contour of three or more points is a real thing
     * to have -- half a letter, a spine to be built on -- and the Paths list
     * shows it as one. Enter is the key that closes.
     */
    this.say("Finished. The outline is still open: press Enter over it to close.", "info");
    this.touch();
    return true;
  }

  /**
   * Take a point out and leave the shape open where it was, rather than
   * cutting it in two.
   *
   * What scissors do and the knife cannot: the knife needs a line right across
   * a shape and gives you two shapes, and there was no way at all to simply
   * open one. Opening is how you join two shapes by hand, and how you take the
   * lid off a counter to redraw it.
   */
  openContourAt(glyphName: string, contour: number, node: number): boolean {
    const glyph = this.glyph(glyphName);
    const one = glyph?.contours[contour];
    if (!glyph || !one?.closed || one.nodes.length < 3) return false;

    this.editGlyph(glyphName, "Open the shape", (editing) => {
      const it = editing.contours[contour];
      if (!it) return;
      // Rotated so the cut lands at the ends: the node clicked becomes the
      // last point, and the one after it the first.
      it.nodes = [...it.nodes.slice(node + 1), ...it.nodes.slice(0, node + 1)];
      it.closed = false;
    });
    this.say("Opened. The two ends are loose where you clicked.", "success");
    return true;
  }

  /**
   * Turn a point from a curve into a corner, or back.
   *
   * `retypeSelection` does this for a selection, from a panel. As a tool it
   * wants no selection and no panel: point at it, click it. The direction is
   * read from the geometry rather than the stored type, so a node labelled
   * smooth whose handles are twenty degrees apart becomes properly smooth on
   * the first click rather than needing two.
   */
  convertPoint(glyphName: string, ref: NodeRef): boolean {
    const glyph = this.glyph(glyphName);
    const node = glyph?.contours[ref.contour]?.nodes[ref.node];
    if (!glyph || !node) return false;

    const off = offSmooth(node);
    const makeSmooth = off === null || off > NEARLY_STRAIGHT;
    this.editGlyph(glyphName, makeSmooth ? "Make it a curve" : "Make it a corner", (one) => {
      const it = one.contours[ref.contour]?.nodes[ref.node];
      if (!it) return;
      Object.assign(it, makeSmooth ? smoothed(it) : cornered(it));
    });

    // A corner with no handles cannot be smoothed by moving anything, and
    // saying so beats a click that silently does nothing.
    if (makeSmooth && !node.handleIn && !node.handleOut) {
      this.say("That point has no handles to line up. Pull from it to bring one out.", "info");
    }
    return true;
  }

  /** Put a point on a segment, leaving the curve exactly where it was. */
  addPointOn(glyphName: string, contour: number, segment: number, t: number): boolean {
    const glyph = this.glyph(glyphName);
    if (!glyph?.contours[contour]) return false;
    this.editGlyph(glyphName, "Add a point", (one) => {
      one.contours[contour] = withPointOn(one.contours[contour], segment, t);
    });
    return true;
  }

  /**
   * Take points out, keeping the curve that ran through them.
   *
   * The old delete removed the nodes and let the shape jump, which is what
   * makes an outline something you cannot thin out: every point you take costs
   * you the curve. Re-fitting costs a little accuracy instead.
   *
   * Highest index first, so the earlier ones are still where they were said to
   * be -- and one re-fit per removal rather than one for the lot, because the
   * curve either side of each has to be measured as it stands when that point
   * goes.
   */
  removePoints(glyphName: string, refs: NodeRef[]): boolean {
    const glyph = this.glyph(glyphName);
    if (!glyph || refs.length === 0) return false;

    const byContour = new Map<number, number[]>();
    for (const ref of refs) {
      byContour.set(ref.contour, [...(byContour.get(ref.contour) ?? []), ref.node]);
    }
    this.editGlyph(glyphName, refs.length === 1 ? "Take a point out" : "Take points out", (one) => {
      for (const [at, nodes] of byContour) {
        let contour = one.contours[at];
        if (!contour) continue;
        for (const node of [...nodes].sort((a, b) => b - a)) {
          contour = withoutPoint(contour, node);
        }
        one.contours[at] = contour;
      }
      one.contours = one.contours.filter((contour) => contour.nodes.length > 1);
    });
    this.setSelectedNodes([]);
    return true;
  }

  /**
   * The same outlines in fewer points.
   *
   * What `Tidy up` never did: tidying drops points that are exactly redundant,
   * so a curve carried by forty points none of which is redundant stays at
   * forty. This asks how few describe the same run to within a tolerance.
   */
  simplifyGlyph(glyphName: string, tolerance?: number): void {
    const glyph = this.glyph(glyphName);
    if (!glyph) return;
    const before = glyph.contours.reduce((total, one) => total + one.nodes.length, 0);
    this.editGlyph(glyphName, "Simplify", (one) => {
      one.contours = one.contours.map((contour) => simplified(contour, tolerance));
    });
    const after = this.glyph(glyphName)!.contours.reduce(
      (total, one) => total + one.nodes.length,
      0,
    );
    this.setSelectedNodes([]);
    this.say(
      before === after
        ? "Nothing to take out at this tolerance."
        : `${before - after} ${before - after === 1 ? "point" : "points"} out, ${after} left.`,
      before === after ? "info" : "success",
    );
  }

  editGlyph(name: string, label: string, mutate: (glyph: Glyph) => void): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const index = typeface.glyphIndex.get(name);
    if (index === undefined) return;

    const before = cloneGlyph(typeface.glyphs[index]);
    mutate(typeface.glyphs[index]);
    /*
     * An expanded letter whose outlines were edited by hand is no longer a way
     * back to its strokes, and this is where that is noticed.
     *
     * Un-expand re-sweeps, so it would throw away whatever was done to the
     * outlines. Every other tool with an Expand tells its users to save a copy
     * first and leaves them with undo; the honest answer is to keep the way
     * back exactly as long as it is true, and to say so on the button. So the
     * strokes go the moment the outlines are touched by anything other than the
     * sweep -- which is every edit through here, since the sweep writes through
     * `reswept` and not through a labelled edit.
     */
    const edited = typeface.glyphs[index];
    if (edited.written?.expanded && !KEEPS_STROKES.has(label)) {
      const changed =
        edited.contours.length !== before.contours.length ||
        JSON.stringify(edited.contours) !== JSON.stringify(before.contours);
      if (changed) edited.written = undefined;
    }
    typeface.glyphs[index].dirty = true;
    const after = cloneGlyph(typeface.glyphs[index]);

    this.push({
      label,
      undo: () => {
        typeface.glyphs[index] = cloneGlyph(before);
      },
      redo: () => {
        typeface.glyphs[index] = cloneGlyph(after);
      },
    });
    this.touch();
  }

  /**
   * Edit without recording history, for the continuous part of a drag. The
   * caller records one entry when the gesture finishes.
   */
  editGlyphLive(name: string, mutate: (glyph: Glyph) => void): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const index = typeface.glyphIndex.get(name);
    if (index === undefined) return;
    mutate(typeface.glyphs[index]);
    typeface.glyphs[index].dirty = true;
    this.touch();
  }

  /** Record a completed gesture whose before-state the caller captured. */
  commitGlyphEdit(name: string, label: string, before: Glyph): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const index = typeface.glyphIndex.get(name);
    if (index === undefined) return;
    const after = cloneGlyph(typeface.glyphs[index]);

    /*
     * A control letter moves the rest of the font two ways, and they must not
     * both charge for the same edit.
     *
     * Letters that are built on this one -- h is n with a taller stem, sharing
     * fourteen of its sixteen points -- follow the shape exactly, point for
     * point. Those are then held at neutral parameters, because they have
     * already taken the edit in full and the parametric version of the same
     * change would land on them a second time.
     *
     * Everything else follows the measured qualities instead, which is the
     * honest description of a letter that was drawn separately.
     */
    const followers = new Set(this.followersOf(name));
    const shapeBefore = new Map(
      [...followers].map((follower) => {
        const at = typeface.glyphIndex.get(follower);
        return [follower, at === undefined ? null : cloneGlyph(typeface.glyphs[at])] as const;
      }),
    );

    const links = this.controlLinks.get(name);
    const moved = links ? propagateMoves(typeface, links, pointsThatMoved(before, after)) : [];

    const shapeAfter = new Map(
      [...followers].map((follower) => {
        const at = typeface.glyphIndex.get(follower);
        return [follower, at === undefined ? null : cloneGlyph(typeface.glyphs[at])] as const;
      }),
    );

    const paramsBefore = { ...typeface.params };
    const pinned = [...(this.controlBaseline?.keys() ?? []), ...moved];
    const controlsBefore = new Map(
      pinned.map((pinnedName) => {
        const at = typeface.glyphIndex.get(pinnedName);
        return [pinnedName, at === undefined ? {} : { ...typeface.glyphs[at].params }] as const;
      }),
    );
    const changes = isControlGlyph(name) ? this.propagateFromControls() : [];
    for (const follower of moved) {
      const at = typeface.glyphIndex.get(follower);
      if (at !== undefined) typeface.glyphs[at].params = { ...DEFAULT_PARAMS };
    }
    const paramsAfter = { ...typeface.params };
    const controlsAfter = new Map(
      [...controlsBefore.keys()].map((controlName) => {
        const at = typeface.glyphIndex.get(controlName);
        return [controlName, at === undefined ? {} : { ...typeface.glyphs[at].params }] as const;
      }),
    );

    const restore = (
      params: GlyphParams,
      controls: ReadonlyMap<string, Partial<GlyphParams>>,
      shapes: ReadonlyMap<string, Glyph | null>,
    ): void => {
      typeface.params = { ...params };
      for (const [controlName, controlParams] of controls) {
        const at = typeface.glyphIndex.get(controlName);
        if (at !== undefined) typeface.glyphs[at].params = { ...controlParams };
      }
      for (const [follower, shape] of shapes) {
        const at = typeface.glyphIndex.get(follower);
        if (at !== undefined && shape) typeface.glyphs[at] = cloneGlyph(shape);
      }
    };

    this.push({
      label,
      undo: () => {
        typeface.glyphs[index] = cloneGlyph(before);
        restore(paramsBefore, controlsBefore, shapeBefore);
      },
      redo: () => {
        typeface.glyphs[index] = cloneGlyph(after);
        restore(paramsAfter, controlsAfter, shapeAfter);
      },
    });
    this.set({ lastDerivation: changes });
    this.touch();
  }

  /**
   * Push what changed on a control letter out to the rest of the font.
   *
   * The letter that was edited is pinned to neutral parameters afterwards.
   * Without that it is hit twice -- once by the points the designer moved, and
   * again by the family weight those very points produced -- so thickening n by
   * 30 units would leave n 30 units ahead of the alphabet it is supposed to be
   * setting the standard for.
   */
  /**
   * Record the control letters as they stand, as the thing later edits are
   * measured against. Called when a font is opened, and whenever the document
   * is replaced wholesale.
   */
  captureControlBaseline(): void {
    const typeface = this.state.typeface;
    this.controlBaseline = typeface ? readControls(typeface) : null;
    this.controlOutlines = new Map();
    if (!typeface || !this.controlBaseline) return;
    for (const name of this.controlBaseline.keys()) {
      const index = typeface.glyphIndex.get(name);
      if (index === undefined) continue;
      this.controlOutlines.set(name, structuredClone(typeface.glyphs[index].contours));
    }

    this.controlLinks = new Map();
    for (const name of this.controlBaseline.keys()) {
      this.controlLinks.set(name, buildLinks(typeface, name));
    }
  }

  /** Glyph names that follow a control letter's shape point for point. */
  followersOf(controlName: string): string[] {
    const links = this.controlLinks.get(controlName);
    if (!links) return [];
    const names = new Set<string>();
    for (const followers of links.values()) {
      for (const address of followers) names.add(address.glyph);
    }
    return [...names].sort();
  }

  private propagateFromControls(): ControlChange[] {
    const typeface = this.state.typeface;
    const baseline = this.controlBaseline;
    if (!typeface || !baseline) return [];

    const outlineFor = (name: string) => this.controlOutlines.get(name) ?? null;

    const { params, changes } = deriveParams(
      baseline,
      readControls(typeface),
      typeface.unitsPerEm,
      outlineFor,
    );
    if (changes.length === 0) return [];

    typeface.params = { ...typeface.params, ...params };
    for (const name of baseline.keys()) {
      const index = typeface.glyphIndex.get(name);
      if (index !== undefined) {
        typeface.glyphs[index].params = { ...DEFAULT_PARAMS };
      }
    }
    return changes;
  }

  setFamilyParam<K extends keyof GlyphParams>(key: K, value: GlyphParams[K]): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    typeface.params = { ...typeface.params, [key]: value };
    this.touch();
  }

  /** Record one history entry for a finished family-parameter gesture. */
  commitFamilyParams(label: string, before: GlyphParams): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const after = { ...typeface.params };
    this.push({
      label,
      undo: () => {
        typeface.params = { ...before };
      },
      redo: () => {
        typeface.params = { ...after };
      },
    });
    this.touch();
  }

  setGlyphParam<K extends keyof GlyphParams>(name: string, key: K, value: GlyphParams[K]): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const index = typeface.glyphIndex.get(name);
    if (index === undefined) return;
    const glyph = typeface.glyphs[index];
    glyph.params = { ...glyph.params, [key]: value };
    /*
     * Touched, and it has to say so.
     *
     * An override is a change to the letter as surely as dragging a point is,
     * and two things downstream ask this rather than looking at the outline. A
     * "preserve" export writes the original bytes for any glyph that has not
     * been touched, which meant an override was quietly dropped from the file
     * -- the one place it would never be noticed, since the letter is right on
     * screen the whole time. The grid's own "changed" mark reads it too.
     */
    glyph.dirty = true;
    this.touch();
  }

  /** Drop a glyph's override so it follows the family value again. */
  clearGlyphParam(name: string, key: keyof GlyphParams): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const index = typeface.glyphIndex.get(name);
    if (index === undefined) return;
    const glyph = typeface.glyphs[index];
    const next = { ...glyph.params };
    delete next[key];
    const before = glyph.params;
    glyph.params = next;
    // Still touched: going back to the family's value is a decision too, and
    // the glyph has to be rebuilt to show it.
    glyph.dirty = true;
    this.push({
      label: `Reset ${key}`,
      undo: () => {
        typeface.glyphs[index].params = before;
      },
      redo: () => {
        typeface.glyphs[index].params = next;
      },
    });
    this.touch();
  }

  // -------------------------------------------------------------------------
  // Cutting
  // -------------------------------------------------------------------------

  /*
   * Cuts are not parameters, and they are kept apart on purpose.
   *
   * A parameter is a number and a glyph's own value layers over the family's.
   * A cut is a set of switched-on operations, and half the font's cuts merged
   * with half a letter's own is not a description anybody wrote -- so a letter
   * either goes along with the font or is cut its own way, and these say which.
   */

  /** Change one operation of the font's cuts. */
  changeCut(name: CutName, patch: Partial<Cuts[CutName]>): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const cuts = typeface.cuts ?? noCuts();
    typeface.cuts = { ...cuts, [name]: { ...cuts[name], ...patch } } as Cuts;
    this.touch();
  }

  /** Record one history entry for a finished cut gesture. */
  commitCuts(label: string, before: Cuts | undefined): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const after = typeface.cuts;
    this.push({
      label,
      undo: () => {
        typeface.cuts = before;
      },
      redo: () => {
        typeface.cuts = after;
      },
    });
    this.touch();
  }

  /** Change one operation of a letter's own cuts, taking it out of the font's. */
  changeGlyphCut(name: string, cut: CutName, patch: Partial<Cuts[CutName]>): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const index = typeface.glyphIndex.get(name);
    if (index === undefined) return;
    const glyph = typeface.glyphs[index];
    // Starting from the font's, so the first change to one operation keeps the
    // rest of what the letter was already showing rather than clearing it.
    const cuts = glyph.cuts ?? typeface.cuts ?? noCuts();
    glyph.cuts = { ...cuts, [cut]: { ...cuts[cut], ...patch } } as Cuts;
    // Touched, for the same reasons an override is: a "preserve" export writes
    // the original bytes for any glyph nobody has touched.
    glyph.dirty = true;
    this.touch();
  }

  /** Put a letter back to being cut like the rest of the font. */
  cutLikeTheRest(name: string): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const index = typeface.glyphIndex.get(name);
    if (index === undefined) return;
    const glyph = typeface.glyphs[index];
    if (!glyph.cuts) return;
    const before = glyph.cuts;
    glyph.cuts = undefined;
    glyph.dirty = true;
    this.push({
      label: `Cut ${name} like the rest`,
      undo: () => {
        typeface.glyphs[index].cuts = before;
      },
      redo: () => {
        typeface.glyphs[index].cuts = undefined;
      },
    });
    this.touch();
  }

  /* The same set again for the cast, on the same terms throughout. */

  changeCast(name: CastName, patch: Partial<Cast[CastName]>): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const cast = typeface.cast ?? noCast();
    typeface.cast = { ...cast, [name]: { ...cast[name], ...patch } } as Cast;
    this.touch();
  }

  commitCast(label: string, before: Cast | undefined): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const after = typeface.cast;
    this.push({
      label,
      undo: () => {
        typeface.cast = before;
      },
      redo: () => {
        typeface.cast = after;
      },
    });
    this.touch();
  }

  changeGlyphCast(name: string, operation: CastName, patch: Partial<Cast[CastName]>): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const index = typeface.glyphIndex.get(name);
    if (index === undefined) return;
    const glyph = typeface.glyphs[index];
    const cast = glyph.cast ?? typeface.cast ?? noCast();
    glyph.cast = { ...cast, [operation]: { ...cast[operation], ...patch } } as Cast;
    glyph.dirty = true;
    this.touch();
  }

  castLikeTheRest(name: string): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const index = typeface.glyphIndex.get(name);
    if (index === undefined) return;
    const glyph = typeface.glyphs[index];
    if (!glyph.cast) return;
    const before = glyph.cast;
    glyph.cast = undefined;
    glyph.dirty = true;
    this.push({
      label: `Cast ${name} like the rest`,
      undo: () => {
        typeface.glyphs[index].cast = before;
      },
      redo: () => {
        typeface.glyphs[index].cast = undefined;
      },
    });
    this.touch();
  }

  castFor(name: string): Cast {
    const typeface = this.state.typeface;
    if (!typeface) return noCast();
    const index = typeface.glyphIndex.get(name);
    const own = index === undefined ? undefined : typeface.glyphs[index].cast;
    return own ?? typeface.cast ?? noCast();
  }

  castHeldBy(name: string, operation: CastName): boolean {
    const typeface = this.state.typeface;
    if (!typeface) return false;
    const index = typeface.glyphIndex.get(name);
    const own = index === undefined ? undefined : typeface.glyphs[index].cast;
    if (!own) return false;
    return !sameCast(own[operation], (typeface.cast ?? NO_CAST)[operation]);
  }

  /** Which way round the two layers go. A decision about the font, never a letter. */
  changeCastOrder(order: Cast["order"]): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const before = typeface.cast;
    typeface.cast = { ...(typeface.cast ?? noCast()), order };
    this.commitCast("Which shaping goes first", before);
  }

  /** How a letter is cut, whether that is its own way or the font's. */
  cutsFor(name: string): Cuts {
    const typeface = this.state.typeface;
    if (!typeface) return noCuts();
    const index = typeface.glyphIndex.get(name);
    const glyph = index === undefined ? undefined : typeface.glyphs[index];
    return glyph?.cuts ?? typeface.cuts ?? noCuts();
  }

  /** Whether this letter is cut its own way rather than the font's. */
  isCutException(name: string): boolean {
    const typeface = this.state.typeface;
    if (!typeface) return false;
    const index = typeface.glyphIndex.get(name);
    return index !== undefined && typeface.glyphs[index].cuts !== undefined;
  }

  /** Whether this letter's own cuts say something different about one operation. */
  cutHeldBy(name: string, cut: CutName): boolean {
    const typeface = this.state.typeface;
    if (!typeface) return false;
    const index = typeface.glyphIndex.get(name);
    const own = index === undefined ? undefined : typeface.glyphs[index].cuts;
    if (!own) return false;
    return !sameCut(own[cut], (typeface.cuts ?? NO_CUTS)[cut]);
  }

  /**
   * Redraw everything, for when the boolean library arrives after the font.
   *
   * The letters on screen are correct without it -- a cut that cannot be made
   * is not made -- so nothing is wrong until it lands, and then everything
   * has to be asked again.
   */
  refresh(): void {
    if (this.state.typeface) this.touch();
  }

  /** Copy the resolved parameters of a glyph, for the inspector to display. */
  paramsFor(name: string): GlyphParams {
    const typeface = this.state.typeface;
    if (!typeface) return { ...DEFAULT_PARAMS };
    const index = typeface.glyphIndex.get(name);
    if (index === undefined) return { ...typeface.params };
    return effectiveParams(typeface.glyphs[index], typeface);
  }
}
