/**
 * The outlines: contours, points, and the shapes made out of them.
 *
 * Everything here goes through `editGlyph` and touches nothing else in the
 * chain. It does not know the pen exists and the pen does not know about this.
 * That was measured before the two were separated, not assumed.
 */

import { reverse as reverseContour } from "@/font/outline";
import { NEARLY_STRAIGHT, offSmooth } from "@/font/marks";
import { simplified, withPointOn, withoutPoint } from "@/font/pen";
import type { Contour, Vec2 } from "@/font/types";
import { correctDirection, dominantConvention, insertExtrema } from "@/font/outline";
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
import { EditingStore } from "./store-editing";

export abstract class OutlineStore extends EditingStore {
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

  /**
   * Turn one contour inside out.
   *
   * Direction is not decoration: it decides whether a contour fills or cuts a
   * hole in the one around it. A counter drawn the same way round as its bowl
   * fills solid, and the only way to see that was to export the font and look.
   * Offering it as an operation is what makes it a thing somebody can fix.
   */
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
}
