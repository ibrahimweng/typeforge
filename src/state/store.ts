/**
 * Application state.
 *
 * A small observable store rather than a state library: the document is one
 * object, edits are explicit, and React subscribes through
 * `useSyncExternalStore`. That keeps the hot paths — dragging a node, moving a
 * slider — free of framework overhead.
 *
 * History records only the glyphs an edit touched, not the whole typeface. A
 * font of six thousand glyphs would make full snapshots far too expensive to
 * take on every drag.
 */

import { applyEdits, fromBase64, type EditedProject } from "@/project/format";
import { buildAccents, deriveAnchors, suggestAnchors, looksLikeMark } from "@/font/accents";
import { buildsOn, dependentsOf } from "@/font/composite";
/*
 * Renamed on the way in, because the store's own methods are called the same
 * things. Both resolve correctly -- a bare name inside a method is the module
 * one -- but which is meant should not be something a reader has to work out.
 */
import {
  addGlyph as putGlyphIn,
  claimedBy,
  duplicateGlyph as copyGlyphTo,
  freeNameNear,
  NOTDEF,
  nameIsFree,
  notdefGlyph,
  removeGlyph as takeGlyphOut,
  renameGlyph as callGlyph,
} from "@/font/library";
import {
  addLigature as putLigatureIn,
  addToSet as putInSet,
  removeFromSet as takeOutOfSet,
  removeLigature as takeLigatureOut,
} from "@/font/features";
import { reverse as reverseContour } from "@/font/outline";
import { NEARLY_STRAIGHT, offSmooth } from "@/font/marks";
import { groupOf, nextIn, toolsIn, type GroupId as Group, type ToolId as Tool } from "@/font/toolset";
import { retracted, simplified, withPointOn, withoutPoint } from "@/font/pen";
import {
  deriveParams,
  isControlGlyph,
  readControls,
  type ControlChange,
  type ControlReadings,
} from "@/font/control";
import { buildLinks, pointsThatMoved, propagateMoves, type LinkMap } from "@/font/link";
import { importFont } from "@/font/parse";
import { effectiveParams } from "@/font/transform";
import {
  noCuts,
  NO_CUTS,
  sameCut,
  type CutName,
  type Cuts,
} from "@/font/cuts";
import { noCast, NO_CAST, sameCast, type Cast, type CastName } from "@/font/cast";
import {
  DEFAULT_PARAMS,
  type Anchor,
  emptyTypeface,
  type Glyph,
  type Contour,
  type GlyphParams,
  type KernClass,
  type KernPair,
  type Typeface,
  type VerticalMetrics,
  type Vec2,
} from "@/font/types";
/**
 * The bundled sample, as a URL rather than as bytes: Vite emits it as a hashed
 * asset the browser caches like any other, instead of inlining 47KB of font
 * into the JavaScript everybody downloads whether they use it or not.
 */
import sampleFontUrl from "@/assets/typeforge-sample.ttf?url";
import { readUfo, writeUfo, type UfoCarried, type UfoFiles } from "@/ufo/font";
import { correctDirection, dominantConvention, insertExtrema } from "@/font/outline";
import { strokeToContour } from "@/font/freehand";
import { isClockwise, reverseContour as flipContour } from "@/font/geometry";
import { slice } from "@/font/knife";
import { POLYGON_SIDES, shapeFrom, type Box, type ShapeKind } from "@/font/shapes";
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

/** What the sample is called once it is open, as any other file would be. */
const SAMPLE_FILE_NAME = "TypeforgeSample-Regular.ttf";

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
  status: { message: string; tone: "info" | "error" | "success" } | null;
  busy: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /**
   * The letter on loan from a generator, or nothing.
   *
   * Read by the editor so it can say whose letter this is and offer the two ways
   * out, and by the application so the tabs cannot be used to walk away from a
   * loan without answering for it.
   */
  loan: Loan | null;
  /** Bumped whenever the document changes, so views can memoise against it. */
  revision: number;
  /**
   * What the last edit to a control letter pushed out to the rest of the font,
   * so the change can be shown rather than just silently happening.
   */
  lastDerivation: ControlChange[];
}

interface HistoryEntry {
  label: string;
  undo: () => void;
  redo: () => void;
}

const MAX_HISTORY = 200;

class Store {
  /** The control letters as the font was opened, never updated afterwards. */
  /**
   * What the open UFO holds that this application does not model.
   *
   * Kept off `AppState` deliberately: nothing renders from it and it is a
   * megabyte of somebody's background layers, so putting it in the state
   * would have every subscriber re-render whenever it changed and every
   * snapshot carry it.
   */
  private ufo: UfoCarried | null = null;

  private controlBaseline: ControlReadings | null = null;
  /**
   * Their outlines at that same moment, kept because the fit needs the shape it
   * is fitting from. Once a letter is edited the old outline is gone from the
   * document, and fitting the edited shape against its own measurements derives
   * nothing.
   */
  private controlOutlines = new Map<string, Contour[]>();
  /**
   * Which points elsewhere follow each control letter's points, worked out once
   * from the font as opened. Rebuilding these after every edit would relink a
   * letter to wherever its points had just been dragged.
   */
  private controlLinks = new Map<string, LinkMap>();

  private state: AppState = {
    typeface: null,
    fileName: "",
    openWarnings: [],
    view: "grid",
    tool: "select",
    lastInGroup: { select: "select", pen: "pen", shape: "rectangle", knife: "knife" },
    toolState: { phase: "idle", says: "" },
    /*
     * `n` on both sides, which is where a type designer starts.
     *
     * A letter is spaced against the ones it will actually stand between, and
     * the lowercase `n` is the conventional first neighbour because its two
     * stems are straight and evenly spaced -- so any unevenness in the gap
     * belongs to the letter under test rather than to the letter beside it.
     */
    context: { before: "n", after: "n" },
    guides: [],
    snapping: true,
    marks: false,
    polygonSides: POLYGON_SIDES,
    drawing: false,
    highlightPath: null,
    wantsMode: null,
    ground: "dark",
    selectedGlyph: null,
    selectedNodes: new Set(),
    selectedGlyphs: new Set(),
    search: "",
    previewText: "Hamburgefonstiv",
    status: null,
    lastDerivation: [],
    busy: false,
    canUndo: false,
    canRedo: false,
    loan: null,
    revision: 0,
  };

  private listeners = new Set<() => void>();
  /** What was on the desk before a letter was borrowed, put aside whole. */
  private held: {
    state: AppState;
    undoStack: HistoryEntry[];
    redoStack: HistoryEntry[];
    ufo: UfoCarried | null;
    controlBaseline: ControlReadings | null;
  } | null = null;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AppState => this.state;

  private set(partial: Partial<AppState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener();
  }

  /** Signal that the document changed, so views re-render. */
  private touch(): void {
    this.set({
      revision: this.state.revision + 1,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    });
  }

  // --- document ---------------------------------------------------------

