/**
 * The store's own machinery, and nothing about the document.
 *
 * Everything below this in the chain reaches the state through `set`, marks a
 * change with `touch`, records an undo step with `push`, and reads a letter
 * with `glyph`. Those five, the state itself and the caches that hang off it
 * are here, so that the parts that use them can be read one at a time.
 *
 * Abstract because there is no such thing as half a store. `store.ts` puts the
 * chain together and exports the one instance.
 */

import type { ControlReadings } from "@/font/control";
import type { LinkMap } from "@/font/link";
import { cloneGlyph } from "@/font/types";
import { shareAcross } from "@/font/master";
import type { Glyph, Contour, Typeface } from "@/font/types";
import type { UfoCarried } from "@/ufo/font";
import { STARTING_PENS, STARTING_WIDTH } from "@/quill/written";
import { POLYGON_SIDES } from "@/font/shapes";

import type { AppState, HistoryEntry } from "./model";

const MAX_HISTORY = 200;

/** Open on a recognisable letter rather than `.notdef` when a font loads. */
export function firstLetterName(typeface: Typeface): string | null {
  for (const codepoint of [65, 72, 97]) {
    const match = typeface.glyphs.find((glyph) => glyph.unicodes.includes(codepoint));
    if (match) return match.name;
  }
  return typeface.glyphs.find((glyph) => glyph.contours.length > 0)?.name ?? null;
}

export abstract class StoreCore {
  /** The control letters as the font was opened, never updated afterwards. */
  /**
   * What the open UFO holds that this application does not model.
   *
   * Kept off `AppState` deliberately: nothing renders from it and it is a
   * megabyte of somebody's background layers, so putting it in the state
   * would have every subscriber re-render whenever it changed and every
   * snapshot carry it.
   */
  protected ufo: UfoCarried | null = null;

  protected controlBaseline: ControlReadings | null = null;
  /**
   * Their outlines at that same moment, kept because the fit needs the shape it
   * is fitting from. Once a letter is edited the old outline is gone from the
   * document, and fitting the edited shape against its own measurements derives
   * nothing.
   */
  protected controlOutlines = new Map<string, Contour[]>();
  /**
   * Which points elsewhere follow each control letter's points, worked out once
   * from the font as opened. Rebuilding these after every edit would relink a
   * letter to wherever its points had just been dragged.
   */
  protected controlLinks = new Map<string, LinkMap>();

  protected state: AppState = {
    typeface: null,
    fileName: "",
    openWarnings: [],
    view: "grid",
    tool: "select",
    lastInGroup: {
      select: "select",
      pen: "pen",
      shape: "rectangle",
      knife: "knife",
      write: "skeleton",
    },
    pen: { width: STARTING_WIDTH, contrast: 0.55, angle: 30 },
    pens: STARTING_PENS.map((one) => ({ ...one })),
    usingPen: null,
    writing: null,
    stop: null,
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
    undoLabel: null,
    redoLabel: null,
    loan: null,
    masters: [],
    master: "",
    preview: null,
    revision: 0,
    checks: null,
  };

  private listeners = new Set<() => void>();
  /** What was on the desk before a letter was borrowed, put aside whole. */
  protected held: {
    state: AppState;
    undoStack: HistoryEntry[];
    redoStack: HistoryEntry[];
    ufo: UfoCarried | null;
    controlBaseline: ControlReadings | null;
  } | null = null;
  protected undoStack: HistoryEntry[] = [];
  protected redoStack: HistoryEntry[] = [];

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AppState => this.state;

  protected set(partial: Partial<AppState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener();
  }

  /** Signal that the document changed, so views re-render. */
  protected touch(): void {
    /*
     * And every other weight gets whatever of that was not the drawing.
     *
     * Here rather than at each write, because there is no list of the writes:
     * kerning, features, the metrics, the family name and undo itself all
     * reach the shared half, and one of them missing this is a Bold that is
     * quietly a different font. Twelve reference assignments against a change
     * that already re-rendered the application.
     */
    if (this.state.masters.length > 1 && this.state.typeface) {
      shareAcross(this.state.typeface, this.state.masters);
    }
    this.set({
      revision: this.state.revision + 1,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoLabel: this.undoStack[this.undoStack.length - 1]?.label ?? null,
      redoLabel: this.redoStack[this.redoStack.length - 1]?.label ?? null,
    });
  }

  /** Say something in the toolbar, for anything that has no view of its own. */
  say(message: string, tone: "info" | "error" | "success" = "success"): void {
    this.set({ status: { message, tone } });
  }

  protected push(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
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
