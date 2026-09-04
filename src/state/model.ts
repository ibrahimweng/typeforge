/**
 * The shape of the document.
 *
 * Split out of the store because it is the contract rather than the machinery:
 * fifty-seven components read `AppState`, none of them care how an edit is
 * applied, and two hundred and fifty lines of that contract were sitting on
 * top of four thousand lines of implementation with nothing but a blank line
 * between them.
 *
 * Types only, and `nodeKey`, which is one expression and belongs beside the
 * `NodeRef` it names. The store re-exports all of it, so nothing that reads
 * from "@/state/store" has to know this file is here.
 */

import type { GroupId as Group, ToolId as Tool } from "@/font/toolset";
import type { ControlChange } from "@/font/control";
import type { Master } from "@/font/master";
import type { Finding } from "@/font/validate";
import type { Typeface, Vec2 } from "@/font/types";
import type { SavedPen } from "@/quill/written";

export type ViewId = "grid" | "glyph" | "kerning" | "metrics" | "proof" | "report";
/*
 * The tools, which are the ones Glyphs Mini has and in the order it has them.
 *
 * Pan and zoom are not among them and never were: they are alt-drag and
 * ctrl-wheel, on the canvas, under whichever tool is in hand. A tool you have
 * to pick before you can move the page is a tool that takes your place in the
 * work away every time you look at something.
 */
/*
 * The tools live in `@/font/toolset` and are re-exported here.
 *
 * Everything in the application already imports `ToolId` from the store, and
 * the tools grew a shape of their own -- groups, an order, a hint each -- that
 * has no business in a state container. Re-exported rather than moved outright
 * so that the twenty files naming `ToolId` from here go on working.
 */
export type { ToolId, GroupId } from "@/font/toolset";

/**
 * What the tool in hand is doing, in the terms that change what the next click
 * does.
 *
 * Not a uniform four states bolted onto six buttons. A tool's phases are its
 * own: the pen's second click means something different from its first, and
 * the knife's line either crosses a shape or it does not. What they have in
 * common is only that each is a moment where the answer to "what happens if I
 * press now" changes.
 *
 * Kept here rather than in the canvas's own `dragRef` because a ref is
 * invisible to React: everything a tool was doing mid-gesture lived in one,
 * and so the palette, the cursor and the status line could not have shown it
 * even if they had wanted to.
 *
 *   `idle`     nothing in progress
 *   `ready`    a gesture would start something -- the select tool over a node
 *   `active`   a gesture is under way
 *   `willDo`   under way, and about to do the tool's particular thing: close
 *              the path, cut the shape, snap to a square
 */
export type ToolPhase = "idle" | "ready" | "active" | "willDo";

/**
 * The phase, and one line saying what pressing now would do.
 *
 * The sentence lives with the phase rather than being derived from it in three
 * places, because the two always change together and a status line that
 * disagrees with the cursor is worse than neither.
 */
export interface ToolState {
  phase: ToolPhase;
  /** What happens if you act now, in the tool's own words. */
  says: string;
}

/** A node's address within a glyph, used for selection. */
export interface NodeRef {
  contour: number;
  node: number;
}

export const nodeKey = (ref: NodeRef): string => `${ref.contour}:${ref.node}`;

/**
 * A letter borrowed from a generator, so the point tools can reach it.
 *
 * Draw holds no outlines. A letter there is a description -- a skeleton, a pen,
 * a set of parts -- redrawn from nothing every time a slider moves, which is why
 * the point tools cannot simply be pointed at it: a dragged node would be undone
 * by the next parameter change, and a tool that loses your work as soon as you
 * touch anything else is worse than no tool.
 *
 * What can be done is to take the letter out. Draw has always been able to hand
 * a letter to another program as an SVG sheet and take the drawing back into the
 * slot it left, keeping its advance so the rhythm of the font does not move
 * under it. This is the same trip with the same destination, made without
 * leaving: the letter is drawn once, put on the desk on its own, worked on with
 * every tool in the application, and handed back into `imported` exactly as a
 * file would have been.
 *
 * A loan and not a copy, because the desk is already occupied. There is one
 * document here, and somebody who had a font open in Edit and went to look at
 * Draw has not abandoned it. So what was open is put aside whole -- the
 * typeface, which letter was selected, the guides drawn against it, and both
 * history stacks -- and comes back untouched when the loan ends, whichever way
 * it ends.
 */
export interface Loan {
  /** Which letter of the drawn font is on the desk. */
  letter: string;
  /** What the font it came from is called, for saying so. */
  family: string;
  /**
   * Which generator it came out of, so it goes back where it came from.
   *
   * This store has no idea there is a forge or a tracer and should not gain
   * one: it holds a letter and hands it back, and the name is carried through
   * for whoever is listening rather than acted on here.
   */
  from: "forge" | "quill";
}