  /**
   * Take a typeface that has already been read.
   *
   * The library has parsed the file to measure it, and parsing a few thousand
   * glyphs twice to put the same font on screen would be a second of nothing
   * happening for no reason at all.
   */
  adopt(typeface: Typeface, fileName: string): void {
    this.forgetLoan();
    this.undoStack = [];
    this.redoStack = [];
    this.controlBaseline = readControls(typeface);
    // Whatever the last UFO carried belongs to the last UFO. Left in place, a
    // font opened afterwards would go out with somebody else's background
    // layers folded into it.
    this.ufo = null;
    this.set({
      typeface,
      fileName,
      // Whatever the last file had to say belongs to the last file.
      openWarnings: [],
      selectedGlyph: firstLetterName(typeface),
      selectedNodes: new Set(),
      selectedGlyphs: new Set(),
      /*
       * Guides go with the font they were drawn against.
       *
       * They are kept in font units, and font units are not the same size from
       * one font to the next: a guide at 500 is the x-height of a
       * thousand-unit font and a quarter of the way up a two-thousand-unit
       * one. Left in place, they would arrive over the new font meaning
       * something else entirely.
       */
      guides: [],
      busy: false,
      status: {
        message: `Opened — ${typeface.glyphs.length.toLocaleString()} glyphs`,
        tone: "success",
      },
    });
    this.touch();
  }

  /** Say something in the toolbar, for anything that has no view of its own. */
  say(message: string, tone: "info" | "error" | "success" = "success"): void {
    this.set({ status: { message, tone } });
  }

  /** The edited half, for writing down. */
  snapshot(): { typeface: Typeface; fileName: string } | undefined {
    /*
     * The document of record, which during a loan is not the one on screen.
     *
     * A letter borrowed from Draw sits in a typeface of its own with one glyph
     * in it. That is a desk, not a document, and it must never be what gets
     * written down: the session is saved on a timer as well as on the button, so
     * without this a minute spent moving points on a borrowed `n` would quietly
     * replace whatever font was open with a font containing an `n`. The drawing
     * goes back to Draw and is saved as part of *that* half.
     */
    const { typeface, fileName } = this.held ? this.held.state : this.state;
    return typeface ? { typeface, fileName } : undefined;
  }

  /**
   * Put a saved font back.
   *
   * The file is read again from its own bytes and the saved glyphs are laid
   * over the top, rather than the whole document being restored from the
   * document. That keeps the source tables -- the hinting, the colour, the
   * variations, everything "preserve" export hands back untouched -- which a
   * document made of glyphs would have quietly thrown away.
   */
  async restore(saved: EditedProject): Promise<void> {
    await this.loadFont(fromBase64(saved.font), saved.fileName);
    const { typeface } = this.state;
    if (!typeface) return;
    applyEdits(typeface, saved);
    this.undoStack = [];
    this.redoStack = [];
    this.set({
      status: {
        message: `Reopened — ${saved.glyphs.length.toLocaleString()} ${
          saved.glyphs.length === 1 ? "glyph" : "glyphs"
        } of your own`,
        tone: "success",
      },
    });
    this.touch();
  }

  async loadFont(bytes: Uint8Array, fileName: string): Promise<void> {
    this.forgetLoan();
    this.set({ busy: true, status: { message: `Reading ${fileName}…`, tone: "info" } });
    try {
      const { typeface, warnings } = await importFont(bytes, fileName);
      this.undoStack = [];
      this.redoStack = [];
      // A compiled font has no UFO behind it, and the one that was open
      // before is not this font's to carry.
      this.ufo = null;
      // The control letters as they arrived. Every later derivation compares
      // against this rather than against the previous edit, so editing n twice
      // expresses the total change instead of compounding.
      this.controlBaseline = readControls(typeface);
      this.set({
        typeface,
        fileName,
        openWarnings: warnings,
        selectedGlyph: firstLetterName(typeface),
        selectedNodes: new Set(),
        selectedGlyphs: new Set(),
        busy: false,
        status: {
          /*
           * What happened, not what it is called.
           *
           * The family name sits permanently in the bar a few inches to the
           * left, so repeating it here put the same font's name on screen
           * twice, and the copy that was truncated to fit was this one. A
           * status line's job is to say what just happened; the identity of
           * the open document is the label's job, and it already does it.
           */
          message: `Opened — ${typeface.glyphs.length.toLocaleString()} glyphs${
            warnings.length ? `, with ${warnings.length === 1 ? "a note" : `${warnings.length} notes`} in Checks` : ""
          }`,
          tone: "success",
        },
      });
      this.touch();
    } catch (error) {
      this.set({
        busy: false,
        status: {
          message: error instanceof Error ? error.message : "That font could not be read.",
          tone: "error",
        },
      });
    }
  }

  /**
   * Open a UFO, which is a folder rather than a file.
   *
   * The other half of `loadFont`, and the difference is what arrives: bytes
   * there, a set of paths and their contents here. Everything about the format
   * lives in `src/ufo`, so this is only the part that has to be a store
   * action -- putting the font in front of somebody and remembering enough to
   * hand their folder back unharmed.
   *
   * `carried` is that remembering. A UFO holds things this application has no
   * idea about: background layers, private keys another tool left in the lib,
   * the images somebody is tracing over. They are kept beside the typeface and
   * written back on the way out, because opening somebody's work in progress
   * and quietly dropping half of it on save is not opening it.
   */
  async loadUfo(files: UfoFiles, folderName: string): Promise<void> {
    this.set({ busy: true, status: { message: `Reading ${folderName}…`, tone: "info" } });
    try {
      const read = readUfo(files);
      if (!read) throw new Error("That folder is not a UFO: it has no metainfo.plist in it.");
      const { typeface, carried } = read;
      if (typeface.glyphs.length === 0) {
        throw new Error("That UFO has no glyphs in it.");
      }
      this.undoStack = [];
      this.redoStack = [];
      this.controlBaseline = readControls(typeface);
      this.ufo = carried;
      this.set({
        typeface,
        fileName: folderName,
        selectedGlyph: firstLetterName(typeface),
        selectedNodes: new Set(),
        selectedGlyphs: new Set(),
        busy: false,
        status: {
          message: `Opened — ${typeface.glyphs.length.toLocaleString()} glyphs`,
          tone: "success",
        },
      });
      this.touch();
    } catch (error) {
      this.set({
        busy: false,
        status: {
          message: error instanceof Error ? error.message : "That folder could not be read.",
          tone: "error",
        },
      });
    }
  }

  /**
   * The font as a UFO, with whatever came in with it put back.
   *
   * Answers for a font that never was one too: a drawing made here, or a
   * TrueType file opened here, goes out as a UFO with nothing carried, which
   * is a perfectly ordinary UFO that simply has no history behind it.
   */
  ufoFiles(): UfoFiles | null {
    const typeface = this.state.typeface;
    if (!typeface) return null;
    return writeUfo(typeface, this.ufo ?? undefined);
  }

