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

/** What the pointer has found, in the terms the tools care about. */
export interface Under {
  /** Something the select tool could pick up: a node, a handle, an anchor. */
  grabbable: boolean;
  /** The point that would close the open outline, for the pen. */
  closingPoint: boolean;
  /** Whether an outline is open and waiting for more points. */
  pathOpen: boolean;
}

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
    | "pencil"
    | "pen";
  /** For the knife: whether the line as drawn crosses anything. */
  wouldCut?: boolean;
  /** For the pencil: whether letting go here would close the loop. */
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

    case "pen":
      if (under.closingPoint) {
        return { phase: "willDo", says: "Click to close the outline." };
      }
      return under.pathOpen
        ? { phase: "ready", says: "Click to add a point, or click the first one to close." }
        : { phase: "ready", says: "Click to start an outline." };

    case "pencil":
      return { phase: "ready", says: "Drag to draw. Come back to where you began to close it." };

    case "rectangle":
    case "ellipse":
      return {
        phase: "ready",
        says: `Drag out ${tool === "ellipse" ? "an ellipse" : "a rectangle"}. Shift holds it ${
          tool === "ellipse" ? "circular" : "square"
        }, alt grows it from the middle.`,
      };

    case "knife":
      return { phase: "ready", says: "Drag a line right across a shape to cut it in two." };
  }
}

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
    case "pencil":
      return doing.wouldClose
        ? { phase: "willDo", says: "Let go here and the line closes into a loop." }
        : { phase: "active", says: "Drawing. Come back to where you began to close it." };
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
    case "pen":
      // A pen about to close its outline is doing a different thing from a pen
      // adding to it, and this is the one place a person is looking.
      return state.phase === "willDo" ? "cursor-pointer" : "cursor-crosshair";
    case "pencil":
      return "cursor-cell";
    case "rectangle":
    case "ellipse":
      return "cursor-crosshair";
    case "knife":
      return state.phase === "willDo" ? "cursor-crosshair" : "cursor-not-allowed";
  }
}
