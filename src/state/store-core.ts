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
 *
 * The chain has one rule, and it is worth stating as a rule rather than as a
 * habit: a layer may use what is below it and must never reach up. Eight
 * classes inheriting from one another is a shape that usually earns its bad
 * name, and what keeps this one readable is that the arrows all point the same
 * way. It was true when it was measured and nothing was checking it, which
 * meant the first call up the chain would have gone in unremarked and turned
 * an order into a knot.
 *
 * `layering.test.ts` checks it now, along with what actually crosses a
 * boundary: ten methods and seven fields, all but four of them from this file.
 * Read that file before adding a layer or widening the kernel. Its numbers are
 * the honest description of how tangled this is, and they are meant to go down
 * rather than up.
 */

import type { ControlReadings } from "@/font/control";
import type { LinkMap } from "@/font/link";
import { cloneGlyph } from "@/font/types";
import { shareAcross } from "@/font/master";
import type { Glyph, Contour, Typeface } from "@/font/types";
import type { UfoCarried } from "@/ufo/font";
import { STARTING_PENS, STARTING_WIDTH } from "@/quill/written";
import { POLYGON_SIDES } from "@/font/shapes";
import {
  blankDocument,
  documentPart,
  nameOf,
  newId,
  type Aside,
  type PerDocument,
} from "./documents";

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
    // One font, in front, before anything has been opened.
    open: [{ id: "font-0", name: "Untitled" }],
    openAt: 0,
    reopenable: null,
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

  /*
   * The fonts that are open but not in front, put aside whole.
   *
   * The live state is the font being worked on. It is not a copy of an entry
   * here and there is no entry here for it: putting one aside is what makes an
   * entry, and picking one up is what takes it away again. That is the same
   * arrangement `held` above uses for a loan, for the same reason -- one live
   * document and the rest in a drawer is a great deal easier to keep honest
   * than a list where one entry is secretly the real one.
   *
   * So `set` needs no mirroring and costs nothing extra on a drag frame. The
   * only place this can go wrong is the swap itself, which is one function.
   */
  protected aside: Aside[] = [];

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
    // A font renamed is a tab renamed, and the rename happens in a dialog that
    // has never heard of tabs. Guarded above, so this is free when nothing moved.
    this.tellTabs();
    this.set({
      revision: this.state.revision + 1,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoLabel: this.undoStack[this.undoStack.length - 1]?.label ?? null,
      redoLabel: this.redoStack[this.redoStack.length - 1]?.label ?? null,
    });
  }

  // --- several fonts open at once -----------------------------------------

  /**
   * The tabs, as the interface needs to see them.
   *
   * Rebuilt whenever the set of open fonts changes rather than derived on
   * every read, because it goes into the state and the state is what decides
   * whether the toolbar re-renders. Derived, a tab strip would be rebuilt
   * sixty times a second while somebody dragged a point.
   */
  private tellTabs(): void {
    const open = this.aside.map((one) => ({ id: one.id, name: nameOf(one.state) }));
    open.splice(this.at, 0, { id: this.mine, name: nameOf(this.state) });
    /*
     * Published only when it has actually changed, which is what lets `touch`
     * call this on every edit.
     *
     * A tab says what the font is called, and a font is renamed in a dialog
     * that knows nothing about tabs -- so the alternative is a call to this
     * from every place a family name can be set, and the tab going stale at
     * whichever one gets missed. Rebuilding a list of half a dozen small
     * objects and comparing it is nothing beside what `touch` already does;
     * what would cost something is a new `open` array sixty times a second
     * while a point is dragged, re-rendering the strip each time, and that is
     * exactly what this guard stops.
     */
    const was = this.state.open;
    const same =
      was.length === open.length &&
      this.at === this.state.openAt &&
      open.every((one, at) => one.id === was[at].id && one.name === was[at].name);
    if (same) return;
    this.set({ open, openAt: this.at });
  }

  /** Where the font in front sits among the ones put aside. */
  protected at = 0;
  /**
   * What the font in front is called in the list, which nothing else knows.
   *
   * The first is named rather than counted, so the id in the state above --
   * which is written before this field exists -- and this one agree without a
   * constructor to make them.
   */
  protected mine = "font-0";

  /**
   * Put the font in front aside and pick up another.
   *
   * Everything that belongs to a font travels: what it is, what is picked in
   * it, which screen you were on, and both history stacks. Everything that
   * belongs to the person stays -- the tool in hand, snapping, the ground --
   * because a tool that changed when you switched font would be a tool
   * changing when you were not looking.
   */
  goToDocument(index: number): void {
    if (index === this.at || index < 0 || index > this.aside.length) return;
    /*
     * Held shut over a borrowed letter, for the reason the modes were. A loan
     * has the real document in a drawer already, and putting a second thing in
     * the same drawer loses one of them.
     */
    if (this.state.loan) {
      this.say(
        `Finish with ${this.state.loan.letter} first — keep the drawing or throw it away.`,
        "info",
      );
      return;
    }

    const mine: Aside = { id: this.mine, state: documentPart(this.state) };
    const stacks = { undo: this.undoStack, redo: this.redoStack };
    this.stacks.set(this.mine, stacks);

    // Taken out first, then put back in the same place, so the order of the
    // tabs is the order they were opened in whichever way somebody moves.
    const taking = this.aside[index > this.at ? index - 1 : index];
    this.aside = this.aside.filter((one) => one !== taking);
    this.aside.splice(this.at, 0, mine);

    this.mine = taking.id;
    this.at = index;
    const back = this.stacks.get(taking.id);
    this.undoStack = back ? back.undo : [];
    this.redoStack = back ? back.redo : [];
    this.set({ ...taking.state });
    this.tellTabs();
  }

  /** The history of each font that is not in front, by its id. */
  private stacks = new Map<string, { undo: HistoryEntry[]; redo: HistoryEntry[] }>();

  /**
   * The fonts that have been closed, newest last, with their histories.
   *
   * Because the cross on a tab is small, permanent and beside the name of a
   * font somebody has spent an afternoon on. Everything else this application
   * does to a document can be taken back; closing one could not, and the
   * session is written down straight afterwards, so a misclick and a reload
   * were the whole of it.
   *
   * Held for the visit rather than written down. A closed font that came back
   * on the next visit would not be closed, and a document carrying every font
   * anybody had ever shut would grow without end. What this is for is the
   * misclick, and a misclick is noticed in the same minute.
   */
  private shut: Array<{
    id: string;
    name: string;
    state: Pick<AppState, PerDocument>;
    undo: HistoryEntry[];
    redo: HistoryEntry[];
  }> = [];

  /** How many closed fonts are kept. Enough for a misclick, not a filing system. */
  private static readonly REMEMBERED = 8;

  /** Put the most recently closed font back, in front. */
  reopenDocument(): boolean {
    const back = this.shut[this.shut.length - 1];
    if (!back) return false;
    // Held shut over a borrowed letter, for the reason every other move
    // between documents is: a loan already has the real document in a drawer.
    if (this.state.loan) {
      this.say(
        `Finish with ${this.state.loan.letter} first — keep the drawing or throw it away.`,
        "info",
      );
      return false;
    }
    this.shut.pop();
    this.makeRoom();
    this.mine = back.id;
    this.undoStack = back.undo;
    this.redoStack = back.redo;
    this.set({ ...back.state, reopenable: this.shut[this.shut.length - 1]?.name ?? null });
    /*
     * `touch` rather than `tellTabs`, because what came back has to be told
     * the truth about itself.
     *
     * `canUndo` and its labels travel with the document, so they say whatever
     * they said at the moment it was closed -- and a font whose history did
     * not come back with it would sit there with a live Undo button and an
     * empty stack behind it. `touch` reads those off the stacks in hand, and
     * tells the tabs on its way past.
     */
    this.touch();
    this.say(`${back.name} is back.`);
    return true;
  }

  /** Remember one on the way out, so the cross has a way back. */
  private remember(id: string, state: Pick<AppState, PerDocument>): void {
    this.shut.push({
      id,
      name: nameOf(state),
      state,
      undo: this.stacks.get(id)?.undo ?? [],
      redo: this.stacks.get(id)?.redo ?? [],
    });
    if (this.shut.length > StoreCore.REMEMBERED) this.shut.shift();
    this.set({ reopenable: this.shut[this.shut.length - 1].name });
  }

  /**
   * Open a font in a tab of its own rather than over the one in front.
   *
   * What `adopt` used to do to whatever was open, done to nothing instead. The
   * font in front goes aside with everything that belongs to it, and the new
   * one arrives on a clean desk: no selection, no history, its own view.
   */
  private asANewDocument(): void {
    const mine: Aside = { id: this.mine, state: documentPart(this.state) };
    this.stacks.set(this.mine, { undo: this.undoStack, redo: this.redoStack });
    this.aside.splice(this.at, 0, mine);
    this.at += 1;
    this.mine = newId();
    this.undoStack = [];
    this.redoStack = [];
    /*
     * And the desk itself is cleared, rather than left holding the last font's
     * things for whoever is arriving to overwrite.
     *
     * Each caller does set most of this immediately afterwards, so for a while
     * this looked like work done twice. It is not: what it costs is nineteen
     * assignments, and what it buys is that a door which forgets one of them
     * gets a blank rather than the last font's. Guides were the one forgotten
     * -- they are in font units, so the guides from a two-thousand-unit face
     * arrive over a thousand-unit one meaning something else entirely -- and
     * nothing would have said so.
     */
    this.set(blankDocument());
  }

  /**
   * Every open font's own fields, in the order their tabs sit in.
   *
   * For writing the session down, which is the one thing that wants all of
   * them at once. The live state is the one in front and is not in `aside`, so
   * it is put back where it belongs on the way out -- and during a loan the
   * document of record is the desk that was put away, for the reason
   * `snapshots` gives where it uses this.
   */
  protected everyDocument(): Array<Pick<AppState, PerDocument>> {
    const parts = this.aside.map((one) => one.state);
    parts.splice(this.at, 0, documentPart(this.held ? this.held.state : this.state));
    return parts;
  }

  /**
   * Back to one empty document, with every font closed and its history gone.
   *
   * What `closeDocument` refuses to do one tab at a time, because an
   * application with no document is a screen with nothing on it. This is the
   * exception and it is not reachable from the interface: a saved session is
   * about to be put back, and it brings its own documents.
   */
  protected closeEveryDocument(): void {
    this.aside = [];
    this.stacks.clear();
    // Nothing to come back to. These are not fonts somebody shut; they are the
    // desk being cleared for a session that is about to arrive, and offering
    // to reopen one of them would offer to put half the last session back on
    // top of this one.
    this.shut = [];
    this.set({ reopenable: null });
    this.at = 0;
    this.mine = newId();
    this.undoStack = [];
    this.redoStack = [];
    this.set(blankDocument());
    this.tellTabs();
  }

  /**
   * Make room for a font that is arriving.
   *
   * The four doors -- a file, a UFO folder, a generator handing over what it
   * drew, and a blank one -- all want the same thing and each used to say it in
   * its own words. A font joins the ones already open; on a desk with nothing
   * on it, it *is* the one open, because a tab for the first font would leave
   * an empty Untitled beside it that nobody wants and nobody can close.
   */
  protected makeRoom(): void {
    if (this.state.typeface) this.asANewDocument();
    else this.clearHistory();
  }

  /**
   * Close one, and say whether it went.
   *
   * The last font is not closable. An application with no document open is a
   * screen with nothing on it, reachable by accident from a small cross, and
   * the way back is the New menu -- which is a lot to ask of somebody who
   * meant to shut a tab.
   *
   * Closing the one in front needs another to come forward first, and that is
   * done by switching to it rather than by hand: switching is the operation
   * that knows how to move both history stacks, and doing it a second way here
   * is how the two would come to disagree.
   */
  closeDocument(index: number): boolean {
    const many = this.aside.length + 1;
    if (many < 2 || index < 0 || index >= many) return false;

    if (index === this.at) {
      const going = this.mine;
      // Its right-hand neighbour, or its left when it was last.
      this.goToDocument(index === many - 1 ? index - 1 : index + 1);
      // The switch refused, which it does over a borrowed letter.
      if (this.mine === going) return false;
      const gone = this.aside.find((one) => one.id === going);
      this.aside = this.aside.filter((one) => one.id !== going);
      // Remembered before its history is dropped, since the way back is only
      // worth having if what comes back can still be undone.
      if (gone) this.remember(going, gone.state);
      this.stacks.delete(going);
      // The one that came forward may have been to the right of the one that
      // has gone, in which case everything after it has moved up.
      if (this.at > index) this.at = index;
      this.tellTabs();
      return true;
    }

    const [dropped] = this.aside.splice(index > this.at ? index - 1 : index, 1);
    if (dropped) {
      this.remember(dropped.id, dropped.state);
      this.stacks.delete(dropped.id);
    }
    if (index < this.at) this.at -= 1;
    this.tellTabs();
    return true;
  }

  /** Say something in the toolbar, for anything that has no view of its own. */
  say(message: string, tone: "info" | "error" | "success" = "success"): void {
    this.set({ status: { message, tone } });
  }

  /**
   * Forget every step, because what is open is a different document.
   *
   * The two lines this replaces sat together in six places in `store.ts` --
   * adopting a font, reopening a project, opening a file, opening a UFO,
   * starting blank, and lending a letter out. They always went together,
   * because half-cleared history is an undo that reaches into a document that
   * is no longer there.
   *
   * Named here rather than repeated there for the reason the pair existed at
   * all: the stacks are the kernel's, and a layer above reaching in to empty
   * them is the kernel's encapsulation leaking. `dropLoan` still assigns them
   * directly, and that one is not this: it is putting a kept history back,
   * which is the opposite operation and has no business borrowing this name.
   */
  protected clearHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
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
