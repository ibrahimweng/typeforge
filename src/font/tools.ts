/**
 * What each tool is doing, and what it would do if you acted now.
 *
 * One place, because the palette, the cursor and the status line all have to
 * agree. Three readings of the same gesture is three chances to disagree, and a
 * cursor that says "this will cut" over a line that will not is worse than a
 * cursor that says nothing.
 *
 * The phases are not a uniform set bolted onto six tools. Each tool's are its
 * own, and the ones worth showing are exactly the moments where the answer to
 * "what happens if I press now" changes:
 *
 *   - the pen's first click starts an outline and its later ones extend it,
 *     and one particular click closes it
 *   - the pencil closes its loop only if you let go near where you began
 *   - a rectangle held with shift is a square, and with alt grows from its
 *     middle rather than its corner
 *   - a knife cuts only where its line crosses something
 *
 * A tool with nothing to say says nothing. An empty sentence is not a bug here;
 * it is the select tool over empty canvas, which is the state a person spends
 * most of their time in and does not need narrating.
 */

import type { ToolId, ToolState } from "@/state/store";

/** How near the start a freehand line has to end to close its loop. */
export const CLOSES_WITHIN = 30;

/** What the modifier keys are doing, as the canvas reads them. */
export interface Held {
  shift: boolean;
  alt: boolean;
}

/**
 * What the pointer has found, in the terms the tools care about.
 *
 * Every tool's sentence is now a function of this rather than of the tool
 * alone. The knife used to say `drag a line right across a shape` whether or
 * not there was a shape within a mile, which is a sentence that has stopped
 * being advice and become decoration: it says the same thing everywhere, so it
 * carries no information about anywhere.
 */
export interface Under {
  /** Something the select tool could pick up: a node, a handle, an anchor. */
  grabbable: boolean;
  /** The point that would close the open outline, for the pen. */
  closingPoint: boolean;
  /** Whether an outline is open and waiting for more points. */
  pathOpen: boolean;
  /** How many points the open outline has, for saying whether it can close. */
  openPoints: number;
  /** A point of an existing outline, for the tools that work on one. */
  node: boolean;
  /** An edge of an existing outline, for the tools that work on one. */
  edge: boolean;
  /** Any filled shape at all, for the knife, which needs something to cut. */
  shape: boolean;
  /** The point the pen last placed, which a click would take the handle off. */
  lastPoint: boolean;
}

/** Nothing under the pointer, for the callers that have not looked yet. */
export const NOTHING_UNDER: Under = {
  grabbable: false,
  closingPoint: false,
  pathOpen: false,
  openPoints: 0,
  node: false,
  edge: false,
  shape: false,
  lastPoint: false,
};

/** What a gesture in progress amounts to, if there is one. */
export interface Doing {
  kind:
    | "node"
    | "handle"
    | "anchor"
    | "marquee"
    | "pan"
    | "guide"
    | "shape"
    | "knife"
    | "freehand"
    | "pen"
    | "lasso";
  /** For the knife: whether the line as drawn crosses anything. */
  wouldCut?: boolean;
  /** For freehand: whether letting go here would close the loop. */
  wouldClose?: boolean;
  /** For the pen: whether the drag has moved far enough to be pulling a handle. */
  pulling?: boolean;
}

const SHAPE_WORDS = (tool: ToolId, held: Held): string => {
  const shape = tool === "ellipse" ? "circle" : "square";
  if (held.shift && held.alt) return `A ${shape}, from the middle. Let go to keep it.`;
  if (held.shift) return `Held to a ${shape}. Let go to keep it.`;
  if (held.alt) return "Growing from the middle. Let go to keep it.";
  return "Let go to keep it. Shift holds it square, alt grows it from the middle.";
};

/**
 * The tool's state, from what it is doing and what is under the pointer.
 *
 * `doing` wins where there is one: a gesture under way is what the person is
 * attending to, and what might have been grabbed instead stopped mattering the
 * moment they pressed.
 */
