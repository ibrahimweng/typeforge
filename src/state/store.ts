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

import { importFont } from "@/font/parse";
import { effectiveParams } from "@/font/transform";
import {
  DEFAULT_PARAMS,
  emptyTypeface,
  type Glyph,
  type GlyphParams,
  type KernPair,
  type Typeface,
} from "@/font/types";

export type ViewId = "grid" | "glyph" | "kerning" | "metrics";
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
}

interface HistoryEntry {
  label: string;
  undo: () => void;
  redo: () => void;
}

const MAX_HISTORY = 200;

class Store {
  private state: AppState = {
    typeface: null,
    fileName: "",
    view: "grid",
    tool: "select",
    selectedGlyph: null,
    selectedNodes: new Set(),
    selectedGlyphs: new Set(),
    search: "",
    previewText: "Hamburgefonstiv",
    status: null,
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

  async loadFont(bytes: Uint8Array, fileName: string): Promise<void> {
    this.set({ busy: true, status: { message: `Reading ${fileName}…`, tone: "info" } });
    try {
      const { typeface, warnings } = await importFont(bytes, fileName);
      this.undoStack = [];
      this.redoStack = [];
      this.set({
        typeface,
        fileName,
        selectedGlyph: firstLetterName(typeface),
        selectedNodes: new Set(),
        selectedGlyphs: new Set(),
        busy: false,
        status: {
          message: `${typeface.meta.familyName} — ${typeface.glyphs.length.toLocaleString()} glyphs${
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
    this.touch();
  }

  // --- navigation -------------------------------------------------------

  setView(view: ViewId): void {
    this.set({ view });
  }
  setTool(tool: ToolId): void {
    this.set({ tool });
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

  /** Copy the resolved parameters of a glyph, for the inspector to display. */
  paramsFor(name: string): GlyphParams {
    const typeface = this.state.typeface;
    if (!typeface) return { ...DEFAULT_PARAMS };
    const index = typeface.glyphIndex.get(name);
    if (index === undefined) return { ...typeface.params };
    return effectiveParams(typeface.glyphs[index], typeface);
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