export interface AppState {
  typeface: Typeface | null;
  fileName: string;
  /**
   * What the importer had to say about the file, kept rather than glanced at.
   *
   * These had exactly one reader: the first of them was appended to the status
   * line in the top bar, which is capped at ten rem and truncates -- so a
   * warning about the font somebody had just opened showed up as four
   * characters and an ellipsis, and the rest of it existed only in a tooltip
   * nobody had a reason to hover. They belong where a person goes to find out
   * what is wrong with a font, which is Checks.
   */
  openWarnings: string[];
  view: ViewId;
  tool: Tool;
  /*
   * The tool each group was last on, so a group button comes back to where you
   * left it. Pressing `P` after using Delete point should hand you Delete
   * point, not start you at the pen again -- a group that forgets is a group
   * you have to open every time.
   */
  lastInGroup: Record<Group, Tool>;
  /** What that tool is doing, for the palette, the cursor and the status line. */
  toolState: ToolState;
  /**
   * The letters drawn either side of the one being edited.
   *
   * Two strings rather than one with the glyph marked inside it, because the
   * two sides are asked for separately as often as together: a sidebearing is
   * judged between `n`s, and a kerning pair is judged with one particular
   * letter on one particular side. A single field with a rule for where the
   * current glyph goes is a rule to learn; two fields are what they say.
   *
   * Empty on either side is allowed and means nothing on that side.
   */
  context: { before: string; after: string };
  /**
   * Lines somebody put there themselves, in font units.
   *
   * The metric lines are drawn already and cannot be moved, which is right --
   * they are facts about the font. These are the other kind: the height an
   * overshoot should reach, where a crossbar sits on this particular letter,
   * a line taken off one glyph to line another up with. They belong to the
   * font rather than to a glyph, because that is what they are for: a guide
   * that vanished when you opened the next letter would be a guide you could
   * not line two letters up against.
   */
  /*
   * A guide runs along one axis or the other.
   *
   * This was `{ y: number }`, so every guide was horizontal and there was no
   * way to mark where a stem should stand or where a sidebearing should fall
   * -- which is half of what anybody draws a guide for.
   */
  guides: Array<{ axis: "x" | "y"; at: number }>;
  /** Whether a dragged point is pulled onto the lines worth landing on. */
  snapping: boolean;
  /**
   * Whether the canvas rings the faults nobody can see by looking.
   *
   * Off by default, and a toggle rather than always-on, because these are
   * advice about a drawing in progress: a letter halfway through being drawn is
   * covered in missing extremes and does not need telling. Turned on it is the
   * pass you make before calling a letter finished.
   */
  marks: boolean;
  /**
   * How many sides the polygon tool draws.
   *
   * On the state rather than in the tool because it is a setting somebody
   * chooses once for a job -- six for a run of hexagons, three for arrows --
   * and a count that reset with every drag would be a count nobody could use.
   */
  polygonSides: number;
  /**
   * Whether the pen is part way through an outline.
   *
   * Not the same question as "is the last contour open", which is what the
   * editor asked and is a fact about the shape rather than about the session.
   * An outline finished with Escape and left open is a real thing to have --
   * half a letter, a spine to build on -- but the next pen click somewhere
   * else must start a new outline rather than reach back and extend it. With
   * one flag for both, ten abandoned attempts joined into a single contour
   * wandering across the letter, and its first point was so far from the last
   * that the ring which closes it could never be found.
   */
  drawing: boolean;
  /**
   * The pen the next written stroke is made with.
   *
   * On the desk rather than on the letter, because it is the hand rather than
   * the drawing. Somebody who sets a pen to forty degrees means the next stroke
   * as much as this one, and a pen that reset per stroke is what makes an
   * alphabet come out inconsistent -- which is the whole complaint that writing
   * exists to answer.
   */
  pen: { width: number; contrast: number; angle: number };
  /**
   * The pens this font is written with, by name.
   *
   * With the font rather than with the letter, because that is what makes them
   * worth having: three pens shared across forty letters is what keeps an
   * alphabet consistent, and a pen kept per letter is a copy of a number.
   */
  pens: SavedPen[];
  /** Which saved pen the next stroke follows, if it follows one. */
  usingPen: string | null;
  /**
   * The stroke being written, if one is part-written.
   *
   * Carries the first point, because a stroke of one point has no segment to
   * hold it: the spine is a list of segments and the first click has nothing to
   * make one from. The pen next door has the same shape of problem and solves
   * it with a one-node contour; a spine cannot hold one, so the point waits
   * here until the second click gives it somewhere to go.
   */
  writing: { name: string; from: Vec2 } | null;
  /**
   * Which pen the panel is showing, as a stroke and a stop of it.
   *
   * A written letter has a pen at every stop of every stroke, so "the pen" in
   * a panel has to mean one of them. Picked by clicking its ellipse, and reset
   * when the letter changes -- a stop index means nothing in another letter.
   */
  stop: { stroke: number; stop: number } | null;
  /**
   * The path the pointer is over in the Paths list, lit on the canvas.
   *
   * Twelve rows reading `4 points cw 226x226` and no way to tell which shape
   * each is: the only way to find out was to click one and watch which points
   * turned orange, which costs a selection you may have wanted to keep. The
   * list and the drawing are two views of the same thing and neither pointed
   * at the other.
   */
  highlightPath: number | null;
  /**
   * A mode a view has asked to be taken to, for the app to act on and clear.
   *
   * Which document kind is on screen belongs to the app rather than to this
   * store -- Draw and Assemble have their own documents entirely, and putting
   * the switch here would give a font store an opinion about fonts it does not
   * hold. But a view sometimes knows where somebody should be going and cannot
   * take them: the empty font grid is the clearest case, because the person
   * standing in front of it may well have arrived wanting to draw a typeface
   * rather than open one, and that lives in a mode this view cannot reach.
   *
   * So it asks. One field, set by the view and cleared by the app the moment it
   * has acted, which keeps the request from firing twice.
   */
  wantsMode: string | null;
  /**
   * Which ground the type is drawn on, where type is looked at.
   *
   * Only the canvas and the proof page change: the chrome stays dark, because
   * this is not a theme. Black type on white is the thing being made, and a
   * face judged only on a dark ground is a face nobody has looked at yet --
   * the eye reads weight differently against the two, and a stem that looks
   * right in white on black is a shade heavy in black on white.
   */
  ground: "dark" | "light";
  /** Name of the glyph open in the editor. */
  selectedGlyph: string | null;
  /** Selected nodes within the open glyph, keyed by `contour:node`. */
  selectedNodes: ReadonlySet<string>;
  /** Glyph names selected in the grid, for bulk operations. */
  selectedGlyphs: ReadonlySet<string>;
  search: string;
  previewText: string;
  /**
   * What just happened, and where it happened if that matters.
   *
   * `about` names the half of the application the message belongs to, and is
   * left off for the ones that belong everywhere -- a refusal to navigate, for
   * instance, which is about the person's next move rather than about a
   * document. Without it the line is global, so "Opened — 6,253 glyphs" from
   * the editor sat in the bar over Draw with "Untitled Sans" named beside it:
   * two documents in one strip, one of them not the one on screen.
   */
  status: {
    message: string;
    tone: "info" | "error" | "success";
    about?: "edit" | "forge" | "assemble" | "quill";
  } | null;
  busy: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /**
   * What Undo would take back, and what Redo would put back, by name.
   *
   * Every entry on the stack already carried a label and nothing ever showed
   * it, so pressing Undo took something back without saying what -- which on a
   * screen where the change was small, or off the top of a panel, or in another
   * letter entirely, is indistinguishable from pressing nothing at all.
   */
  undoLabel: string | null;
  redoLabel: string | null;
  /**
   * The letter on loan from a generator, or nothing.
   *
   * Read by the editor so it can say whose letter this is and offer the two ways
   * out, and by the application so the tabs cannot be used to walk away from a
   * loan without answering for it.
   */
  loan: Loan | null;
  /**
   * Every weight of this typeface that is drawn rather than calculated, and
   * which of them is being drawn now.
   *
   * There is always at least one while a font is open, including in the
   * overwhelmingly common case of a font that will only ever have one -- so
   * nothing anywhere has to ask whether this is a document with masters. The
   * interface shows nothing at all until there are two.
   *
   * `typeface` above is the active master's own typeface object, not a copy of
   * it, so every edit lands in the weight it was made in without anything
   * having to be written back.
   */
  masters: Master[];
  /** The id of the one being drawn. */
  master: string;
  /**
   * A place in the design space to *look* at, as opposed to a version drawn.
   *
   * A location rather than a number, because there can be more than one axis: a
   * font with a Bold and a Condensed is looked at somewhere in a square, not
   * somewhere along a line. Null almost always, and null is not a position --
   * the grid draws what is drawn.
   *
   * Looking, not editing. Nothing writes through this: the letters on screen
   * are a calculation and the drawing underneath is untouched.
   */
  preview: Record<string, number> | null;
  /** Bumped whenever the document changes, so views can memoise against it. */
  revision: number;
  /**
   * What the checks last said, and which revision of the font they said it of.
   *
   * This used to live inside the Checks view, which meant nothing else could
   * know whether a font had faults. The line under the top bar could not point
   * at them, the tab could not carry a count, and a person had to remember to
   * go and look. A fault nobody is told about is a fault that ships.
   *
   * `at` is the revision the findings were read from, so a font edited since is
   * a report known to be stale rather than one quietly believed.
   */
  checks: { findings: Finding[]; at: number } | null;
  /**
   * What the last edit to a control letter pushed out to the rest of the font,
   * so the change can be shown rather than just silently happening.
   */
  lastDerivation: ControlChange[];
}

export interface HistoryEntry {
  label: string;
  undo: () => void;
  redo: () => void;
}