export function toolStateFor(
  tool: ToolId,
  under: Under,
  doing: Doing | null,
  held: Held,
): ToolState {
  if (doing) return whileDoing(tool, doing, held);

  switch (tool) {
    case "select":
      return under.grabbable
        ? { phase: "ready", says: "Drag to move it. Shift adds to what is picked." }
        : { phase: "idle", says: "" };

    case "selectPath":
      return under.node || under.edge
        ? { phase: "willDo", says: "Click to pick this whole shape." }
        : { phase: "ready", says: "Click a shape to pick all of it." };

    case "lasso":
      return { phase: "ready", says: "Draw a ring round the points to pick. Shift adds to them." };

    /*
     * The pen, which has four things to say and used to say two.
     *
     * The order here is the order the click resolves in, so the sentence and
     * the click can never disagree -- which they did: over an edge with nothing
     * being drawn it said `Click to start an outline` while the click put a
     * point on the edge instead. A status line that describes a different
     * program than the one under the pointer is worse than none.
     */
    case "pen":
      if (under.closingPoint) return { phase: "willDo", says: "Click to close the outline." };
      if (under.lastPoint) {
        return { phase: "willDo", says: "Click again to end the curve and leave straight." };
      }
      if (under.pathOpen) {
        return under.openPoints >= 3
          ? {
              phase: "ready",
              says: "Click to add a point. The first point closes it, Escape finishes, Enter closes.",
            }
          : { phase: "ready", says: "Click to add a point. Escape finishes without keeping it." };
      }
      return { phase: "ready", says: "Click for a corner, or hold and pull for a curve." };

    case "freehand":
      return { phase: "ready", says: "Drag to draw. Come back to where you began to close it." };

    case "addPoint":
      /*
       * An edge is enough, and a point sitting on it is neither here nor there:
       * on a curve every point is on an edge, so refusing where both are found
       * would blank the tool at exactly the places a person aims.
       */
      return under.edge
        ? { phase: "willDo", says: "Click to put a point here. The curve will not move." }
        : { phase: "ready", says: "Point at an edge to put a point on it." };

    case "deletePoint":
      return under.node
        ? { phase: "willDo", says: "Click to take this point out and redraw the curve." }
        : { phase: "ready", says: "Point at a point to take it out." };

    case "convertPoint":
      return under.node
        ? {
            phase: "willDo",
            says: "Click to switch this between a curve and a corner, or pull to bring a handle out.",
          }
        : { phase: "ready", says: "Point at a point to change what it is." };

    case "rectangle":
    case "ellipse":
    case "polygon":
      return {
        phase: "ready",
        says: `Drag out ${SHAPE_NAMES[tool]}. Shift holds it ${SHAPE_HELD[tool]}, alt grows it from the middle.`,
      };

    /*
     * The knife says whether there is anything to cut.
     *
     * It said the same sentence over an empty canvas as over a letter, so the
     * one case it exists to warn about -- a cut that will do nothing at all --
     * looked exactly like the case where it works.
     */
    case "knife":
      return under.shape
        ? { phase: "ready", says: "Drag a line right across a shape to cut it in two." }
        : { phase: "idle", says: "Nothing to cut here. The line has to cross a shape." };

    case "scissors":
      return under.node || under.edge
        ? { phase: "willDo", says: "Click to open the shape here, leaving the ends loose." }
        : { phase: "ready", says: "Click a point or an edge to open the shape there." };
  }
}

const SHAPE_NAMES: Record<"rectangle" | "ellipse" | "polygon", string> = {
  rectangle: "a rectangle",
  ellipse: "an ellipse",
  polygon: "a polygon",
};

const SHAPE_HELD: Record<"rectangle" | "ellipse" | "polygon", string> = {
  rectangle: "square",
  ellipse: "circular",
  polygon: "upright",
};

