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
import { dependentsOf } from "@/font/composite";
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
} from "@/font/types";
/**
 * The bundled sample, as a URL rather than as bytes: Vite emits it as a hashed
 * asset the browser caches like any other, instead of inlining 47KB of font
 * into the JavaScript everybody downloads whether they use it or not.
 */
import sampleFontUrl from "@/assets/typeforge-sample.ttf?url";

/** What the sample is called once it is open, as any other file would be. */
const SAMPLE_FILE_NAME = "TypeforgeSample-Regular.ttf";

export type ViewId = "grid" | "glyph" | "kerning" | "metrics" | "report";
export type ToolId = "select" | "pen";

/** A node's address within a glyph, used for selection. */
export interface NodeRef {
  contour: number;
  node: number;
}

export const nodeKey = (ref: NodeRef): string => `${ref.contour}:${ref.node}`;

export interface AppState {
  typeface: Typeface | null;
  fileName: string;
  view: ViewId;
  tool: ToolId;
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
    view: "grid",
    tool: "select",
    /*
     * `n` on both sides, which is where a type designer starts.
     *
     * A letter is spaced against the ones it will actually stand between, and
     * the lowercase `n` is the conventional first neighbour because its two
     * stems are straight and evenly spaced -- so any unevenness in the gap
     * belongs to the letter under test rather than to the letter beside it.
     */
    context: { before: "n", after: "n" },
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
    revision: 0,
  };

  private listeners = new Set<() => void>();
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
    this.undoStack = [];
    this.redoStack = [];
    this.controlBaseline = readControls(typeface);
    this.set({
      typeface,
      fileName,
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
  }

  /** Say something in the toolbar, for anything that has no view of its own. */
  say(message: string, tone: "info" | "error" | "success" = "success"): void {
    this.set({ status: { message, tone } });
  }

  /** The edited half, for writing down. */
  snapshot(): { typeface: Typeface; fileName: string } | undefined {
    const { typeface, fileName } = this.state;
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
    this.set({ busy: true, status: { message: `Reading ${fileName}…`, tone: "info" } });
    try {
      const { typeface, warnings } = await importFont(bytes, fileName);
      this.undoStack = [];
      this.redoStack = [];
      // The control letters as they arrived. Every later derivation compares
      // against this rather than against the previous edit, so editing n twice
      // expresses the total change instead of compounding.
      this.controlBaseline = readControls(typeface);
      this.set({
        typeface,
        fileName,
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
            warnings.length ? `. ${warnings[0]}` : ""
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
    this.undoStack = [];
    this.redoStack = [];
    this.set({
      typeface: emptyTypeface(),
      fileName: "",
      selectedGlyph: null,
      selectedNodes: new Set(),
      selectedGlyphs: new Set(),
      status: null,
    });
    this.captureControlBaseline();
    this.touch();
  }

  // --- navigation -------------------------------------------------------

  setView(view: ViewId): void {
    this.set({ view });
  }
  setTool(tool: ToolId): void {
    this.set({ tool });
  }
  /** Change what stands either side of the glyph being edited. */
  setContext(context: Partial<AppState["context"]>): void {
    this.set({ context: { ...this.state.context, ...context } });
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
      label: `Build ${result.built.length} accented glyphs`,
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

  setMeta(partial: Partial<Typeface["meta"]>): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    typeface.meta = { ...typeface.meta, ...partial };
    this.touch();
  }

  setMetrics(partial: Partial<Typeface["metrics"]>): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    typeface.metrics = { ...typeface.metrics, ...partial };
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