  /**
   * Open the font that ships with the tool.
   *
   * Nothing in Typeforge does anything until a font is open, so without this
   * the first thing it asks of someone who has just arrived is that they go and
   * find a .ttf on their disk. The sample is a subset of DejaVu Sans, renamed
   * as its licence requires; see LICENSE-sample-font.txt.
   */
  async loadSample(): Promise<void> {
    this.set({ busy: true, status: { message: "Opening the sample…", tone: "info" } });
    try {
      const response = await fetch(sampleFontUrl);
      if (!response.ok) throw new Error(`The sample font could not be read (${response.status}).`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      await this.loadFont(bytes, SAMPLE_FILE_NAME);
    } catch (error) {
      this.set({
        busy: false,
        status: {
          message: error instanceof Error ? error.message : "The sample font could not be read.",
          tone: "error",
        },
      });
    }
  }

  startBlank(): void {
    this.forgetLoan();
    this.undoStack = [];
    this.redoStack = [];
    /*
     * With a `.notdef` already in it.
     *
     * A new font used to fail its own checks on the first thing it said:
     * `No .notdef glyph`, an error, about a font nobody had touched yet. And
     * `.notdef` is not a design decision -- it is what the format draws for a
     * character the font does not cover, and every font must have one. Making
     * somebody add it by hand, by name, to get a clean report is asking them
     * to know a piece of trivia before they can draw anything.
     */
    const fresh = emptyTypeface();
    fresh.glyphs = [notdefGlyph(fresh.metrics)];
    fresh.glyphIndex = new Map([[NOTDEF, 0]]);
    this.set({
      typeface: fresh,
      fileName: "",
      openWarnings: [],
      selectedGlyph: null,
      selectedNodes: new Set(),
      selectedGlyphs: new Set(),
      guides: [],
      status: null,
    });
    this.captureControlBaseline();
    this.touch();
  }

  // --- a letter on loan ---------------------------------------------------

  /**
   * Put a generator's letter on the desk, on its own, with the tools on it.
   *
   * The metrics come across with it and are not a detail. A letter is drawn
   * against its own baseline, x-height and cap height; dropped into a document
   * whose lines are somewhere else it would arrive floating in the wrong place
   * with every guide lying about it -- and the tools that snap would snap it to
   * the lie.
   *
   * Whatever was open goes into `held` whole rather than being saved field by
   * field, because a loan is a parenthesis: what comes back has to be what went
   * in, including the two history stacks. Undoing past the start of a loan and
   * finding yourself unpicking a font you opened an hour ago would be the worst
   * kind of surprise, so the loan starts with an empty history of its own and
   * the real one is handed back at the end.
   */
  borrowLetter(
    loan: Loan,
    glyph: Glyph,
    of: { unitsPerEm: number; metrics: VerticalMetrics },
  ): void {
    if (this.held) return;
    this.held = {
      state: this.state,
      undoStack: this.undoStack,
      redoStack: this.redoStack,
      ufo: this.ufo,
      controlBaseline: this.controlBaseline,
    };
    this.undoStack = [];
    this.redoStack = [];
    this.ufo = null;
    this.controlBaseline = null;

    const desk = emptyTypeface();
    desk.meta = { ...desk.meta, familyName: loan.family || "Untitled" };
    desk.unitsPerEm = of.unitsPerEm;
    desk.metrics = { ...of.metrics };
    desk.glyphs = [glyph];
    desk.glyphIndex = new Map([[glyph.name, 0]]);

    this.set({
      typeface: desk,
      fileName: "",
      openWarnings: [],
      view: "glyph",
      selectedGlyph: glyph.name,
      selectedNodes: new Set(),
      selectedGlyphs: new Set(),
      /*
       * The guides belonged to the font that has just been put aside, and a
       * guide is a number of font units: at 500 it is the x-height of a
       * thousand-unit font and a quarter of the way up a two-thousand-unit one.
       * Left in place they would stand over this letter meaning something else.
       */
      guides: [],
      drawing: false,
      highlightPath: null,
      loan,
      status: {
        /*
         * What is true now, rather than what will be true if it is kept.
         *
         * The letter has not left anything yet: nothing has changed in the
         * drawn font, and throwing the loan away leaves it exactly as it was.
         * Saying it has already gone would be the same sentence whether you
         * went on to keep it or not, which makes it useless for telling.
         */
        message: `${loan.letter} is on the desk — keep the drawing or throw it away when you are done`,
        tone: "info",
      },
    });
    this.touch();
  }

  /**
   * Take the letter off the desk and give back what it turned into.
   *
   * The advance goes back with the outline, because the letter has to keep its
   * place in the rhythm of the font: a shape drawn a little narrower than the
   * one it replaces should still sit in the width it was given, or the spacing
   * gains a hole nobody asked for. What the caller does with the pair is the
   * caller's business -- this store has no idea there is a forge.
   */
  keepLoan(): { letter: string; contours: Contour[]; advanceWidth: number } | null {
    const loan = this.state.loan;
    if (!loan) return null;
    /*
     * Found by name rather than by what happens to be selected.
     *
     * Reading the selection would hand back nothing at all if the last click had
     * landed on empty canvas, and "nothing" here means the drawing is thrown
     * away -- which is not a thing to leave resting on where a pointer was. The
     * desk holds one glyph and its name is the letter.
     */
    const drawn = this.glyph(loan.letter) ?? this.state.typeface?.glyphs[0] ?? null;
    const kept = drawn
      ? {
          letter: loan.letter,
          contours: cloneGlyph(drawn).contours,
          advanceWidth: drawn.advanceWidth,
        }
      : null;
    this.dropLoan();
    return kept;
  }

  /**
   * Let go of a loan without putting anything back, because something else has
   * taken the desk.
   *
   * Opening a font, restoring a project or starting a blank one all replace the
   * document outright -- they clear the history stacks too, which is the same
   * decision about the same work. Putting the held document back afterwards
   * would restore the font somebody had just chosen to leave, over the top of
   * the one they had just chosen to open.
   */
  private forgetLoan(): void {
    this.held = null;
    if (this.state.loan) this.set({ loan: null });
  }

  /** End the loan and put back what was on the desk, keeping nothing. */
  dropLoan(): void {
    const held = this.held;
    if (!held) return;
    this.held = null;
    this.undoStack = held.undoStack;
    this.redoStack = held.redoStack;
    this.ufo = held.ufo;
    this.controlBaseline = held.controlBaseline;
    this.state = { ...held.state, loan: null };
    // `touch` is what tells everybody, and it recomputes whether undo and redo
    // are live from the stacks that have just come back.
    this.touch();
  }

  // --- navigation -------------------------------------------------------

  setView(view: ViewId): void {
    this.set({ view });
  }
  /**
   * What the tool in hand is doing.
   *
   * Set from the canvas as a gesture runs. Compared before it is stored,
   * because this fires on every pointer move and a `set` that changes nothing
   * still re-renders every subscriber -- which on a canvas redrawing six
   * thousand glyph outlines is the difference between a drag that follows the
   * pointer and one that does not.
   */
  setToolState(next: ToolState): void {
    const now = this.state.toolState;
    if (now.phase === next.phase && now.says === next.says) return;
    this.set({ toolState: next });
  }

  setTool(tool: Tool): void {
    /*
     * Picking the tool you already have changes nothing, and must say nothing.
     *
     * Clearing the phase is what stops a stale sentence from the last tool
     * sitting under the new one, and the editor fills it back in on a change of
     * tool. Cleared without a change there is nothing to fill it back in, so the
     * line went blank and fell through to its default -- which is how choosing
     * the rectangle from the flyout while already holding the rectangle left
     * `Select one point to type its position` under a rectangle tool.
     */
    if (tool === this.state.tool) return;
    // A tool picked up mid-anything starts from nothing, which is also what
    // stops a stale sentence from the last tool sitting under the new one.
    this.set({
      tool,
      lastInGroup: { ...this.state.lastInGroup, [groupOf(tool)]: tool },
      toolState: { phase: "idle", says: "" },
    });
  }

  /**
   * Take up a group: the tool you last used from it, or the next one along if
   * you are already in it.
   *
   * What the group's single key does, and what its button does. The second
   * press walking the group is how every drawing program spends it, and it is
   * the only way to reach a tool without opening the flyout.
   */
  takeUpGroup(group: Group): void {
    const inGroup = toolsIn(group).some((one) => one.id === this.state.tool);
    this.setTool(inGroup ? nextIn(group, this.state.tool) : this.state.lastInGroup[group]);
  }
  /** Change what stands either side of the glyph being edited. */
  setContext(context: Partial<AppState["context"]>): void {
    this.set({ context: { ...this.state.context, ...context } });
  }

  /**
   * Swap the ground the type is drawn on.
   *
   * Only state. The two surfaces that honour it render the attribute
   * themselves, which is what keeps this from being a theme and what keeps
   * the store out of the document.
   *
   * It was briefly the other way round -- an effect writing the attribute on
   * the root -- and that is worth recording, because the failure was not
   * obvious. Effects fire child before parent, so every canvas repainted
   * before the attribute landed, read `--glyph-fill` off a root that still
   * said dark, and drew near-white letters on the new white page; the
   * attribute arrived a moment later with nothing left to repaint. Rendering
   * it removes the question: React commits the attribute before it runs the
   * effect that paints.
   */
  setGround(ground: AppState["ground"]): void {
    this.set({ ground });
  }

  /** Put a guide across the canvas or down it, in font units. */
  addGuide(at: number, axis: "x" | "y" = "y"): void {
    this.set({ guides: [...this.state.guides, { axis, at: Math.round(at) }] });
  }

  /** Move one, while it is being dragged. Its axis is fixed when it is made. */
  moveGuide(index: number, at: number): void {
    const guides = this.state.guides.map((one, position) =>
      position === index ? { ...one, at: Math.round(at) } : one,
    );
    this.set({ guides });
  }

  removeGuide(index: number): void {
    this.set({ guides: this.state.guides.filter((_, at) => at !== index) });
  }

  clearGuides(): void {
    if (this.state.guides.length === 0) return;
    this.set({ guides: [] });
  }

  /**
   * Whether a dragged point is pulled onto the lines worth landing on.
   *
   * On to begin with, and a switch rather than a modifier because the two
   * modifiers a drag already uses are taken: shift holds a drag to one axis
   * and alt pans the canvas. A third would be a chord nobody would find.
   */
  setSnapping(snapping: boolean): void {
    this.set({ snapping });
  }

  /** Whether the canvas rings the faults that cannot be seen by looking. */
  /** Light one path on the canvas, or none. Compared before storing, because
   * this fires on every pointer move across the list and each change repaints
   * the whole canvas. */
  setHighlightPath(index: number | null): void {
    if (this.state.highlightPath !== index) this.set({ highlightPath: index });
  }

  /** Ask the app to change document kind, from a view that cannot. */
  askForMode(mode: string): void {
    this.set({ wantsMode: mode });
  }

  /** The app has acted on the request and it must not fire again. */
  modeAsked(): void {
    if (this.state.wantsMode !== null) this.set({ wantsMode: null });
  }

  /** The pen has begun, or gone on with, an outline. */
  startDrawing(): void {
    if (!this.state.drawing) this.set({ drawing: true });
  }

  setPolygonSides(sides: number): void {
    this.set({ polygonSides: Math.max(3, Math.min(24, Math.round(sides))) });
  }

  setMarks(marks: boolean): void {
    this.set({ marks });
  }
  setSearch(search: string): void {
    this.set({ search });
  }
  setPreviewText(previewText: string): void {
    this.set({ previewText });
  }
  setStatus(status: AppState["status"]): void {
    this.set({ status });
  }

  selectGlyph(name: string | null, options: { open?: boolean } = {}): void {
    this.set({
      selectedGlyph: name,
      selectedNodes: new Set(),
      view: options.open ? "glyph" : this.state.view,
    });
  }

  setSelectedNodes(keys: Iterable<string>): void {
    this.set({ selectedNodes: new Set(keys) });
  }

  /*
   * Picking points when there are a great many of them.
   *
   * A marquee and a click are the whole of what this had, which works up to
   * about a dozen points and stops working entirely on a traced or imported
   * outline of two hundred. The three below are what every editor offers
   * instead, and each answers a question a rubber band cannot: "this shape, not
   * the one behind it", "every corner, wherever they are", "the next one along
   * so I can walk the path".
   */

  /** Every point in the letter, or every point in one contour. */
  selectAllNodes(glyphName: string, contour?: number): void {
    const glyph = this.glyph(glyphName);
    if (!glyph) return;
    const keys: string[] = [];
    glyph.contours.forEach((one, at) => {
      if (contour !== undefined && at !== contour) return;
      one.nodes.forEach((_, node) => keys.push(nodeKey({ contour: at, node })));
    });
    this.setSelectedNodes(keys);
    this.say(
      keys.length === 0
        ? "Nothing to pick."
        : `${keys.length} ${keys.length === 1 ? "point" : "points"} picked.`,
      "info",
    );
  }

  /**
   * Every point of one kind.
   *
   * The one that saves the most work: "make every corner smooth" and "round
   * every corner onto the grid" are both a single operation once the corners
   * are picked, and picking them by hand on a letter with forty of them is the
   * reason nobody does it.
   *
   * Asks the geometry rather than the stored type where the two can disagree: a
   * node typed `smooth` whose handles are twenty degrees apart is a corner to
   * everything that reads the font, whatever the file calls it.
   *
   * A point with fewer than two handles has no angle to measure and counts as a
   * corner, which is right for the case that matters -- every point of a square
   * -- and arguable for a tangent, where a straight runs into a curve. `Smooth`
   * is the operation somebody reaches for after picking, and running it on a
   * tangent does nothing, so the cost of the arguable case is nothing.
   */
  selectNodesOfKind(glyphName: string, kind: "corner" | "smooth" | "handleless"): void {
    const glyph = this.glyph(glyphName);
    if (!glyph) return;
    const keys: string[] = [];
    glyph.contours.forEach((one, at) => {
      one.nodes.forEach((node, index) => {
        const off = offSmooth(node);
        const matches =
          kind === "handleless"
            ? !node.handleIn && !node.handleOut
            : off === null
              ? kind === "corner"
              : kind === "smooth"
                ? off <= NEARLY_STRAIGHT
                : off > NEARLY_STRAIGHT;
        if (matches) keys.push(nodeKey({ contour: at, node: index }));
      });
    });
    this.setSelectedNodes(keys);
    const named = kind === "handleless" ? "straight-line points" : `${kind} points`;
    this.say(keys.length === 0 ? `No ${named}.` : `${keys.length} ${named} picked.`, "info");
  }

  /**
   * The next point along the path, which is how a path gets walked.
   *
   * Tab in every drawing program there is, and the only way to inspect a
   * hundred-point outline point by point without hunting for each with the
   * pointer. Wraps within the contour rather than running off the end, because
   * a contour is a loop and walking one should be able to go round.
   */
  stepSelection(glyphName: string, by: 1 | -1): void {
    const glyph = this.glyph(glyphName);
    if (!glyph || glyph.contours.length === 0) return;

    const picked = [...this.state.selectedNodes].map((key) => {
      const [contour, node] = key.split(":").map(Number);
      return { contour, node };
    });
    // From nothing, start at the first point rather than nowhere.
    const from = picked[picked.length - 1] ?? { contour: 0, node: by === 1 ? -1 : 0 };
    const contour = glyph.contours[from.contour];
    if (!contour || contour.nodes.length === 0) return;
    const count = contour.nodes.length;
    const next = ((from.node + by) % count + count) % count;
    this.setSelectedNodes([nodeKey({ contour: from.contour, node: next })]);
  }

  toggleGlyphSelection(name: string, additive: boolean): void {
    const next = new Set(additive ? this.state.selectedGlyphs : []);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    this.set({ selectedGlyphs: next });
  }

  clearGlyphSelection(): void {
    this.set({ selectedGlyphs: new Set() });
  }

  // --- editing ----------------------------------------------------------

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
          nodes: contour.nodes.filter((_, node) =>
            picked.has(nodeKey({ contour: index, node })),
          ),
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
          picked.has(nodeKey({ contour: index, node: at }))
            ? transformNode(node, transform)
            : node,
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
    const contour =
      drawn.closed && isClockwise(drawn) !== clockwise ? flipContour(drawn) : drawn;

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
    this.set({ selectedNodes: new Set([nodeKey({ contour: contourIndex, node: wraps ? 0 : at })]) });
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
    if (!glyph || !one || !one.closed || one.nodes.length < 3) return false;

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
    const after = this.glyph(glyphName)!.contours.reduce((total, one) => total + one.nodes.length, 0);
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

  // --- anchors and components -------------------------------------------

  /** Move an anchor, or add it if the glyph does not carry one by that name. */
  setAnchor(glyphName: string, name: string, x: number, y: number): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const index = typeface.glyphIndex.get(glyphName);
    if (index === undefined) return;

    const glyph = typeface.glyphs[index];
    const before = glyph.anchors.map((a) => ({ ...a }));
    const existing = glyph.anchors.find((a) => a.name === name);
    if (existing) {
      existing.x = Math.round(x);
      existing.y = Math.round(y);
    } else {
      glyph.anchors.push({ name, x: Math.round(x), y: Math.round(y) });
    }
    const after = glyph.anchors.map((a) => ({ ...a }));

    this.push({
      label: `Move ${name} anchor`,
      undo: () => {
        typeface.glyphs[index].anchors = before.map((a) => ({ ...a }));
      },
      redo: () => {
        typeface.glyphs[index].anchors = after.map((a) => ({ ...a }));
      },
    });
    this.touch();
  }