function whileDoing(tool: ToolId, doing: Doing, held: Held): ToolState {
  switch (doing.kind) {
    case "pan":
      return { phase: "active", says: "Moving the page." };
    case "guide":
      return { phase: "active", says: "Moving the guide. Drag it off the canvas to take it away." };
    case "marquee":
      return { phase: "active", says: "Everything inside will be picked." };
    case "node":
      return { phase: "active", says: "Moving. Shift holds it to one axis." };
    case "handle":
      return { phase: "active", says: "Bending the curve. Shift holds the handle to one axis." };
    case "anchor":
      return { phase: "active", says: "Moving the anchor." };
    case "shape":
      return { phase: held.shift || held.alt ? "willDo" : "active", says: SHAPE_WORDS(tool, held) };
    case "freehand":
      return doing.wouldClose
        ? { phase: "willDo", says: "Let go here and the line closes into a loop." }
        : { phase: "active", says: "Drawing. Come back to where you began to close it." };
    case "lasso":
      return { phase: "active", says: "Everything inside the ring will be picked." };
    case "knife":
      /*
       * The one that is worth saying out loud. A knife drawn short, or beside a
       * shape rather than across it, does nothing at all -- and did it
       * silently, so the only way to find out was to let go and see that
       * nothing had changed.
       */
      return doing.wouldCut
        ? { phase: "willDo", says: "Let go to cut here." }
        : { phase: "active", says: "Not across anything yet. The line has to cross a shape." };
    case "pen":
      /*
       * The gesture that makes a curve rather than a corner: hold and pull, and
       * the handle comes out of the point. Said out loud because it is the one
       * thing about a pen nobody guesses -- a person who only ever clicks draws
       * polygons and concludes the tool is broken.
       */
      return doing.pulling
        ? {
            phase: "active",
            says: held.alt
              ? "Pulling one side only, so the curve turns here. Let go to keep it."
              : "Pulling the curve out. Alt breaks the handle so the curve can turn.",
          }
        : { phase: "active", says: "Let go for a corner, or pull to curve out of it." };
  }
  /*
   * Unreachable while every kind above has a case, and here so that the day a
   * kind is added it fails loudly rather than returning undefined. It did
   * exactly that once: the pen's own drag went in without a case here, this
   * function ran off the end, and the caller crashed reading `.phase` of
   * nothing -- which killed the whole pointer-down and made the pen look like
   * it had simply stopped working.
   */
  return { phase: "active", says: "" };
}

/**
 * The pointer for a tool in a phase.
 *
 * Five tools shared one crosshair, so the pointer said "a tool is armed" and
 * never which one, and never what it was about to do.
 */
export function cursorFor(tool: ToolId, state: ToolState, dragging: boolean): string {
  if (dragging) return "cursor-grabbing";
  switch (tool) {
    case "select":
      return state.phase === "ready" ? "cursor-grab" : "cursor-default";
    case "selectPath":
      return state.phase === "willDo" ? "cursor-pointer" : "cursor-default";
    case "lasso":
      return "cursor-crosshair";

    case "pen":
      // A pen about to close its outline is doing a different thing from a pen
      // adding to it, and this is the one place a person is looking.
      return state.phase === "willDo" ? "cursor-pointer" : "cursor-crosshair";
    case "freehand":
      return "cursor-cell";

    /*
     * The three that only work on something already drawn point rather than
     * cross, and go blunt where there is nothing for them.
     *
     * A crosshair over empty canvas says "this will draw here", which is the
     * one thing these three never do -- and the reason the first version of
     * Add point felt broken was that it looked armed everywhere.
     */
    case "addPoint":
    case "deletePoint":
    case "convertPoint":
    case "scissors":
      return state.phase === "willDo" ? "cursor-pointer" : "cursor-not-allowed";

    case "rectangle":
    case "ellipse":
    case "polygon":
      return "cursor-crosshair";

    case "knife":
      return state.phase === "idle" ? "cursor-not-allowed" : "cursor-crosshair";
  }
}