  /** Live anchor movement during a drag; history is recorded on release. */
  setAnchorLive(glyphName: string, name: string, x: number, y: number): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const index = typeface.glyphIndex.get(glyphName);
    if (index === undefined) return;
    const glyph = typeface.glyphs[index];
    const existing = glyph.anchors.find((a) => a.name === name);
    if (existing) {
      existing.x = Math.round(x);
      existing.y = Math.round(y);
    } else {
      glyph.anchors.push({ name, x: Math.round(x), y: Math.round(y) });
    }
    this.touch();
  }

  removeAnchor(glyphName: string, name: string): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const index = typeface.glyphIndex.get(glyphName);
    if (index === undefined) return;
    const glyph = typeface.glyphs[index];
    const before = glyph.anchors.map((a) => ({ ...a }));
    const after = before.filter((a) => a.name !== name);
    glyph.anchors = after.map((a) => ({ ...a }));
    this.push({
      label: `Remove ${name} anchor`,
      undo: () => {
        typeface.glyphs[index].anchors = before.map((a) => ({ ...a }));
      },
      redo: () => {
        typeface.glyphs[index].anchors = after.map((a) => ({ ...a }));
      },
    });
    this.touch();
  }

  anchorsFor(glyphName: string): Anchor[] {
    return this.glyph(glyphName)?.anchors ?? [];
  }

  /** Put default anchors on a glyph, as a starting position to drag from. */
  suggestAnchorsFor(glyphName: string): void {
    const typeface = this.state.typeface;
    const glyph = this.glyph(glyphName);
    if (!typeface || !glyph) return;
    const before = glyph.anchors.map((a) => ({ ...a }));
    const after = suggestAnchors(glyph, typeface, looksLikeMark(glyph));
    if (after.length === 0) return;

    const index = typeface.glyphIndex.get(glyphName)!;
    typeface.glyphs[index].anchors = after;
    this.push({
      label: "Suggest anchors",
      undo: () => {
        typeface.glyphs[index].anchors = before.map((a) => ({ ...a }));
      },
      redo: () => {
        typeface.glyphs[index].anchors = after.map((a) => ({ ...a }));
      },
    });
    this.touch();
  }

  /** Read anchor positions out of the composites the font already has. */
  deriveAnchorsFromFont(): { bases: number; marks: number } {
    const typeface = this.state.typeface;
    if (!typeface) return { bases: 0, marks: 0 };
    const before = typeface.glyphs.map((g) => g.anchors.map((a) => ({ ...a })));
    const result = deriveAnchors(typeface);
    const after = typeface.glyphs.map((g) => g.anchors.map((a) => ({ ...a })));

    this.push({
      label: "Read anchors from the font",
      undo: () => {
        typeface.glyphs.forEach((g, i) => (g.anchors = before[i].map((a) => ({ ...a }))));
      },
      redo: () => {
        typeface.glyphs.forEach((g, i) => (g.anchors = after[i].map((a) => ({ ...a }))));
      },
    });
    this.touch();
    return result;
  }

  /** Build every accented letter the font has the parts for. */
  buildAccentedGlyphs(overwrite = false): { built: string[]; skipped: number } {
    const typeface = this.state.typeface;
    if (!typeface) return { built: [], skipped: 0 };

    const snapshot = typeface.glyphs.map(cloneGlyph);
    const result = buildAccents(typeface, { overwriteDrawn: overwrite });
    if (result.built.length === 0) return { built: [], skipped: result.skipped.length };

    const after = typeface.glyphs.map(cloneGlyph);
    this.push({
      label: `Build ${result.built.length} accented glyph${result.built.length === 1 ? "" : "s"}`,
      undo: () => {
        typeface.glyphs = snapshot.map(cloneGlyph);
      },
      redo: () => {
        typeface.glyphs = after.map(cloneGlyph);
      },
    });
    this.touch();
    return { built: result.built, skipped: result.skipped.length };
  }

  /** Glyphs that would change if this one were edited. */
  dependents(glyphName: string): string[] {
    const typeface = this.state.typeface;
    return typeface ? dependentsOf(typeface, glyphName) : [];
  }

  /**
   * Build a letter out of another one, by hand.
   *
   * `removeComponent` has always been here and nothing has ever added one
   * except the accent builder, which runs on its own -- so a letter could be
   * taken apart and never put together on purpose. Which is the wrong way
   * round: the reason components exist is that a correction to an `a` should
   * reach every letter built on it, and that is worth having on a `ffi` or a
   * `¼` as much as on an `á`.
   *
   * Refused where it would build a letter out of itself, directly or through a
   * chain of others. A component that refers back to its own letter is a
   * drawing with no bottom to it, and every renderer that meets one either
   * gives up or hangs.
   */
  addComponent(glyphName: string, part: string): boolean {
    const typeface = this.state.typeface;
    const glyph = this.glyph(glyphName);
    if (!typeface || !glyph || !typeface.glyphIndex.has(part)) return false;

    if (part === glyphName || buildsOn(typeface, part, glyphName)) {
      this.say(`${part} is already built from ${glyphName}, so this would have no bottom to it.`, "error");
      return false;
    }

    this.editGlyph(glyphName, "Add a part", (one) => {
      one.components = [
        ...one.components,
        { glyphName: part, transform: { a: 1, b: 0, c: 0, d: 1, dx: 0, dy: 0 } },
      ];
    });
    this.say(`${glyphName} is now built from ${part}. Drag it into place on the canvas.`, "success");
    return true;
  }

  removeComponent(glyphName: string, position: number): void {
    this.editGlyph(glyphName, "Remove component", (glyph) => {
      glyph.components.splice(position, 1);
    });
  }

  // --- kerning ----------------------------------------------------------

  setKerning(left: string, right: string, value: number): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const existingIndex = typeface.kerning.findIndex(
      (pair) => pair.left === left && pair.right === right,
    );
    const before: KernPair[] = typeface.kerning;

    const next = [...typeface.kerning];
    if (value === 0) {
      if (existingIndex >= 0) next.splice(existingIndex, 1);
    } else if (existingIndex >= 0) {
      next[existingIndex] = { left, right, value };
    } else {
      next.push({ left, right, value });
    }
    typeface.kerning = next;

    this.push({
      label: `Kern ${left}/${right}`,
      undo: () => {
        typeface.kerning = before;
      },
      redo: () => {
        typeface.kerning = next;
      },
    });
    this.touch();
  }

  /** Live kerning update during a drag; history is recorded on release. */
  setKerningLive(left: string, right: string, value: number): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const index = typeface.kerning.findIndex((pair) => pair.left === left && pair.right === right);
    if (value === 0) {
      if (index >= 0) typeface.kerning = typeface.kerning.filter((_, i) => i !== index);
    } else if (index >= 0) {
      const next = [...typeface.kerning];
      next[index] = { left, right, value };
      typeface.kerning = next;
    } else {
      typeface.kerning = [...typeface.kerning, { left, right, value }];
    }
    this.touch();
  }

  /**
   * Create a kerning class seeded from a pair.
   *
   * Class kerning is how a font avoids storing a value for every combination:
   * one entry covers every glyph on the left against every glyph on the right.
   * Starting from a pair the designer already chose is the natural way in.
   */
  addKernClass(left: string, right: string, value: number): string {
    const typeface = this.state.typeface;
    if (!typeface) return "";
    const id = `class-${typeface.kernClasses.length + 1}-${left}-${right}`;
    const created: KernClass = {
      id,
      name: `${left} / ${right}`,
      left: [left],
      right: [right],
      value,
    };
    const before = typeface.kernClasses;
    const next = [...before, created];
    typeface.kernClasses = next;
    this.push({
      label: "Add kerning class",
      undo: () => {
        typeface.kernClasses = before;
      },
      redo: () => {
        typeface.kernClasses = next;
      },
    });
    this.touch();
    return id;
  }

  updateKernClass(id: string, patch: Partial<Omit<KernClass, "id">>): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const before = typeface.kernClasses;
    const next = before.map((kernClass) =>
      kernClass.id === id ? { ...kernClass, ...patch } : kernClass,
    );
    typeface.kernClasses = next;
    this.push({
      label: "Edit kerning class",
      undo: () => {
        typeface.kernClasses = before;
      },
      redo: () => {
        typeface.kernClasses = next;
      },
    });
    this.touch();
  }

  removeKernClass(id: string): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const before = typeface.kernClasses;
    const next = before.filter((kernClass) => kernClass.id !== id);
    typeface.kernClasses = next;
    this.push({
      label: "Remove kerning class",
      undo: () => {
        typeface.kernClasses = before;
      },
      redo: () => {
        typeface.kernClasses = next;
      },
    });
    this.touch();
  }

  /**
   * The kerning that applies to a pair, individual value first.
   *
   * This mirrors how a shaper resolves it: the individual pair subtable is
   * listed before the class subtable in GPOS, so a specific value overrides the
   * class the pair belongs to.
   */
  resolvedKerning(left: string, right: string): { value: number; source: "pair" | "class" | "none" } {
    const typeface = this.state.typeface;
    if (!typeface) return { value: 0, source: "none" };
    const pair = typeface.kerning.find((entry) => entry.left === left && entry.right === right);
    if (pair) return { value: pair.value, source: "pair" };
    const kernClass = typeface.kernClasses.find(
      (entry) => entry.left.includes(left) && entry.right.includes(right),
    );
    if (kernClass) return { value: kernClass.value, source: "class" };
    return { value: 0, source: "none" };
  }

  kerningFor(left: string, right: string): number {
    const typeface = this.state.typeface;
    if (!typeface) return 0;
    return typeface.kerning.find((pair) => pair.left === left && pair.right === right)?.value ?? 0;
  }

  // --- metadata ---------------------------------------------------------

  /*
   * Making and unmaking letters.
   *
   * None of this existed, and its absence made `startBlank` a dead end: it
   * hands back a typeface with an empty glyph list, and there was no way to
   * put anything into it.
   *
   * All of them go through `editFont` below rather than `editGlyph`, because
   * every one changes something outside a single glyph -- the glyph list, the
   * index, the kerning, the classes, the ligature rules -- and undo has to put
   * all of it back.
   */

  /**
   * One structural change to the font, with an undo that restores all of it.
   *
   * `editGlyph` snapshots one letter, which is right for redrawing one and
   * useless here: renaming `a` rewrites kern pairs, class memberships,
   * ligature rules and the components of every letter built on it. So this
   * snapshots every collection a name can be written into and puts them all
   * back together.
   *
   * Every one of them, taken from the one list that says how many there are --
   * `library.ts` names eight places and this has to hold all of them. It held
   * five, which was right until a ligature could be made by hand and then was
   * an undo that took the letter back and left the rule pointing at it.
   *
   * The copies are shallow, which is what makes this cheap enough to do on a
   * font of six thousand letters: the library functions replace the arrays
   * they change rather than reaching into them, so holding the old arrays is
   * enough to hold the old state.
   */
  private editFont(label: string, mutate: (typeface: Typeface) => boolean): boolean {
    const typeface = this.state.typeface;
    if (!typeface) return false;

    const hold = (one: Typeface) => ({
      glyphs: one.glyphs,
      glyphIndex: one.glyphIndex,
      kerning: one.kerning,
      kernClasses: one.kernClasses,
      alternates: one.alternates,
      ligatures: one.ligatures,
      sets: one.sets,
    });

    const before = hold(typeface);
    if (!mutate(typeface)) return false;
    const after = hold(typeface);

    this.push({
      label,
      undo: () => Object.assign(typeface, before),
      redo: () => Object.assign(typeface, after),
    });
    this.touch();
    return true;
  }

  /** Put a new, empty letter in the font and open it. */
  addGlyph(name: string, unicodes: number[] = []): boolean {
    const typeface = this.state.typeface;
    if (!typeface) return false;
    const wanted = name.trim();
    if (wanted.length === 0) {
      this.say("A letter needs a name.", "error");
      return false;
    }
    if (!nameIsFree(typeface, wanted)) {
      this.say(`There is already a letter called ${wanted}.`, "error");
      return false;
    }
    const taken = unicodes.map((one) => claimedBy(typeface, one, wanted)).find(Boolean);
    if (taken) {
      this.say(`${taken} already answers to that character.`, "error");
      return false;
    }

    const made = this.editFont("Add a letter", (one) => putGlyphIn(one, wanted, unicodes) !== null);
    if (made) {
      this.set({ selectedGlyph: wanted, selectedNodes: new Set(), view: "glyph" });
      this.say(`Added ${wanted}.`, "success");
    }
    return made;
  }

  /**
   * Take a letter out, having said what goes with it.
   *
   * The letters built on this one are named before anything happens, because
   * they are what somebody would not have thought of: deleting an `a` takes
   * the `a` out of every accented letter built from it, and those letters stay
   * in the font looking like the accent on its own.
   */
  removeGlyph(name: string): boolean {
    const typeface = this.state.typeface;
    if (!typeface) return false;
    const built = dependentsOf(typeface, name);

    const gone = this.editFont("Remove a letter", (one) => takeGlyphOut(one, name));
    if (!gone) return false;

    if (this.state.selectedGlyph === name) {
      this.set({ selectedGlyph: firstLetterName(typeface), selectedNodes: new Set() });
    }
    this.say(
      built.length === 0
        ? `Removed ${name}.`
        : `Removed ${name}, and took it out of ${built.length} letter${built.length === 1 ? "" : "s"} built on it: ${built.slice(0, 4).join(", ")}${built.length > 4 ? "…" : ""}.`,
      built.length === 0 ? "success" : "info",
    );
    return true;
  }

  /** Give a letter a different name, everywhere the old one was written. */
  renameGlyph(from: string, to: string): boolean {
    const typeface = this.state.typeface;
    if (!typeface) return false;
    const wanted = to.trim();
    if (wanted.length === 0 || wanted === from) return false;
    if (!nameIsFree(typeface, wanted)) {
      this.say(`There is already a letter called ${wanted}.`, "error");
      return false;
    }

    const done = this.editFont("Rename a letter", (one) => callGlyph(one, from, wanted));
    if (done && this.state.selectedGlyph === from) this.set({ selectedGlyph: wanted });
    return done;
  }

  /** A copy of a letter under a new name, without the character it answers to. */
  duplicateGlyph(name: string): string | null {
    const typeface = this.state.typeface;
    if (!typeface) return null;
    const into = freeNameNear(typeface, name);
    const made = this.editFont("Duplicate a letter", (one) => copyGlyphTo(one, name, into) !== null);
    if (!made) return null;
    this.set({ selectedGlyph: into, selectedNodes: new Set() });
    this.say(`Copied ${name} to ${into}. It answers to no character until you give it one.`, "success");
    return into;
  }

  /*
   * The rules that draw one thing for another.
   *
   * Through `editFont` like the rest of the structural changes, because a
   * feature is not part of any one glyph: undo has to put the whole rule back,
   * and a rule names letters that other operations rewrite.
   */

  /** Join a run of letters into one drawing of them together. */
  addLigature(components: string[], ligature: string): boolean {
    const made = this.editFont("Add a ligature", (one) =>
      putLigatureIn(one, components, ligature),
    );
    if (made) this.say(`${components.join(" ")} now draws as ${ligature}.`, "success");
    else this.say(`Could not make a ligature of ${components.join(" ")}.`, "error");
    return made;
  }

  /** Take a ligature out, leaving the drawing it used behind. */
  removeLigature(components: string[]): boolean {
    const gone = this.editFont("Remove a ligature", (one) => takeLigatureOut(one, components));
    if (gone) {
      this.say(
        `${components.join(" ")} draws as separate letters again. The drawing is still in the font.`,
        "success",
      );
    }
    return gone;
  }

  /** Put one letter's second drawing under a tag a reader can switch on. */
  addToSet(tag: string, label: string, plain: string, alternate: string): boolean {
    const made = this.editFont("Add to a set", (one) =>
      putInSet(one, tag, label, plain, alternate),
    );
    if (made) this.say(`${alternate} is now ${plain} under ${tag}.`, "success");
    else this.say(`Could not put ${plain} into ${tag}.`, "error");
    return made;
  }

  /** Take one letter out of a set, and the set with it if it was the last. */
  removeFromSet(tag: string, plain: string): boolean {
    return this.editFont("Remove from a set", (one) => takeOutOfSet(one, tag, plain));
  }

  /**
   * Which characters a letter answers to.
   *
   * Refused rather than merged when another letter already claims one: two
   * glyphs on the same codepoint is a font where one of them can never be
   * typed, and which one wins is decided by the order they happen to sit in.
   */
  setCodepoints(name: string, unicodes: number[]): boolean {
    const typeface = this.state.typeface;
    const glyph = this.glyph(name);
    if (!typeface || !glyph) return false;

    for (const codepoint of unicodes) {
      const holder = claimedBy(typeface, codepoint, name);
      if (holder) {
        this.say(`${holder} already answers to that character.`, "error");
        return false;
      }
    }
    const wanted = [...new Set(unicodes)].sort((one, other) => one - other);
    if (wanted.join() === [...glyph.unicodes].sort((one, other) => one - other).join()) return false;

    this.editGlyph(name, "Set the character", (one) => {
      one.unicodes = wanted;
    });
    return true;
  }

  /*
   * Carrying a drawing from one letter to another.
   *
   * There was no clipboard of any kind, which meant an `m` could not be
   * started from an `n` -- and starting an `m` from an `n` is how an `m` is
   * started. The whole argument for a type family is that the letters share
   * their parts, and every one of those parts had to be drawn again by hand.
   *
   * Kept here rather than in the system clipboard, and that is a decision
   * rather than a shortcut: the system one holds text, and putting outlines
   * through it means inventing a serialisation, asking for a permission the
   * browser may refuse, and handling whatever somebody happens to have copied
   * from somewhere else. What this is for is one letter to another inside one
   * font, and for that a variable is the whole of it.
   */
  private carried: Contour[] = [];

  /** Take a copy of what is picked, or of the whole letter when nothing is. */
  copyOutlines(glyphName: string): number {
    const glyph = this.glyph(glyphName);
    if (!glyph || glyph.contours.length === 0) return 0;

    const picked = this.state.selectedNodes;
    const wanted =
      picked.size === 0
        ? glyph.contours
        : glyph.contours.filter((contour, index) =>
            contour.nodes.every((_, node) => picked.has(nodeKey({ contour: index, node }))),
          );
    if (wanted.length === 0) {
      this.say("Pick whole paths to copy, or none to copy the letter.", "error");
      return 0;
    }

    // Copied deeply, because the letter it came from goes on being edited and
    // a shared node would follow it.
    this.carried = wanted.map((contour) => ({
      ...contour,
      nodes: contour.nodes.map((node) => ({
        point: { ...node.point },
        handleIn: node.handleIn ? { ...node.handleIn } : null,
        handleOut: node.handleOut ? { ...node.handleOut } : null,
        type: node.type,
      })),
    }));
    this.say(
      `Copied ${this.carried.length} path${this.carried.length === 1 ? "" : "s"}.`,
      "success",
    );
    return this.carried.length;
  }

  /** Whether there is anything to paste. */
  get carrying(): number {
    return this.carried.length;
  }

  /**
   * Put what was copied into a letter, alongside what is already there.
   *
   * Added rather than replacing, because that is what somebody starting an `m`
   * from an `n` wants: the shoulder arrives beside the stems rather than
   * instead of them. Deleting the letter first is one key away for the times
   * it is not.
   */
  pasteOutlines(glyphName: string): boolean {
    const glyph = this.glyph(glyphName);
    if (!glyph || this.carried.length === 0) return false;

    const arriving = this.carried.map((contour) => ({
      ...contour,
      nodes: contour.nodes.map((node) => ({
        point: { ...node.point },
        handleIn: node.handleIn ? { ...node.handleIn } : null,
        handleOut: node.handleOut ? { ...node.handleOut } : null,
        type: node.type,
      })),
    }));
    const from = glyph.contours.length;

    this.editGlyph(glyphName, "Paste paths", (one) => {
      one.contours = [...one.contours, ...arriving];
    });
    // Left picked, because what arrives is almost always in the wrong place
    // and moving it is the next thing that happens.
    const keys: string[] = [];
    arriving.forEach((contour, index) =>
      contour.nodes.forEach((_, node) => keys.push(nodeKey({ contour: from + index, node }))),
    );
    this.set({ selectedNodes: new Set(keys) });
    this.say(`Pasted ${arriving.length} path${arriving.length === 1 ? "" : "s"}.`, "success");
    return true;
  }

  /*
   * The font's own identity, and the lines it is drawn between.
   *
   * Both of these existed for a long time with nothing calling them, which is
   * how a font opened in this editor kept the name of the file it came from
   * whatever was done to it. Redrawing every letter of DejaVu Sans and
   * exporting gave a file still called DejaVu Sans, still carrying DejaVu's
   * copyright and still naming DejaVu's designer -- which is not a missing
   * field, it is a derivative work that does not say so.
   *
   * They push an edit each, because a name is an edit. Committed rather than
   * typed: a field that pushed on every keystroke would put nineteen entries
   * on the stack for one family name, and undo would walk back through the
   * spelling of it.
   */
  setMeta(partial: Partial<Typeface["meta"]>): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const before = { ...typeface.meta };
    const after = { ...typeface.meta, ...partial };
    if (Object.keys(partial).every((key) => before[key as keyof typeof before] === after[key as keyof typeof after])) {
      return;
    }
    typeface.meta = after;
    this.push({
      label: "Change the font's details",
      undo: () => {
        typeface.meta = { ...before };
      },
      redo: () => {
        typeface.meta = { ...after };
      },
    });
    this.touch();
  }

  setMetrics(partial: Partial<Typeface["metrics"]>): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const before = { ...typeface.metrics };
    const after = { ...typeface.metrics, ...partial };
    if (Object.keys(partial).every((key) => before[key as keyof typeof before] === after[key as keyof typeof after])) {
      return;
    }
    typeface.metrics = after;
    this.push({
      label: "Change the font's lines",
      undo: () => {
        typeface.metrics = { ...before };
      },
      redo: () => {
        typeface.metrics = { ...after };
      },
    });
    this.touch();
  }

  // --- history ----------------------------------------------------------

  private push(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) return;
    entry.undo();
    this.redoStack.push(entry);
    this.touch();
  }

  redo(): void {
    const entry = this.redoStack.pop();
    if (!entry) return;
    entry.redo();
    this.undoStack.push(entry);
    this.touch();
  }

  /** Snapshot a glyph so a drag can be committed to history when it ends. */
  snapshotGlyph(name: string): Glyph | null {
    const typeface = this.state.typeface;
    if (!typeface) return null;
    const index = typeface.glyphIndex.get(name);
    return index === undefined ? null : cloneGlyph(typeface.glyphs[index]);
  }

  glyph(name: string | null): Glyph | null {
    const typeface = this.state.typeface;
    if (!typeface || !name) return null;
    const index = typeface.glyphIndex.get(name);
    return index === undefined ? null : typeface.glyphs[index];
  }
}

export function cloneGlyph(glyph: Glyph): Glyph {
  return {
    name: glyph.name,
    unicodes: [...glyph.unicodes],
    advanceWidth: glyph.advanceWidth,
    components: glyph.components.map((component) => ({ ...component, transform: { ...component.transform } })),
    anchors: glyph.anchors.map((anchor) => ({ ...anchor })),
    params: { ...glyph.params },
    dirty: glyph.dirty,
    contours: glyph.contours.map((contour) => ({
      closed: contour.closed,
      nodes: contour.nodes.map((node) => ({
        point: { ...node.point },
        handleIn: node.handleIn ? { ...node.handleIn } : null,
        handleOut: node.handleOut ? { ...node.handleOut } : null,
        type: node.type,
      })),
    })),
  };
}

/** Open on a recognisable letter rather than `.notdef` when a font loads. */
function firstLetterName(typeface: Typeface): string | null {
  for (const codepoint of [65, 72, 97]) {
    const match = typeface.glyphs.find((glyph) => glyph.unicodes.includes(codepoint));
    if (match) return match.name;
  }
  return typeface.glyphs.find((glyph) => glyph.contours.length > 0)?.name ?? null;
}

export const store = new Store();
